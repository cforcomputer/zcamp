"""
server.py — zKill Activity Tracker Backend
============================================
Single-file FastAPI server that:
  1. Polls zKillboard RedisQ for killmails (handles Dec 2025 breaking change)
  2. Fetches full killmail data from ESI using the hash
  3. Enriches killmails with ship categories and spatial pinpointing
  4. Feeds kills into the ActivityManager for gatecamp / gang detection
  5. Broadcasts live activity updates to the React frontend via WebSocket
  6. Persists data in PostgreSQL (no Redis dependency)

Environment variables (see .env.example):
  DATABASE_URL    — PostgreSQL connection string
  REDISQ_QUEUE_ID — unique queue identifier for RedisQ
  PORT            — server port (default 8000)
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketState

from activity_manager import ActivityManager

# ─── Logging ────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("server")

# ─── Configuration ──────────────────────────────────────────────────────────


# Load .env file if present (for local development; Docker uses env_file instead)
def _load_dotenv():
    import pathlib

    env_path = pathlib.Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

DATABASE_URL: str = os.getenv(
    "DATABASE_URL", "postgresql://tracker:tracker@db:5432/tracker"
)
REDISQ_QUEUE_ID: str = os.getenv("REDISQ_QUEUE_ID", "zkill-tracker-default")
REDISQ_BASE: str = "https://zkillredisq.stream/listen.php"
ESI_BASE: str = "https://esi.evetech.net/v1"
PORT: int = int(os.getenv("PORT", "8000"))

# SDE data URLs (downloaded once at startup)
SDE_MARKET_GROUPS_URL = "https://sde.zzeve.com/invMarketGroups.json"
SDE_INV_TYPES_URL = "https://sde.zzeve.com/invTypes.json"
SDE_JUMPS_URL = "https://sde.zzeve.com/mapSolarSystemJumps.json"

# ─── Constants ──────────────────────────────────────────────────────────────

CAPSULE_ID = 670
MTU_ID = 35834

# Distance thresholds for spatial pinpointing (meters)
THRESHOLDS = {
    "AT_CELESTIAL": 10_000,  # 10 km
    "DIRECT_WARP": 150_000,  # 150 km
    "NEAR_CELESTIAL": 1_000_000_000,  # ~1000 km → 1 AU ≈ very near
    "EPSILON": 0.01,
    "MAX_BOX_SIZE": 1e20,
}

# Market group IDs for ship classification
PARENT_MARKET_GROUPS: dict[str, Any] = {
    "STRUCTURES": [477, 99, 383, 1320],
    "FIGHTERS": [157],
    "SHUTTLES": [391, 1618],
    "CORVETTES": 1815,
    "FRIGATES": [1361, 1838, 1619],
    "DESTROYERS": [1372, 2350],
    "CRUISERS": [1367, 1837],
    "BATTLECRUISERS": [1374, 1698],
    "BATTLESHIPS": [1376, 1620],
    "CAPITALS": [1381, 2288],
    "INDUSTRIAL": 1382,
    "MINING": 1384,
}

# ─── Global State ───────────────────────────────────────────────────────────

db_pool: asyncpg.Pool | None = None
http_client: httpx.AsyncClient | None = None
activity_manager: ActivityManager | None = None

# In-memory caches (populated at startup)
type_info_cache: dict[int, dict] = {}  # typeID → {name, marketGroupID, groupID}
market_group_cache: dict[int, dict] = {}  # marketGroupID → {parentId, name}
ship_type_cache: dict[int, dict] = {}  # shipTypeId → {category, name, tier}
map_cache_by_item: dict[str, dict] = {}  # itemId(str) → celestial object
map_cache_by_system: dict[str, list] = {}  # solarSystemId(str) → [celestial objects]
system_connectivity: dict[str, set] = {}  # systemId(str) → {neighbor ids}
system_id_to_name: dict[str, str] = {}  # systemId(str) → name
region_name_cache: dict[str, str] = {}  # regionId(str) → name

# Connected WebSocket clients
ws_clients: set[WebSocket] = set()

# Recent killmails in memory (rolling 6-hour window)
killmails_cache: list[dict] = []
processed_kill_ids: set[int] = set()  # in-memory dedup (backed by DB)


# ─── Lifespan ───────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    global db_pool, http_client, activity_manager

    log.info("Starting up…")

    # 1. Database pool
    db_pool = await asyncpg.create_pool(
        DATABASE_URL, min_size=2, max_size=10, ssl=False
    )
    log.info("Database pool created")

    # 2. Initialize schema
    await init_database()

    # 3. HTTP client for ESI / SDE / RedisQ
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True
    )

    # 4. Load SDE caches
    await build_type_info_cache()
    await build_market_group_cache()
    await build_map_cache()
    await build_system_connectivity()

    # 5. Activity manager
    activity_manager = ActivityManager()

    # 6. Background tasks
    poll_task = asyncio.create_task(poll_redisq_loop())
    update_task = asyncio.create_task(activity_update_loop())
    cleanup_task = asyncio.create_task(cleanup_loop())

    log.info("Server ready")
    yield

    # Shutdown
    log.info("Shutting down…")
    poll_task.cancel()
    update_task.cancel()
    cleanup_task.cancel()
    await http_client.aclose()
    await db_pool.close()
    log.info("Shutdown complete")


# ─── FastAPI App ────────────────────────────────────────────────────────────

app = FastAPI(title="zKill Activity Tracker", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Database Schema ────────────────────────────────────────────────────────


async def init_database():
    """Create tables if they don't exist."""
    async with db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS processed_kill_ids (
                kill_id     BIGINT PRIMARY KEY,
                processed_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_processed_kills_time
                ON processed_kill_ids(processed_at);

            CREATE TABLE IF NOT EXISTS ship_types (
                ship_type_id INTEGER PRIMARY KEY,
                category     TEXT NOT NULL,
                name         TEXT NOT NULL,
                tier         TEXT NOT NULL DEFAULT 'T1',
                last_updated TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS expired_activities (
                id              SERIAL PRIMARY KEY,
                activity_id     TEXT UNIQUE NOT NULL,
                classification  TEXT NOT NULL,
                system_id       INTEGER,
                stargate_name   TEXT,
                max_probability INTEGER DEFAULT 0,
                start_time      TIMESTAMPTZ,
                last_kill_time  TIMESTAMPTZ,
                end_time        TIMESTAMPTZ,
                total_value     DOUBLE PRECISION DEFAULT 0,
                kill_count      INTEGER DEFAULT 0,
                details         JSONB,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS map_denormalize (
                itemID          BIGINT PRIMARY KEY,
                typeID          INTEGER,
                groupID         INTEGER,
                solarSystemID   BIGINT,
                constellationID BIGINT,
                regionID        BIGINT,
                orbitID         BIGINT,
                x               DOUBLE PRECISION,
                y               DOUBLE PRECISION,
                z               DOUBLE PRECISION,
                radius          DOUBLE PRECISION,
                itemName        TEXT,
                security        DOUBLE PRECISION,
                celestialIndex  INTEGER,
                orbitIndex      INTEGER
            );
        """)
    log.info("Database schema initialized")


# ─── SDE Cache Builders ────────────────────────────────────────────────────


async def build_type_info_cache():
    """Download invTypes.json from SDE and cache type info in memory."""
    global type_info_cache
    log.info("Building type info cache from SDE…")
    try:
        resp = await http_client.get(SDE_INV_TYPES_URL, timeout=60.0)
        resp.raise_for_status()
        data = resp.json()
        temp: dict[int, dict] = {}
        for t in data:
            tid = t.get("typeID")
            if tid is not None and isinstance(tid, (int, float)):
                temp[int(tid)] = {
                    "name": t.get("typeName", "Unknown"),
                    "marketGroupID": t.get("marketGroupID"),
                    "groupID": t.get("groupID"),
                }
        type_info_cache = temp
        log.info(f"Type info cache: {len(type_info_cache)} entries")
    except Exception as e:
        log.error(f"Failed to build type info cache: {e}")


async def build_market_group_cache():
    """Download invMarketGroups.json from SDE and build parent hierarchy."""
    global market_group_cache
    log.info("Building market group cache from SDE…")
    try:
        resp = await http_client.get(SDE_MARKET_GROUPS_URL, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
        temp: dict[int, dict] = {}
        for g in data:
            gid = g.get("marketGroupID")
            if gid is not None and isinstance(gid, (int, float)):
                temp[int(gid)] = {
                    "parentId": g.get("parentGroupID"),
                    "name": g.get("marketGroupName", "Unknown"),
                }
        market_group_cache = temp
        log.info(f"Market group cache: {len(market_group_cache)} entries")
    except Exception as e:
        log.error(f"Failed to build market group cache: {e}")


async def build_map_cache():
    """Load map_denormalize from the database into memory caches."""
    global map_cache_by_item, map_cache_by_system
    log.info("Building map cache from database…")
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM map_denormalize")
        temp_item: dict[str, dict] = {}
        temp_system: dict[str, list] = {}
        for row in rows:
            obj = {
                "itemid": str(row["itemid"]),
                "typeid": row["typeid"],
                "groupid": row["groupid"],
                "solarsystemid": str(row["solarsystemid"])
                if row["solarsystemid"]
                else None,
                "constellationid": str(row["constellationid"])
                if row["constellationid"]
                else None,
                "regionid": str(row["regionid"]) if row["regionid"] else None,
                "orbitid": str(row["orbitid"]) if row["orbitid"] else None,
                "x": float(row["x"]) if row["x"] is not None else None,
                "y": float(row["y"]) if row["y"] is not None else None,
                "z": float(row["z"]) if row["z"] is not None else None,
                "radius": float(row["radius"]) if row["radius"] is not None else None,
                "itemname": row["itemname"],
                "security": float(row["security"])
                if row["security"] is not None
                else None,
                "celestialindex": row["celestialindex"],
                "orbitindex": row["orbitindex"],
            }
            temp_item[obj["itemid"]] = obj
            if obj["solarsystemid"]:
                temp_system.setdefault(obj["solarsystemid"], []).append(obj)

        map_cache_by_item = temp_item
        map_cache_by_system = temp_system
        log.info(
            f"Map cache: {len(map_cache_by_item)} items, {len(map_cache_by_system)} systems"
        )
    except Exception as e:
        log.error(f"Failed to build map cache: {e}")


async def build_system_connectivity():
    """Build system jump connectivity, region names, and system name maps."""
    global system_connectivity, system_id_to_name, region_name_cache
    log.info("Building system connectivity from SDE…")
    try:
        temp_conn: dict[str, set] = {}
        temp_names: dict[str, str] = {}
        temp_regions: dict[str, str] = {}

        for cel in map_cache_by_item.values():
            if cel["typeid"] == 5 and cel["itemid"] and cel["itemname"]:
                sid = cel["itemid"]
                temp_conn.setdefault(sid, set())
                temp_names[sid] = cel["itemname"]
            elif cel["typeid"] == 3 and cel["itemid"] and cel["itemname"]:
                temp_regions[cel["itemid"]] = cel["itemname"]

        # Fetch jump data
        resp = await http_client.get(SDE_JUMPS_URL, timeout=30.0)
        resp.raise_for_status()
        jumps = resp.json()
        links = 0
        for j in jumps:
            from_id = str(j["fromSolarSystemID"])
            to_id = str(j["toSolarSystemID"])
            if from_id in temp_conn and to_id in temp_conn:
                temp_conn[from_id].add(to_id)
                temp_conn[to_id].add(from_id)
                links += 1

        system_connectivity = temp_conn
        system_id_to_name = temp_names
        region_name_cache = temp_regions
        log.info(
            f"Connectivity: {len(system_connectivity)} systems, {links} links, {len(region_name_cache)} regions"
        )
    except Exception as e:
        log.error(f"Failed to build system connectivity: {e}")


# ─── Ship Classification ───────────────────────────────────────────────────


def is_npc(type_id: int, killmail_data: dict) -> bool:
    """Check if a ship type ID belongs to an NPC in this killmail context."""
    victim = killmail_data.get("victim", {})
    if victim.get("ship_type_id") == type_id:
        if (
            not victim.get("character_id")
            and 1 < (victim.get("corporation_id") or 0) < 2_000_000
        ):
            return True
        if (victim.get("character_id") or 0) > 3_999_999:
            return False
        if (victim.get("corporation_id") or 0) > 1_999_999:
            return False

    for attacker in killmail_data.get("attackers", []):
        if attacker.get("ship_type_id") == type_id:
            if (attacker.get("character_id") or 0) > 3_999_999:
                return False
            if (attacker.get("corporation_id") or 0) > 1_999_999:
                return False
            if not attacker.get("character_id"):
                return True
    return True


def determine_ship_category(type_id: int, killmail_data: dict | None = None) -> dict:
    """
    Classify a ship type using the in-memory SDE caches.
    Returns: {"category": str, "name": str, "tier": str}
    """
    type_info = type_info_cache.get(type_id)
    if not type_info:
        return {"category": "unknown", "name": f"TypeID {type_id}", "tier": "T1"}

    name = type_info["name"]
    group_id = type_info.get("groupID")
    market_gid = type_info.get("marketGroupID")
    tier = "T1"
    category = "unknown"

    # Special groups
    if group_id == 1180:
        return {"category": "concord", "name": name, "tier": tier}
    if group_id == 29:
        return {"category": "capsule", "name": name, "tier": tier}
    if killmail_data and is_npc(type_id, killmail_data):
        return {"category": "npc", "name": name, "tier": tier}

    # Traverse market group hierarchy
    if not market_gid or not market_group_cache:
        return {"category": category, "name": name, "tier": tier}

    current = market_gid
    visited: set[int] = set()
    while current and current not in visited:
        visited.add(current)
        info = market_group_cache.get(current)
        if not info:
            break

        mg_name = info["name"]
        if "Advanced" in mg_name or mg_name.startswith("Tech II"):
            tier = "T2"

        if category == "unknown":
            if current in PARENT_MARKET_GROUPS["CAPITALS"]:
                category = "capital"
            elif current in PARENT_MARKET_GROUPS["STRUCTURES"]:
                category = "structure"
            elif current in PARENT_MARKET_GROUPS["SHUTTLES"]:
                category = "shuttle"
            elif current in PARENT_MARKET_GROUPS["FIGHTERS"]:
                category = "fighter"
            elif current == PARENT_MARKET_GROUPS["CORVETTES"]:
                category = "corvette"
            elif current in PARENT_MARKET_GROUPS["FRIGATES"]:
                category = "frigate"
            elif current in PARENT_MARKET_GROUPS["DESTROYERS"]:
                category = "destroyer"
            elif current in PARENT_MARKET_GROUPS["CRUISERS"]:
                category = "cruiser"
            elif current in PARENT_MARKET_GROUPS["BATTLECRUISERS"]:
                category = "battlecruiser"
            elif current in PARENT_MARKET_GROUPS["BATTLESHIPS"]:
                category = "battleship"
            elif current == PARENT_MARKET_GROUPS["INDUSTRIAL"]:
                category = "industrial"
            elif current == PARENT_MARKET_GROUPS["MINING"]:
                category = "mining"

        if current == 4 or info["parentId"] is None:
            break
        current = info["parentId"]

    return {"category": category, "name": name, "tier": tier}


async def get_ship_category(
    type_id: int, killmail_data: dict | None = None
) -> dict | None:
    """Get ship category with multi-layer caching: memory → DB → compute."""
    if not type_id:
        return None

    # Memory cache
    if type_id in ship_type_cache:
        return ship_type_cache[type_id]

    # DB cache
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT category, name, tier FROM ship_types WHERE ship_type_id = $1",
                type_id,
            )
            if row and row["name"] and row["tier"]:
                result = {
                    "category": row["category"],
                    "name": row["name"],
                    "tier": row["tier"],
                }
                ship_type_cache[type_id] = result
                return result
    except Exception:
        pass

    # Compute and store
    result = determine_ship_category(type_id, killmail_data)
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO ship_types (ship_type_id, category, name, tier)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (ship_type_id) DO UPDATE
                   SET category=$2, name=$3, tier=$4, last_updated=NOW()""",
                type_id,
                result["category"],
                result["name"],
                result["tier"],
            )
    except Exception as e:
        log.warning(f"Failed to store ship type {type_id}: {e}")

    ship_type_cache[type_id] = result
    return result


async def add_ship_categories(killmail: dict) -> dict:
    """
    Enrich a killmail with ship category data for victim and unique attacker types.
    Adds killmail["shipCategories"] = { victim: {...}, attackers: [...] }
    """
    km_data = killmail.get("killmail", {})
    victim_type = km_data.get("victim", {}).get("ship_type_id")
    victim_cat = await get_ship_category(victim_type, km_data) if victim_type else None

    if not victim_cat:
        return killmail

    attacker_types = {
        a["ship_type_id"] for a in km_data.get("attackers", []) if a.get("ship_type_id")
    }
    attacker_cats = []
    for st in attacker_types:
        cat = await get_ship_category(st, km_data)
        if cat:
            attacker_cats.append({"shipTypeId": st, **cat})

    killmail["shipCategories"] = {"victim": victim_cat, "attackers": attacker_cats}
    return killmail


# ─── Spatial Pinpointing ───────────────────────────────────────────────────


def _distance(a: dict, b: dict) -> float:
    """Euclidean distance between two 3D points (dicts with x,y,z)."""
    return math.sqrt(
        (a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2
    )


def _subtract(a: dict, b: dict) -> dict:
    return {"x": a["x"] - b["x"], "y": a["y"] - b["y"], "z": a["z"] - b["z"]}


def _dot(a: dict, b: dict) -> float:
    return a["x"] * b["x"] + a["y"] * b["y"] + a["z"] * b["z"]


def _cross(a: dict, b: dict) -> dict:
    return {
        "x": a["y"] * b["z"] - a["z"] * b["y"],
        "y": a["z"] * b["x"] - a["x"] * b["z"],
        "z": a["x"] * b["y"] - a["y"] * b["x"],
    }


def _barycentric(p, a, b, c, d):
    """Compute barycentric coordinates of point p in tetrahedron (a,b,c,d)."""
    vap, vbp, vcp, vdp = (
        _subtract(p, a),
        _subtract(p, b),
        _subtract(p, c),
        _subtract(p, d),
    )
    vab, vac, vad = _subtract(b, a), _subtract(c, a), _subtract(d, a)
    total = abs(_dot(_cross(vab, vac), vad) / 6.0)
    if total == 0:
        return None
    v1 = abs(_dot(_cross(vbp, vcp), vdp)) / 6.0
    v2 = abs(_dot(_cross(vap, vcp), vdp)) / 6.0
    v3 = abs(_dot(_cross(vap, vbp), vdp)) / 6.0
    v4 = abs(_dot(_cross(vap, vbp), vcp)) / 6.0
    return {
        "a": v1 / total,
        "b": v2 / total,
        "c": v3 / total,
        "d": v4 / total,
        "total": (v1 + v2 + v3 + v4) / total,
    }


def _in_tetrahedron(point, verts, eps=0.01) -> bool:
    p = {"x": float(point["x"]), "y": float(point["y"]), "z": float(point["z"])}
    a, b, c, d = [
        {"x": float(v["x"]), "y": float(v["y"]), "z": float(v["z"])} for v in verts
    ]
    coords = _barycentric(p, a, b, c, d)
    if not coords:
        return False
    return abs(coords["total"] - 1.0) < eps and all(
        -eps <= coords[k] <= 1 + eps for k in "abcd"
    )


def _tetra_volume(points) -> float:
    a, b, c, d = points
    ab, ac, ad = _subtract(b, a), _subtract(c, a), _subtract(d, a)
    cp = _cross(ab, ac)
    return abs(cp["x"] * ad["x"] + cp["y"] * ad["y"] + cp["z"] * ad["z"]) / 6


def calculate_pinpoints(celestials: list[dict], kill_pos: dict) -> dict:
    """
    Determine where a kill happened relative to celestial objects.
    Returns pinpoint data including nearest celestial and triangulation type.
    """
    if (
        not kill_pos
        or not kill_pos.get("x")
        or not kill_pos.get("y")
        or not kill_pos.get("z")
    ):
        return {
            "hasTetrahedron": False,
            "points": [],
            "atCelestial": False,
            "nearestCelestial": None,
            "triangulationPossible": False,
            "triangulationType": None,
        }

    nearest = None
    min_dist = float("inf")

    for cel in celestials:
        if not cel.get("itemname") or cel.get("x") is None:
            continue
        d = _distance(
            {"x": cel["x"], "y": cel["y"], "z": cel["z"]},
            {"x": kill_pos["x"], "y": kill_pos["y"], "z": kill_pos["z"]},
        )
        if d < min_dist:
            min_dist = d
            nearest = {
                "name": cel["itemname"],
                "distance": d,
                "position": {"x": cel["x"], "y": cel["y"], "z": cel["z"]},
            }

    if nearest:
        if min_dist <= THRESHOLDS["AT_CELESTIAL"]:
            return {
                "hasTetrahedron": False,
                "points": [],
                "atCelestial": True,
                "nearestCelestial": nearest,
                "triangulationPossible": True,
                "triangulationType": "at_celestial",
            }
        if min_dist <= THRESHOLDS["DIRECT_WARP"]:
            return {
                "hasTetrahedron": False,
                "points": [],
                "atCelestial": False,
                "nearestCelestial": nearest,
                "triangulationPossible": True,
                "triangulationType": "direct_warp",
            }
        if min_dist <= THRESHOLDS["NEAR_CELESTIAL"]:
            return {
                "hasTetrahedron": False,
                "points": [],
                "atCelestial": False,
                "nearestCelestial": nearest,
                "triangulationPossible": True,
                "triangulationType": "near_celestial",
            }

    # Tetrahedron check (only if 4+ valid celestials)
    valid = [
        c
        for c in celestials
        if c.get("x") is not None
        and c.get("y") is not None
        and c.get("z") is not None
        and c.get("itemname")
    ]
    best_points: list = []
    min_vol = float("inf")
    tri_type = None

    if len(valid) >= 4:
        # Limit combinatorial search for performance
        check = valid[:40]
        n = len(check)
        for i in range(n - 3):
            for j in range(i + 1, n - 2):
                for k in range(j + 1, n - 1):
                    for ll in range(k + 1, n):
                        verts = [check[i], check[j], check[k], check[ll]]
                        if _in_tetrahedron(kill_pos, verts, THRESHOLDS["EPSILON"]):
                            vol = _tetra_volume(
                                [{"x": v["x"], "y": v["y"], "z": v["z"]} for v in verts]
                            )
                            if vol < min_vol:
                                min_vol = vol
                                best_points = [
                                    {
                                        "name": v["itemname"],
                                        "distance": _distance(
                                            {"x": v["x"], "y": v["y"], "z": v["z"]},
                                            kill_pos,
                                        ),
                                        "position": {
                                            "x": v["x"],
                                            "y": v["y"],
                                            "z": v["z"],
                                        },
                                    }
                                    for v in verts
                                ]
                                tri_type = (
                                    "direct"
                                    if vol < THRESHOLDS["MAX_BOX_SIZE"]
                                    else "via_bookspam"
                                )

    if len(best_points) == 4:
        return {
            "hasTetrahedron": True,
            "points": best_points,
            "atCelestial": False,
            "nearestCelestial": nearest,
            "triangulationPossible": True,
            "triangulationType": tri_type,
        }

    return {
        "hasTetrahedron": False,
        "points": [],
        "atCelestial": False,
        "nearestCelestial": nearest,
        "triangulationPossible": nearest is not None
        and min_dist <= THRESHOLDS["NEAR_CELESTIAL"],
        "triangulationType": None,
    }


def fetch_celestial_data(system_id: int) -> list[dict]:
    """Get celestial objects for a system from the in-memory map cache."""
    sid = str(system_id)
    objects = list(map_cache_by_system.get(sid, []))
    sys_obj = map_cache_by_item.get(sid)
    if sys_obj and not any(o["itemid"] == sid for o in objects):
        objects.insert(0, sys_obj)

    # Enrich with region/system name
    enriched = []
    for obj in objects:
        o = dict(obj)
        o["solarsystemname"] = system_id_to_name.get(
            str(obj.get("solarsystemid", "")), None
        )
        o["regionname"] = region_name_cache.get(str(obj.get("regionid", "")), None)
        enriched.append(o)
    return enriched


# ─── Killmail Processing Pipeline ──────────────────────────────────────────


async def fetch_killmail_from_esi(kill_id: int, kill_hash: str) -> dict | None:
    """
    Fetch the full killmail data from EVE ESI.
    This is needed after the Dec 2025 RedisQ breaking change removed embedded killmail data.
    """
    url = f"{ESI_BASE}/killmails/{kill_id}/{kill_hash}/"
    try:
        resp = await http_client.get(url)
        if resp.status_code == 200:
            return resp.json()
        log.warning(f"ESI returned {resp.status_code} for kill {kill_id}")
        return None
    except Exception as e:
        log.error(f"ESI fetch failed for kill {kill_id}: {e}")
        return None


async def process_killmail(package: dict) -> dict | None:
    """
    Full processing pipeline for one killmail package from RedisQ.

    Steps:
      1. Extract kill ID and zkb data
      2. Fetch full killmail from ESI (post-Dec 2025 change) if needed
      3. Deduplicate via DB
      4. Add ship categories
      5. Calculate spatial pinpoints
      6. Feed to ActivityManager
      7. Broadcast to WebSocket clients
    """
    kill_id = package.get("killID")
    zkb = package.get("zkb", {})

    if not kill_id:
        return None

    # Step 2: Get killmail data — handle both old (embedded) and new (ESI fetch) formats
    km_data = package.get("killmail")
    if not km_data:
        # Post-Dec 2025: fetch from ESI
        kill_hash = zkb.get("hash")
        if not kill_hash:
            log.warning(f"Kill {kill_id}: no hash in zkb, cannot fetch from ESI")
            return None
        km_data = await fetch_killmail_from_esi(kill_id, kill_hash)
        if not km_data:
            return None

    # Validate required fields
    if not km_data.get("killmail_time") or not km_data.get("solar_system_id"):
        log.warning(f"Kill {kill_id}: missing required fields")
        return None
    if not km_data.get("attackers") or not km_data.get("victim"):
        log.warning(f"Kill {kill_id}: missing attackers or victim")
        return None

    # Time check — only process recent kills (6 hours)
    try:
        kill_time = datetime.fromisoformat(
            km_data["killmail_time"].replace("Z", "+00:00")
        )
        if datetime.now(timezone.utc) - kill_time > timedelta(hours=6):
            return None
    except (ValueError, TypeError):
        return None

    # Step 3: DB dedup
    if kill_id in processed_kill_ids:
        return None
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO processed_kill_ids (kill_id) VALUES ($1)", kill_id
            )
        processed_kill_ids.add(kill_id)
    except asyncpg.UniqueViolationError:
        processed_kill_ids.add(kill_id)
        return None
    except Exception as e:
        log.error(f"Kill {kill_id}: DB dedup error: {e}")
        return None

    # Build unified killmail object
    killmail = {"killID": kill_id, "zkb": zkb, "killmail": km_data}

    # Step 4: Ship categories
    killmail = await add_ship_categories(killmail)

    # Step 5: Pinpoints
    system_id = km_data["solar_system_id"]
    position = km_data.get("victim", {}).get("position")

    # Always resolve system/region name from authoritative caches
    sys_name = system_id_to_name.get(str(system_id))
    # Find region for this system
    sys_region_id = None
    sys_region_name = None
    sys_obj = map_cache_by_item.get(str(system_id))
    if sys_obj:
        sys_region_id = sys_obj.get("regionid")
        sys_region_name = (
            region_name_cache.get(str(sys_region_id)) if sys_region_id else None
        )

    if position:
        celestials = fetch_celestial_data(system_id)
        pinpoints = calculate_pinpoints(celestials, position)
    else:
        pinpoints = {
            "hasTetrahedron": False,
            "points": [],
            "atCelestial": False,
            "nearestCelestial": None,
            "triangulationPossible": False,
            "triangulationType": None,
        }

    # Always set celestialData from authoritative caches (not from celestial objects)
    pinpoints["celestialData"] = {
        "regionid": sys_region_id,
        "regionname": sys_region_name,
        "solarsystemid": str(system_id),
        "solarsystemname": sys_name,
    }
    killmail["pinpoints"] = pinpoints

    # Step 6: Activity Manager
    activity_manager.process_killmail(killmail)

    # Step 7: Cache and broadcast
    killmails_cache.append(killmail)
    await broadcast_activity_update()

    log.info(f"Kill {kill_id}: processed (system {system_id})")
    return killmail


# ─── RedisQ Polling ─────────────────────────────────────────────────────────


async def poll_redisq_loop():
    """
    Continuously poll zKillboard RedisQ for new killmail packages.

    Handles the Aug 2025 redirect change (/listen.php → /object.php)
    and the Dec 2025 breaking change (killmail data removed, must fetch from ESI).
    """
    log.info(f"Starting RedisQ poll loop (queueID={REDISQ_QUEUE_ID})")
    consecutive_errors = 0

    while True:
        try:
            url = f"{REDISQ_BASE}?queueID={REDISQ_QUEUE_ID}&ttw=5"
            resp = await http_client.get(url, timeout=httpx.Timeout(35.0))

            if resp.status_code == 429:
                log.warning("RedisQ: rate limited (429), backing off 5s")
                await asyncio.sleep(5)
                continue

            if resp.status_code != 200:
                log.warning(f"RedisQ: HTTP {resp.status_code}")
                await asyncio.sleep(2)
                continue

            data = resp.json()
            package = data.get("package")

            if package is None:
                # No new kills — this is normal, poll again immediately
                consecutive_errors = 0
                await asyncio.sleep(0.1)
                continue

            consecutive_errors = 0
            # Process asynchronously (don't block the poll loop)
            asyncio.create_task(_safe_process(package))

        except httpx.TimeoutException:
            # Timeouts are normal for long-polling
            await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            log.info("RedisQ poll loop cancelled")
            return
        except Exception as e:
            consecutive_errors += 1
            backoff = min(30, 2**consecutive_errors)
            log.error(
                f"RedisQ poll error ({consecutive_errors}): {e}, backing off {backoff}s"
            )
            await asyncio.sleep(backoff)


async def _safe_process(package: dict):
    """Wrapper to catch errors in killmail processing tasks."""
    try:
        await process_killmail(package)
    except Exception as e:
        log.error(
            f"Error processing killmail {package.get('killID', '?')}: {e}",
            exc_info=True,
        )


# ─── Activity Update Loop ──────────────────────────────────────────────────


async def activity_update_loop():
    """Periodically update activity probabilities, expire old activities, and broadcast."""
    while True:
        try:
            await asyncio.sleep(30)
            changed = activity_manager.update_activities()
            if changed:
                # Save expired activities to DB
                for expired in activity_manager.pop_expired():
                    await save_expired_activity(expired)
                await broadcast_activity_update()
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error(f"Activity update error: {e}", exc_info=True)


async def save_expired_activity(activity: dict):
    """Persist a completed activity to the database."""
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO expired_activities
                    (activity_id, classification, system_id, stargate_name,
                     max_probability, start_time, last_kill_time, end_time,
                     total_value, kill_count, details)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (activity_id) DO NOTHING
            """,
                activity["id"],
                activity.get("classification", "unknown"),
                activity.get("systemId"),
                activity.get("stargateName"),
                activity.get("maxProbability", 0),
                datetime.fromtimestamp(
                    activity.get("startTime", 0) / 1000, tz=timezone.utc
                )
                if activity.get("startTime")
                else None,
                datetime.fromtimestamp(
                    activity.get("lastActivity", 0) / 1000, tz=timezone.utc
                )
                if activity.get("lastActivity")
                else None,
                datetime.now(timezone.utc),
                activity.get("totalValue", 0),
                len(activity.get("kills", [])),
                json.dumps(
                    {
                        "members": list(activity.get("members", set())),
                        "systems": activity.get("systems", []),
                        "systemsVisited": activity.get("systemsVisited", 1),
                    }
                ),
            )
    except Exception as e:
        log.error(f"Failed to save expired activity {activity.get('id')}: {e}")


# ─── Cleanup Loop ──────────────────────────────────────────────────────────


async def cleanup_loop():
    """Periodically clean old data from DB and memory."""
    while True:
        try:
            await asyncio.sleep(3600)  # hourly

            # Clean old processed kill IDs (>12h)
            async with db_pool.acquire() as conn:
                result = await conn.execute(
                    "DELETE FROM processed_kill_ids WHERE processed_at < NOW() - INTERVAL '12 hours'"
                )
                log.info(f"Cleanup: removed old processed kill IDs ({result})")

            # Clean in-memory killmail cache (>6h)
            cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
            before = len(killmails_cache)
            killmails_cache[:] = [
                km
                for km in killmails_cache
                if _parse_km_time(km) and _parse_km_time(km) > cutoff
            ]
            removed = before - len(killmails_cache)
            if removed:
                log.info(f"Cleanup: removed {removed} old killmails from cache")

            # Clean in-memory dedup set
            processed_kill_ids.clear()

        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error(f"Cleanup error: {e}")


def _parse_km_time(km: dict) -> datetime | None:
    try:
        t = km.get("killmail", {}).get("killmail_time", "")
        return datetime.fromisoformat(t.replace("Z", "+00:00"))
    except Exception:
        return None


# ─── WebSocket Handling ─────────────────────────────────────────────────────


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    WebSocket endpoint for real-time activity updates.
    Sends current activities on connect, then pushes updates as they arrive.
    """
    await ws.accept()
    ws_clients.add(ws)
    log.info(f"WebSocket connected ({len(ws_clients)} total)")

    try:
        # Send current activities immediately
        activities = (
            activity_manager.get_active_activities() if activity_manager else []
        )
        await ws.send_json({"type": "activityUpdate", "data": activities})

        # Keep alive — listen for client pings or disconnects
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=60)
                if msg == "ping":
                    await ws.send_text("pong")
            except asyncio.TimeoutError:
                # Send keepalive
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text("ping")
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning(f"WebSocket error: {e}")
    finally:
        ws_clients.discard(ws)
        log.info(f"WebSocket disconnected ({len(ws_clients)} total)")


async def broadcast_activity_update():
    """Send current activity list to all connected WebSocket clients."""
    if not activity_manager:
        return
    activities = activity_manager.get_active_activities()
    message = json.dumps({"type": "activityUpdate", "data": activities})

    disconnected: list[WebSocket] = []
    for ws in ws_clients:
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_text(message)
        except Exception:
            disconnected.append(ws)

    for ws in disconnected:
        ws_clients.discard(ws)


# ─── REST API ───────────────────────────────────────────────────────────────


@app.get("/api/activities")
async def get_activities():
    """Get the current list of active activities (for non-WebSocket clients)."""
    if not activity_manager:
        return []
    return activity_manager.get_active_activities()


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "websocket_clients": len(ws_clients),
        "cached_killmails": len(killmails_cache),
        "active_activities": len(activity_manager.get_active_activities())
        if activity_manager
        else 0,
        "map_systems": len(map_cache_by_system),
        "ship_types_cached": len(ship_type_cache),
    }


# ─── Static File Serving (production: serves the built React app) ──────────

# Mount static files last so API routes take priority
# In production, the React build output goes into ./frontend/dist
import pathlib

_frontend_dist = pathlib.Path(__file__).parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount(
        "/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend"
    )


# ─── Entrypoint ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False, log_level="info")
