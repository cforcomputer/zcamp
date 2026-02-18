"""
activity_manager.py — Activity Detection & Classification
==========================================================
Detects and tracks EVE Online PvP activities from killmail streams:
  - Gate camps (stationary kills at a stargate)
  - Smartbomb camps (gate camps using smartbomb weapons)
  - Roaming camps (camp-like behavior across multiple systems)
  - Gangs / Roams (groups moving through systems getting kills)
  - Battles (large engagements with 40+ participants)

The ActivityManager is a pure in-memory state machine:
  - process_killmail() ingests enriched killmails
  - update_activities() decays probabilities and expires old activities
  - get_active_activities() returns serializable activity list for the frontend

Architecture:
  - Activities are stored in a dict keyed by activity ID
  - Camp IDs: "{systemId}-{stargateName}"
  - Roam IDs: "roam-{timestamp}-{random}"
  - Each activity has kills, members, visited systems, and computed metrics
  - Classification is re-evaluated on every kill and periodic update
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

log = logging.getLogger("activity_manager")

# ─── Timeouts ───────────────────────────────────────────────────────────────

CAMP_TIMEOUT_MS = 30 * 60 * 1000  # 30 minutes — camp expires after this inactivity
ROAM_TIMEOUT_MS = 15 * 60 * 1000  # 15 minutes — roam expires faster
DECAY_START_MS = 5 * 60 * 1000  # 5 minutes — probability starts decaying after no kills
CAPSULE_ID = 670
MTU_ID = 35834

# ─── Probability Factors ────────────────────────────────────────────────────
# Ship type IDs that indicate camp-like behavior (dictors, HICs, etc.)

THREAT_SHIPS: dict[int, float] = {
    # Interdictors
    22456: 0.15,
    22452: 0.15,
    22460: 0.15,
    22464: 0.15,
    # Heavy Interdiction Cruisers
    12729: 0.20,
    12731: 0.20,
    12733: 0.20,
    12735: 0.20,
    # Command Destroyers (boosh)
    37483: 0.10,
    37480: 0.10,
    37482: 0.10,
    37481: 0.10,
    # Recon Ships (combat)
    11957: 0.08,
    11959: 0.08,
    11961: 0.08,
    11963: 0.08,
    # Recon Ships (force)
    11969: 0.12,
    11971: 0.12,
    11965: 0.12,
    11967: 0.12,
}

SMARTBOMB_SHIPS: dict[int, bool] = {
    # Battleships commonly used for smartbombing
    17726: True,  # Apocalypse Navy Issue
    17636: True,  # Raven Navy Issue
    24690: True,  # Nightmare
    17728: True,  # Armageddon Navy Issue
    645: True,  # Dominix
    24688: True,  # Machariel
}

# Weapon type IDs for smartbombs (energy, kinetic, thermal, em, explosive)
SMARTBOMB_WEAPONS: set[int] = {
    3170,
    3172,
    3174,
    3176,  # Small
    3178,
    3180,
    3182,
    3184,  # Medium
    3186,
    3188,
    3190,
    3192,  # Large
    14268,
    14270,
    14272,
    14274,  # Faction
}

# Known permanent camp locations {systemId: {"gates": [...], "weight": float}}
PERMANENT_CAMPS: dict[int, dict] = {
    30003504: {"gates": ["Miroitem"], "weight": 0.15},  # HED-GP
    30004759: {"gates": ["Tama"], "weight": 0.12},  # Old Man Star → Tama
    30002538: {"gates": ["Rancer"], "weight": 0.15},  # Rancer
    30002187: {"gates": ["Uedama"], "weight": 0.12},  # Uedama
    30005196: {"gates": ["Ahbazon"], "weight": 0.12},  # Ahbazon
}

SHIP_CATEGORIES = {
    "INDUSTRIAL": "industrial",
    "MINING": "mining",
}


# ─── Helpers ────────────────────────────────────────────────────────────────


def _now_ms() -> int:
    """Current time in milliseconds (matching JS Date.now())."""
    return int(time.time() * 1000)


def _generate_roam_id() -> str:
    return f"roam-{_now_ms()}-{random.randbytes(3).hex()}"


def _kill_time_ms(killmail: dict) -> int:
    """Extract kill time as epoch milliseconds from a killmail."""
    from datetime import datetime, timezone

    try:
        t = killmail["killmail"]["killmail_time"]
        dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return _now_ms()


def _serialize_activity(activity: dict) -> dict:
    """
    Convert an activity to a JSON-serializable dict for the frontend.
    Sets and other non-serializable types are converted.
    """
    a = dict(activity)
    # Convert sets to lists
    for key in (
        "members",
        "visitedSystems",
        "originalAttackers",
        "activeAttackers",
        "killedAttackers",
    ):
        if key in a and isinstance(a[key], set):
            a[key] = list(a[key])
    # Convert composition sets
    comp = a.get("composition", {})
    if isinstance(comp, dict):
        for ck in ("originalAttackers", "activeAttackers", "killedAttackers"):
            if ck in comp and isinstance(comp[ck], set):
                comp[ck] = list(comp[ck])
    # Strip full killmail data from kills to keep payload small
    if "kills" in a:
        a["kills"] = [
            {
                "killID": k.get("killID"),
                "zkb": {
                    "totalValue": k.get("zkb", {}).get("totalValue", 0),
                    "labels": k.get("zkb", {}).get("labels", []),
                },
                "killmail": {
                    "killmail_time": k.get("killmail", {}).get("killmail_time"),
                    "solar_system_id": k.get("killmail", {}).get("solar_system_id"),
                    "victim": {
                        "ship_type_id": k.get("killmail", {})
                        .get("victim", {})
                        .get("ship_type_id"),
                        "character_id": k.get("killmail", {})
                        .get("victim", {})
                        .get("character_id"),
                    },
                },
                "shipCategories": k.get("shipCategories"),
            }
            for k in a.get("kills", [])
        ]
    return a


# ─── ActivityManager ────────────────────────────────────────────────────────


class ActivityManager:
    """
    Manages all active PvP activities detected from the killmail stream.

    Core data structure:
      _activities: dict[str, dict]  — maps activity ID → activity state

    Each activity dict contains:
      id, type, classification, systemId, stargateName,
      kills, totalValue, lastKill, firstKillTime, lastActivity,
      composition, metrics, probability, maxProbability,
      visitedSystems, systemsVisited, members, systems, lastSystem,
      startTime
    """

    def __init__(self):
        self._activities: dict[str, dict] = {}
        self._expired_queue: list[dict] = []

    # ── Public API ──────────────────────────────────────────────────────

    def get_active_activities(self) -> list[dict]:
        """Return serializable list of current activities, sorted by probability then recency."""
        now = _now_ms()
        result = []
        for act in self._activities.values():
            timeout = (
                CAMP_TIMEOUT_MS
                if act["classification"]
                in ("camp", "smartbomb", "roaming_camp", "battle")
                else ROAM_TIMEOUT_MS
            )
            last_event = (
                act.get("lastActivity")
                or act.get("lastKill")
                or act.get("startTime")
                or act.get("firstKillTime", now)
            )
            if now - last_event <= timeout:
                result.append(act)

        result.sort(
            key=lambda a: (-(a.get("probability") or 0), -(a.get("lastActivity") or 0))
        )
        return [_serialize_activity(a) for a in result]

    def process_killmail(self, killmail: dict) -> None:
        """
        Ingest a new killmail and update/create activities.

        Flow:
          1. If kill is at a stargate → update or create camp activity
          2. If 2+ attackers → check for roam match or create new roam
          3. Recalculate classifications and probabilities
        """
        now = _now_ms()
        kill_time = _kill_time_ms(killmail)
        km_data = killmail.get("killmail", {})
        system_id = km_data.get("solar_system_id")
        pinpoints = killmail.get("pinpoints", {})
        celestial_data = pinpoints.get("celestialData", {})

        system_name = celestial_data.get("solarsystemname") or str(system_id)
        region_name = celestial_data.get("regionname")
        stargate_name = (pinpoints.get("nearestCelestial") or {}).get("name")

        # ── Camp detection ──
        camp_id = None
        is_at_stargate = False
        if (
            stargate_name
            and "stargate" in stargate_name.lower()
            and self._is_gate_camp_kill(killmail)
        ):
            camp_id = f"{system_id}-{stargate_name}"
            is_at_stargate = True

        # ── Attacker IDs ──
        attacker_ids: set[int] = set()
        for a in km_data.get("attackers", []):
            cid = a.get("character_id")
            if cid and a.get("ship_type_id") != CAPSULE_ID:
                attacker_ids.add(cid)

        updated_ids: set[str] = set()

        # ── Update/create camp ──
        if is_at_stargate and camp_id:
            camp = self._activities.get(camp_id)
            if not camp:
                camp = self._new_activity(
                    camp_id, "camp", system_id, system_name, region_name, kill_time
                )
                camp["stargateName"] = stargate_name
                self._activities[camp_id] = camp
                log.info(f"New camp: {camp_id}")

            self._add_kill_to_activity(
                camp,
                killmail,
                kill_time,
                now,
                system_id,
                system_name,
                region_name,
                attacker_ids,
            )
            if self._has_smartbombs([killmail]) and camp["type"] != "smartbomb":
                camp["type"] = "smartbomb"
            camp["metrics"] = self._get_metrics(camp["kills"], now)
            camp["probability"] = self._calculate_camp_probability(camp)
            camp["classification"] = self._determine_classification(camp)
            updated_ids.add(camp_id)

        # ── Update/create roam ──
        if len(attacker_ids) >= 2:
            matched_roam_id = None
            for aid, act in self._activities.items():
                if aid == camp_id:
                    continue
                members = act.get("members", set())
                if isinstance(members, list):
                    members = set(members)
                if not members:
                    continue
                if any(a in members for a in attacker_ids):
                    matched_roam_id = aid
                    break

            if matched_roam_id:
                act = self._activities[matched_roam_id]
                self._add_kill_to_activity(
                    act,
                    killmail,
                    kill_time,
                    now,
                    system_id,
                    system_name,
                    region_name,
                    attacker_ids,
                )
                act["metrics"] = self._get_metrics(act["kills"], now)
                act["probability"] = self._calculate_camp_probability(act)
                act["classification"] = self._determine_classification(act)
                updated_ids.add(matched_roam_id)

            elif not camp_id or camp_id not in updated_ids:
                roam_id = _generate_roam_id()
                roam = self._new_activity(
                    roam_id, "roam", system_id, system_name, region_name, kill_time
                )
                self._add_kill_to_activity(
                    roam,
                    killmail,
                    kill_time,
                    now,
                    system_id,
                    system_name,
                    region_name,
                    attacker_ids,
                )
                roam["metrics"] = self._get_metrics(roam["kills"], now)
                roam["classification"] = self._determine_classification(roam)
                self._activities[roam_id] = roam
                updated_ids.add(roam_id)
                log.info(f"New roam: {roam_id}")

    def update_activities(self) -> bool:
        """
        Periodic update: recalculate probabilities, expire old activities.
        Returns True if anything changed.
        """
        now = _now_ms()
        to_keep: dict[str, dict] = {}
        changed = False

        for aid, act in self._activities.items():
            timeout = (
                CAMP_TIMEOUT_MS
                if act["classification"]
                in ("camp", "smartbomb", "roaming_camp", "battle")
                else ROAM_TIMEOUT_MS
            )
            last_event = (
                act.get("lastActivity")
                or act.get("lastKill")
                or act.get("startTime")
                or act.get("firstKillTime", now)
            )

            if now - last_event <= timeout:
                prev_prob = act["probability"]
                prev_class = act["classification"]

                if act["classification"] in (
                    "camp",
                    "smartbomb",
                    "roaming_camp",
                    "battle",
                ) or act.get("stargateName"):
                    act["probability"] = self._calculate_camp_probability(act)
                act["classification"] = self._determine_classification(act)

                if (
                    act["probability"] != prev_prob
                    or act["classification"] != prev_class
                ):
                    changed = True
                to_keep[aid] = act
            else:
                # Expired
                changed = True
                if act.get("stargateName") and act["classification"] in (
                    "camp",
                    "smartbomb",
                    "roaming_camp",
                    "battle",
                ):
                    self._expired_queue.append(act)

        self._activities = to_keep
        return changed

    def pop_expired(self) -> list[dict]:
        """Pop and return all activities queued for DB persistence."""
        expired = self._expired_queue[:]
        self._expired_queue.clear()
        return expired

    # ── Activity Construction ───────────────────────────────────────────

    def _new_activity(
        self,
        aid: str,
        atype: str,
        system_id: int,
        system_name: str,
        region_name: str | None,
        kill_time: int,
    ) -> dict:
        return {
            "id": aid,
            "type": atype,
            "classification": atype,
            "systemId": system_id,
            "stargateName": None,
            "kills": [],
            "totalValue": 0,
            "lastKill": None,
            "firstKillTime": kill_time,
            "latestKillTime": _now_ms(),
            "composition": {
                "originalAttackers": set(),
                "activeAttackers": set(),
                "killedAttackers": set(),
                "involvedCorporations": [],
                "involvedAlliances": [],
                "originalCount": 0,
                "activeCount": 0,
                "killedCount": 0,
                "numCorps": 0,
                "numAlliances": 0,
            },
            "metrics": {},
            "probability": 0,
            "maxProbability": 0,
            "visitedSystems": {system_id},
            "systemsVisited": 1,
            "members": set(),
            "systems": [
                {
                    "id": system_id,
                    "name": system_name,
                    "region": region_name,
                    "time": kill_time,
                }
            ],
            "lastSystem": {"id": system_id, "name": system_name, "region": region_name},
            "startTime": kill_time,
            "lastActivity": kill_time,
        }

    def _add_kill_to_activity(
        self,
        act: dict,
        killmail: dict,
        kill_time: int,
        now: int,
        system_id: int,
        system_name: str,
        region_name: str | None,
        attacker_ids: set[int],
    ):
        """Add a kill to an existing activity and update its state."""
        kill_id = killmail.get("killID")
        if any(k.get("killID") == kill_id for k in act["kills"]):
            return  # duplicate

        act["kills"].append(killmail)
        act["totalValue"] += (killmail.get("zkb") or {}).get("totalValue", 0)
        act["lastKill"] = killmail.get("killmail", {}).get("killmail_time")
        act["latestKillTime"] = now
        act["lastActivity"] = kill_time

        # Systems — ensure visitedSystems is a set
        if isinstance(act.get("visitedSystems"), list):
            act["visitedSystems"] = set(act["visitedSystems"])
        last_sys = act["systems"][-1] if act["systems"] else None
        if not last_sys or last_sys["id"] != system_id:
            act["systems"].append(
                {
                    "id": system_id,
                    "name": system_name,
                    "region": region_name,
                    "time": kill_time,
                }
            )
        act["visitedSystems"].add(system_id)
        act["systemsVisited"] = len(act["visitedSystems"])
        act["lastSystem"] = {
            "id": system_id,
            "name": system_name,
            "region": region_name,
        }

        # Members — ensure members is a set
        if isinstance(act.get("members"), list):
            act["members"] = set(act["members"])
        act["members"] = act["members"] | attacker_ids

        # Composition
        self._update_composition(act, killmail)

    def _update_composition(self, act: dict, killmail: dict):
        """Update attacker/victim composition tracking for the activity."""
        comp = act["composition"]
        km = killmail.get("killmail", {})

        # Ensure these are always sets (they may have been converted to lists by serialization)
        for key in ("originalAttackers", "activeAttackers", "killedAttackers"):
            if isinstance(comp.get(key), list):
                comp[key] = set(comp[key])
            elif not isinstance(comp.get(key), set):
                comp[key] = set()

        if isinstance(act.get("members"), list):
            act["members"] = set(act["members"])

        for attacker in km.get("attackers", []):
            cid = attacker.get("character_id")
            if not cid:
                continue
            act["members"].add(cid)
            comp["originalAttackers"].add(cid)
            if cid not in comp["killedAttackers"]:
                comp["activeAttackers"].add(cid)
            corp = attacker.get("corporation_id")
            if corp and corp not in comp["involvedCorporations"]:
                comp["involvedCorporations"].append(corp)
            alli = attacker.get("alliance_id")
            if alli and alli not in comp["involvedAlliances"]:
                comp["involvedAlliances"].append(alli)

        victim = km.get("victim", {})
        vcid = victim.get("character_id")
        if vcid:
            act["members"].add(vcid)
            if vcid in comp["activeAttackers"]:
                comp["activeAttackers"].discard(vcid)
                comp["killedAttackers"].add(vcid)
            vcorp = victim.get("corporation_id")
            if vcorp and vcorp not in comp["involvedCorporations"]:
                comp["involvedCorporations"].append(vcorp)
            valli = victim.get("alliance_id")
            if valli and valli not in comp["involvedAlliances"]:
                comp["involvedAlliances"].append(valli)

        comp["originalCount"] = len(comp["originalAttackers"])
        comp["activeCount"] = len(comp["activeAttackers"])
        comp["killedCount"] = len(comp["killedAttackers"])
        comp["numCorps"] = len(set(comp["involvedCorporations"]))
        comp["numAlliances"] = len(set(comp["involvedAlliances"]))

    # ── Classification ──────────────────────────────────────────────────

    def _determine_classification(self, activity: dict) -> str:
        """
        Classify an activity based on its properties.

        Priority order:
          1. Smartbomb (type override)
          2. Battle (40+ participants)
          3. Roaming camp (multi-system, camp-like probability)
          4. Camp (single system, camp-like probability)
          5. Roam (multi-system)
          6. Activity (fallback)
        """
        prob = activity.get("probability", 0)
        is_camp_like = prob >= 5
        systems_visited = len(activity.get("visitedSystems", set()))
        participants = activity.get("metrics", {}).get("partyMetrics", {}).get(
            "characters", 0
        ) or len(activity.get("members", set()))

        if activity.get("type") == "smartbomb":
            return "smartbomb"
        if participants >= 40:
            return "battle"
        if systems_visited > 1 and is_camp_like:
            return "roaming_camp"
        if is_camp_like:
            return "camp"
        if systems_visited > 1:
            return "roam"
        return "activity"

    # ── Probability Calculation ─────────────────────────────────────────

    def _calculate_camp_probability(self, activity: dict) -> int:
        """
        Calculate the probability (0-100) that an activity is a gate camp.

        Stages:
          1. Filter out irrelevant kills (AWOX, NPC, structure, MTU)
          2. Burst penalty for rapid kills in young camps
          3. Threat ship score (interdictors, HICs, etc.)
          4. Smartbomb bonus
          5. Known camping location bonus
          6. Vulnerable victim bonus (industrials, mining ships)
          7. Attacker consistency bonus (same people on multiple kills)
          8. Widely-spaced kill bonus (sustained camping)
          9. Pod kill bonus
         10. Pre-decay capping
         11. Time decay after inactivity
         12. Final normalization and minimum threshold
        """
        all_kills = activity.get("kills", [])
        now = _now_ms()

        # ── Stage 1: Filter kills ──
        kills_for_prob = []
        for kill in all_kills:
            zkb = kill.get("zkb", {})
            km = kill.get("killmail", {})
            victim = km.get("victim", {})

            if zkb.get("awox"):
                continue
            if (
                victim.get("corporation_id") and not victim.get("character_id")
            ) or "npc" in (zkb.get("labels") or []):
                continue
            sc = kill.get("shipCategories", {})
            if isinstance(sc, dict) and sc.get("victim") in ("structure",):
                continue
            vic_cat = sc.get("victim", {}) if isinstance(sc, dict) else {}
            if isinstance(vic_cat, dict) and vic_cat.get("category") == "structure":
                continue
            if victim.get("ship_type_id") == MTU_ID:
                continue
            attackers = km.get("attackers", [])
            has_player = any(
                a.get("character_id") or a.get("faction_id") for a in attackers
            )
            if not has_player and attackers:
                continue
            kills_for_prob.append(kill)

        if not kills_for_prob:
            return 0

        # Gate-specific filter
        gate_kills = (
            [k for k in kills_for_prob if self._is_gate_camp_kill(k)]
            if activity.get("stargateName")
            else []
        )
        if activity.get("stargateName") and not gate_kills:
            return 0

        relevant = gate_kills if activity.get("stargateName") else kills_for_prob

        # Separate ship and pod kills
        ship_kills = sorted(
            [
                k
                for k in relevant
                if k.get("killmail", {}).get("victim", {}).get("ship_type_id")
                != CAPSULE_ID
            ],
            key=lambda k: _kill_time_ms(k),
        )
        pod_kills = [
            k
            for k in relevant
            if k.get("killmail", {}).get("victim", {}).get("ship_type_id") == CAPSULE_ID
        ]

        if not ship_kills and not pod_kills:
            return 0

        last_event = (
            activity.get("lastKill")
            or activity.get("lastActivity")
            or activity.get("firstKillTime", now)
        )
        if isinstance(last_event, str):
            from datetime import datetime, timezone

            try:
                last_event = int(
                    datetime.fromisoformat(
                        last_event.replace("Z", "+00:00")
                    ).timestamp()
                    * 1000
                )
            except Exception:
                last_event = now
        minutes_since = (now - last_event) / 60_000

        base = 0.0

        # ── Stage 2: Burst penalty ──
        if len(ship_kills) > 1:
            kill_times = [_kill_time_ms(k) for k in ship_kills]
            first_kill = activity.get("firstKillTime", now)
            camp_age = (now - first_kill) / 60_000
            BURST_MS = 120_000
            has_burst = any(
                kill_times[i] - kill_times[i - 1] < BURST_MS
                for i in range(1, len(kill_times))
            )
            if camp_age <= 15 and has_burst:
                base -= 0.20

        # ── Stage 3: Threat ships ──
        threat_score = 0.0
        if ship_kills:
            for kill in ship_kills:
                for attacker in kill.get("killmail", {}).get("attackers", []):
                    st = attacker.get("ship_type_id")
                    if st and st in THREAT_SHIPS:
                        threat_score += THREAT_SHIPS[st]
            capped = min(0.5, threat_score)
            base += capped

        # ── Stage 4: Smartbomb bonus ──
        if activity.get("type") == "smartbomb":
            sb_bonus = 0.16
            has_sb_ship = any(
                any(
                    SMARTBOMB_SHIPS.get(a.get("ship_type_id"))
                    for a in k.get("killmail", {}).get("attackers", [])
                )
                for k in all_kills
            )
            if has_sb_ship:
                sb_bonus += 0.30 if len(ship_kills) > 1 else 0.15
            base += sb_bonus

        # ── Stage 5: Known location ──
        if activity.get("stargateName"):
            camp_info = PERMANENT_CAMPS.get(activity.get("systemId"))
            if camp_info:
                if any(
                    g.lower() in activity["stargateName"].lower()
                    for g in camp_info["gates"]
                ):
                    base += camp_info["weight"]

        # ── Stage 6: Vulnerable victims ──
        vuln_count = sum(
            1
            for k in ship_kills
            if isinstance(k.get("shipCategories", {}).get("victim"), dict)
            and k["shipCategories"]["victim"].get("category")
            in ("industrial", "mining")
        )
        if vuln_count > 0:
            base += 0.40 if vuln_count > 1 else 0.20

        # ── Stage 7: Consistency ──
        if len(ship_kills) >= 2:
            check = ship_kills[-3:]
            if len(check) >= 2:
                kt = [_kill_time_ms(k) for k in check]
                is_burst = any(kt[i] - kt[i - 1] < 120_000 for i in range(1, len(kt)))
                skip = False
                if is_burst:
                    corps = [
                        k["killmail"]["victim"].get("corporation_id")
                        for k in check
                        if k["killmail"]["victim"].get("corporation_id")
                    ]
                    allis = [
                        k["killmail"]["victim"].get("alliance_id")
                        for k in check
                        if k["killmail"]["victim"].get("alliance_id")
                    ]
                    if (len(corps) == len(check) and len(set(corps)) == 1) or (
                        len(allis) == len(check) and len(set(allis)) == 1
                    ):
                        skip = True

                if not skip:
                    consistency = 0.0
                    latest_attackers = {
                        a["character_id"]
                        for a in check[-1].get("killmail", {}).get("attackers", [])
                        if a.get("character_id")
                    }
                    for i in range(len(check) - 2, -1, -1):
                        prev = {
                            a["character_id"]
                            for a in check[i].get("killmail", {}).get("attackers", [])
                            if a.get("character_id")
                        }
                        overlap = latest_attackers & prev
                        min_overlap = max(2, len(prev) // 3)
                        if len(overlap) >= min_overlap and len(overlap) >= 2:
                            consistency += 0.15
                    base += min(0.30, consistency)

        # ── Stage 8: Widely spaced ──
        if len(ship_kills) >= 2:
            ktimes = [_kill_time_ms(k) for k in ship_kills]
            spaced_bonus = 0.0
            for i in range(1, len(ktimes)):
                if ktimes[i] - ktimes[i - 1] > 300_000:  # 5 min
                    spaced_bonus += 0.15
            base += min(0.45, spaced_bonus)

        # ── Stage 9: Pod bonus ──
        if pod_kills:
            pod_bonus = min(0.15, len(pod_kills) * 0.03)
            base += pod_bonus

        # ── Stage 10: Cap ──
        base = max(0.0, min(0.95, base))

        # ── Stage 11: Decay ──
        decay_start = DECAY_START_MS / 60_000
        if minutes_since > decay_start:
            decay_min = minutes_since - decay_start
            decay_pct = min(1.0, decay_min * 0.10)
            base *= 1 - decay_pct

        # ── Stage 12: Final ──
        base = max(0.0, min(0.95, base))
        pct = round(base * 100)

        if pct < 5:
            return 0

        activity["maxProbability"] = max(activity.get("maxProbability", 0), pct)
        return pct

    # ── Metrics ─────────────────────────────────────────────────────────

    def _get_metrics(self, kills: list[dict], now: int) -> dict:
        """Calculate timing and composition metrics for an activity's kills."""
        if not kills:
            return {
                "firstSeen": now,
                "campDuration": 0,
                "activeDuration": 0,
                "inactivityDuration": 0,
                "podKills": 0,
                "killFrequency": 0,
                "avgValuePerKill": 0,
                "shipCounts": {},
                "partyMetrics": {"characters": 0, "corporations": 0, "alliances": 0},
            }

        times = [_kill_time_ms(k) for k in kills]
        valid_times = [t for t in times if t > 0]
        if not valid_times:
            return {
                "firstSeen": now,
                "campDuration": 0,
                "activeDuration": 0,
                "inactivityDuration": 0,
                "podKills": 0,
                "killFrequency": 0,
                "avgValuePerKill": 0,
                "shipCounts": {},
                "partyMetrics": {"characters": 0, "corporations": 0, "alliances": 0},
            }

        earliest = min(valid_times)
        latest = max(valid_times)
        total_dur = (now - earliest) // 60_000
        active_dur = max(1, (latest - earliest) // 60_000) if latest > earliest else 0
        inactivity = (now - latest) // 60_000

        chars: set = set()
        corps: set = set()
        allis: set = set()
        ship_counts: dict[int, int] = {}

        for kill in kills:
            km = kill.get("killmail", {})
            for a in km.get("attackers", []):
                if a.get("character_id"):
                    chars.add(a["character_id"])
                if a.get("corporation_id"):
                    corps.add(a["corporation_id"])
                if a.get("alliance_id"):
                    allis.add(a["alliance_id"])
                st = a.get("ship_type_id")
                if st:
                    ship_counts[st] = ship_counts.get(st, 0) + 1
            v = km.get("victim", {})
            if v.get("character_id"):
                chars.add(v["character_id"])
            if v.get("corporation_id"):
                corps.add(v["corporation_id"])
            if v.get("alliance_id"):
                allis.add(v["alliance_id"])

        total_val = sum(k.get("zkb", {}).get("totalValue", 0) for k in kills)
        pod_count = sum(
            1
            for k in kills
            if k.get("killmail", {}).get("victim", {}).get("ship_type_id") == CAPSULE_ID
        )

        return {
            "firstSeen": earliest,
            "campDuration": total_dur,
            "activeDuration": active_dur,
            "inactivityDuration": inactivity,
            "podKills": pod_count,
            "killFrequency": len(kills) / active_dur if active_dur > 0 else 0,
            "avgValuePerKill": total_val / len(kills) if kills else 0,
            "shipCounts": ship_counts,
            "partyMetrics": {
                "characters": len(chars),
                "corporations": len(corps),
                "alliances": len(allis),
            },
        }

    # ── Detection Helpers ───────────────────────────────────────────────

    def _is_gate_camp_kill(self, killmail: dict) -> bool:
        """Check if a kill occurred near a stargate based on pinpoint data."""
        pp = killmail.get("pinpoints", {})
        nc = pp.get("nearestCelestial", {})
        if not nc or not nc.get("name"):
            return False
        if "stargate" not in nc["name"].lower():
            return False
        return pp.get("atCelestial") or pp.get("triangulationType") in (
            "direct_warp",
            "near_celestial",
        )

    def _has_smartbombs(self, kills: list[dict]) -> bool:
        """Check if any kills in the list involved smartbomb weapons."""
        for kill in kills:
            for a in kill.get("killmail", {}).get("attackers", []):
                wid = a.get("weapon_type_id")
                if wid and wid in SMARTBOMB_WEAPONS:
                    return True
        return False
