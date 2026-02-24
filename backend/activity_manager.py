"""
activity_manager.py — Crew-Centric Activity Detection & Classification
=======================================================================
Rewritten to track CREWS (groups of players) rather than LOCATIONS.

A crew is identified by character overlap + corp/alliance anchor.
Classification (camp, roam, battle, etc.) is derived from what the
crew is *doing*, not where they are.

Key changes from previous version:
  - Activities keyed by crew identity, not location
  - Member status tracking (active / idle / departed)
  - Crew matching algorithm replaces location lookup
  - Classification derived from behavioral signals
  - Duration reflects crew lifetime, not location lifetime
  - Crew dissolution detection (members logging off)

Patch notes (gate-kill ratio fix):
  - Pod kills that follow a ship kill from the same victim are no longer
    counted in the gate-kill ratio (neither numerator nor denominator).
    This prevents follow-up pods from diluting the ratio and causing
    gate camps to lose their stargate_name, which cascaded into
    misclassification as "roam" / "gang".
  - _count_effective_kills() computes the denominator excluding follow-up pods.
  - _update_spatial_state() only increments gate_kill_count for orphan pods.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

from constants import (
    BATTLE_PARTICIPANT_THRESHOLD,
    BURST_PENALTY,
    CAMP_TIMEOUT_MS,
    CAPSULE_ID,
    CONSISTENCY_BONUS,
    DECAY_RATE_PER_MIN,
    DECAY_START_MS,
    MAX_CONSISTENCY_BONUS,
    MAX_POD_BONUS,
    MAX_WIDELY_SPACED_BONUS,
    MIN_PROB_THRESHOLD,
    MTU_ID,
    OVERALL_PROB_CAP,
    PERMANENT_CAMPS,
    POD_BONUS_PER_KILL,
    ROAM_TIMEOUT_MS,
    SMARTBOMB_SHIPS,
    SMARTBOMB_WEAPON_IDS,
    THREAT_SCORE_CAP,
    THREAT_SHIPS,
    WIDELY_SPACED_BONUS,
)

log = logging.getLogger("activity_manager")

# ─── Crew-Centric Constants ────────────────────────────────────────────────

# Crew matching weights
MATCH_THRESHOLD = 0.35  # minimum score to match a kill to a crew
CHAR_OVERLAP_WEIGHT = 0.50  # character overlap is the strongest signal
CORP_ALLIANCE_WEIGHT = 0.25  # shared corp/alliance
SPATIAL_WEIGHT = 0.15  # same or adjacent system
TEMPORAL_WEIGHT = 0.10  # recency of last kill

# Member status timeouts
MEMBER_IDLE_TIMEOUT_MS = 15 * 60_000  # 15 min no kills → idle
MEMBER_DEPARTED_TIMEOUT_MS = 45 * 60_000  # 45 min no kills → departed

# Crew lifecycle
CREW_EXPIRY_TIMEOUT_MS = 60 * 60_000  # 60 min no kills → expire entire crew
CREW_MIN_KILLS_TO_SAVE = 2  # need at least 2 kills to save to DB

# Dissolution: if <30% of crew active AND fewer than this many, crew is dead
DISSOLUTION_ACTIVE_RATIO = 0.30
DISSOLUTION_MIN_ACTIVE = 2

# For spatial checks — will be injected from server.py
_system_connectivity: dict[str, set] | None = None


def set_system_connectivity(connectivity: dict[str, set]):
    """Called by server.py after building the connectivity map."""
    global _system_connectivity
    _system_connectivity = connectivity


# ─── Helpers ────────────────────────────────────────────────────────────────


def _now_ms() -> int:
    return int(time.time() * 1000)


def _generate_crew_id() -> str:
    return f"crew-{_now_ms()}-{random.randbytes(4).hex()}"


def _kill_time_ms(killmail: dict) -> int:
    from datetime import datetime, timezone

    try:
        t = killmail["killmail"]["killmail_time"]
        dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return _now_ms()


def _is_adjacent_system(sys_a: int, sys_b: int) -> bool:
    """Check if two systems are connected by a stargate."""
    if _system_connectivity is None:
        return False
    neighbors = _system_connectivity.get(str(sys_a), set())
    return str(sys_b) in neighbors


def _extract_attacker_info(km_data: dict) -> tuple[set[int], set[int], set[int]]:
    """
    Extract character IDs, corp IDs, alliance IDs from attackers.
    Filters out pods and NPCs (no character_id).
    """
    char_ids: set[int] = set()
    corp_ids: set[int] = set()
    alliance_ids: set[int] = set()

    for a in km_data.get("attackers", []):
        cid = a.get("character_id")
        if not cid:
            continue
        if a.get("ship_type_id") == CAPSULE_ID:
            continue
        char_ids.add(cid)
        if a.get("corporation_id"):
            corp_ids.add(a["corporation_id"])
        if a.get("alliance_id"):
            alliance_ids.add(a["alliance_id"])

    return char_ids, corp_ids, alliance_ids


def _attacker_count(killmail: dict) -> int:
    """Count player attackers (non-pod, has character_id) on a kill."""
    return sum(
        1
        for a in killmail.get("killmail", {}).get("attackers", [])
        if a.get("character_id") and a.get("ship_type_id") != CAPSULE_ID
    )


def _is_followup_pod(killmail: dict, earlier_kills: list[dict]) -> bool:
    """
    Check if a pod kill is a follow-up to an earlier ship kill from the
    same victim.  If so, it should not count independently in gate-kill
    ratios or probability denominators — the ship kill already represents
    this engagement.
    """
    victim = killmail.get("killmail", {}).get("victim", {})
    if victim.get("ship_type_id") != CAPSULE_ID:
        return False  # not a pod

    victim_id = victim.get("character_id")
    if not victim_id:
        return False  # can't match without a character

    for k in earlier_kills:
        kv = k.get("killmail", {}).get("victim", {})
        if kv.get("character_id") == victim_id and kv.get("ship_type_id") != CAPSULE_ID:
            return True  # found a matching ship kill → this pod is a follow-up

    return False


# ─── Member State ───────────────────────────────────────────────────────────


@dataclass
class MemberState:
    character_id: int
    corp_id: int | None = None
    alliance_id: int | None = None
    ship_type_ids: set[int] = field(default_factory=set)
    first_seen: int = 0
    last_seen: int = 0
    kill_count: int = 0
    status: str = "active"  # "active", "idle", "departed"


# ─── Crew Object ────────────────────────────────────────────────────────────


class Crew:
    """
    Represents a group of players operating together.
    This is the fundamental tracking unit.
    """

    def __init__(
        self,
        crew_id: str,
        system_id: int,
        system_name: str,
        region_name: str | None,
        kill_time: int,
    ):
        self.id = crew_id

        # ── Core identity ──
        self.anchor_corp_id: int | None = None
        self.anchor_alliance_id: int | None = None
        self.anchor_corp_ids: set[int] = set()

        # ── Members ──
        self.members: dict[int, MemberState] = {}

        # ── Kills ──
        self.kills: list[dict] = []
        self.total_value: float = 0.0

        # ── Spatial state ──
        self.current_system_id: int = system_id
        self.current_system_name: str = system_name
        self.current_region: str | None = region_name
        self.current_location: str | None = None  # stargate name, etc.
        self.systems_visited: list[dict] = [
            {
                "id": system_id,
                "name": system_name,
                "region": region_name,
                "time": kill_time,
            }
        ]
        self.visited_system_ids: set[int] = {system_id}

        # ── Classification ──
        self.classification: str = "activity"
        self.classification_history: list[dict] = []
        self.transitions: list[dict] = []
        self.probability: int = 0
        self.max_probability: int = 0

        # ── Timing ──
        self.created_at: int = kill_time
        self.last_kill_at: int = kill_time
        self.last_activity_at: int = kill_time

        # ── Type flags ──
        self.has_smartbombs: bool = False
        self.stargate_name: str | None = (
            None  # set if MAJORITY of kills are near a gate
        )
        self.gate_kill_count: int = 0  # how many kills were near a stargate

        # ── Metrics cache ──
        self._metrics_cache: dict | None = None

        # ── Session linking ──
        self.prev_session_id: str | None = None

        # ── Per-member ships (for DB persistence) ──
        self.per_member_ships: dict[str, set[int]] = {}

    # ── Member Management ───────────────────────────────────────────────

    def add_or_update_member(
        self,
        char_id: int,
        corp_id: int | None,
        alliance_id: int | None,
        ship_type_id: int | None,
        kill_time: int,
    ):
        """Add a new member or update an existing one from a kill."""
        if char_id in self.members:
            m = self.members[char_id]
            m.last_seen = kill_time
            m.kill_count += 1
            m.status = "active"  # reactivate if was idle/departed
            if ship_type_id:
                m.ship_type_ids.add(ship_type_id)
            # Update corp/alliance if changed
            if corp_id:
                m.corp_id = corp_id
            if alliance_id:
                m.alliance_id = alliance_id
        else:
            m = MemberState(
                character_id=char_id,
                corp_id=corp_id,
                alliance_id=alliance_id,
                ship_type_ids={ship_type_id} if ship_type_id else set(),
                first_seen=kill_time,
                last_seen=kill_time,
                kill_count=1,
                status="active",
            )
            self.members[char_id] = m

        # Track per-member ships for persistence
        if ship_type_id:
            cid_str = str(char_id)
            if cid_str not in self.per_member_ships:
                self.per_member_ships[cid_str] = set()
            self.per_member_ships[cid_str].add(ship_type_id)

    def update_member_statuses(self, now: int):
        """Transition members to idle/departed based on time since last seen."""
        for m in self.members.values():
            if m.status == "departed":
                continue
            time_since = now - m.last_seen
            if time_since > MEMBER_DEPARTED_TIMEOUT_MS:
                m.status = "departed"
            elif time_since > MEMBER_IDLE_TIMEOUT_MS:
                m.status = "idle"

    def update_anchor(self):
        """
        Recompute the corp/alliance anchor based on active members.
        The anchor is the most common corp/alliance among active+idle members.
        """
        from collections import Counter

        active_members = [
            m for m in self.members.values() if m.status in ("active", "idle")
        ]
        if not active_members:
            return

        # Alliance anchor
        alliance_counts = Counter(
            m.alliance_id for m in active_members if m.alliance_id
        )
        if alliance_counts:
            self.anchor_alliance_id = alliance_counts.most_common(1)[0][0]

        # Corp anchor
        corp_counts = Counter(m.corp_id for m in active_members if m.corp_id)
        if corp_counts:
            self.anchor_corp_id = corp_counts.most_common(1)[0][0]

        self.anchor_corp_ids = {m.corp_id for m in active_members if m.corp_id}

    # ── Status Counts ───────────────────────────────────────────────────

    @property
    def active_count(self) -> int:
        return sum(1 for m in self.members.values() if m.status == "active")

    @property
    def idle_count(self) -> int:
        return sum(1 for m in self.members.values() if m.status == "idle")

    @property
    def departed_count(self) -> int:
        return sum(1 for m in self.members.values() if m.status == "departed")

    @property
    def total_member_count(self) -> int:
        return len(self.members)

    def is_dissolving(self) -> bool:
        """Check if the crew has effectively disbanded."""
        total = self.total_member_count
        if total < 3:
            return False
        active = self.active_count
        ratio = active / total if total > 0 else 0
        return ratio < DISSOLUTION_ACTIVE_RATIO and active < DISSOLUTION_MIN_ACTIVE


# ─── Serialization ──────────────────────────────────────────────────────────


def _serialize_crew(crew: Crew) -> dict:
    """
    Serialize a Crew into the format the frontend expects.
    Maintains backwards compatibility with the old activity format.
    """
    now = _now_ms()
    metrics = _compute_metrics(crew, now)

    # Build composition info (backwards compat)
    all_corp_ids = list({m.corp_id for m in crew.members.values() if m.corp_id})
    all_alliance_ids = list(
        {m.alliance_id for m in crew.members.values() if m.alliance_id}
    )
    all_member_ids = list(crew.members.keys())

    return {
        "id": crew.id,
        "type": crew.classification,
        "classification": crew.classification,
        "systemId": crew.current_system_id,
        "stargateName": crew.stargate_name,
        "kills": [
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
                "pinpoints": k.get("pinpoints"),
            }
            for k in crew.kills
        ],
        "totalValue": crew.total_value,
        "lastKill": crew.kills[-1]["killmail"]["killmail_time"] if crew.kills else None,
        "firstKillTime": crew.created_at,
        "lastActivity": crew.last_activity_at,
        "composition": {
            "originalCount": crew.total_member_count,
            "activeCount": crew.active_count,
            "killedCount": crew.departed_count,
            "numCorps": len(set(all_corp_ids)),
            "numAlliances": len(set(all_alliance_ids)),
        },
        "metrics": metrics,
        "probability": crew.probability,
        "maxProbability": crew.max_probability,
        "visitedSystems": list(crew.visited_system_ids),
        "systemsVisited": len(crew.visited_system_ids),
        "members": all_member_ids,
        "systems": crew.systems_visited,
        "lastSystem": {
            "id": crew.current_system_id,
            "name": crew.current_system_name,
            "region": crew.current_region,
        },
        "startTime": crew.created_at,
        # ── New fields for frontend (crew-specific) ──
        "anchorCorpId": crew.anchor_corp_id,
        "anchorAllianceId": crew.anchor_alliance_id,
        "activeMembers": crew.active_count,
        "idleMembers": crew.idle_count,
        "departedMembers": crew.departed_count,
        # For DB persistence
        "transitions": crew.transitions,
        "perMemberShips": {
            k: list(v) if isinstance(v, set) else v
            for k, v in crew.per_member_ships.items()
        },
    }


# ─── Metrics ────────────────────────────────────────────────────────────────


def _compute_metrics(crew: Crew, now: int) -> dict:
    """Compute metrics for a crew. Replaces the old _get_metrics."""
    kills = crew.kills
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
    valid = [t for t in times if t > 0]
    if not valid:
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

    earliest = min(valid)
    latest = max(valid)
    # Duration = last kill minus first kill (NOT now minus first kill)
    # This gives the crew's active window, not wall-clock since creation
    active_dur = max(1, (latest - earliest) // 60_000) if latest > earliest else 0
    total_dur = (now - earliest) // 60_000
    inactivity = (now - latest) // 60_000

    # Count from member tracking, not re-parsing kills
    chars = set(crew.members.keys())
    corps = {m.corp_id for m in crew.members.values() if m.corp_id}
    allis = {m.alliance_id for m in crew.members.values() if m.alliance_id}

    # Ship counts from member tracking
    ship_chars: dict[int, set] = {}
    for m in crew.members.values():
        for st in m.ship_type_ids:
            ship_chars.setdefault(st, set()).add(m.character_id)

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
        "shipCounts": {st: len(cids) for st, cids in ship_chars.items()},
        "partyMetrics": {
            "characters": len(chars),
            "corporations": len(corps),
            "alliances": len(allis),
        },
    }


# ─── ActivityManager ────────────────────────────────────────────────────────


class ActivityManager:
    def __init__(self):
        self._crews: dict[str, Crew] = {}
        self._expired_queue: list[dict] = []

    # ── Public API ──────────────────────────────────────────────────────

    def get_active_activities(self) -> list[dict]:
        """Return serialized active crews (backwards-compatible format)."""
        now = _now_ms()
        result = []
        for crew in self._crews.values():
            timeout = (
                CAMP_TIMEOUT_MS
                if crew.classification
                in ("camp", "smartbomb", "roaming_camp", "battle")
                else ROAM_TIMEOUT_MS
            )
            if now - crew.last_activity_at <= timeout:
                result.append(crew)

        result.sort(key=lambda c: (-(c.probability or 0), -(c.last_activity_at or 0)))
        return [_serialize_crew(c) for c in result]

    def process_killmail(self, killmail: dict) -> None:
        """
        Main entry point: process a new killmail.

        1. Extract attacker identifiers
        2. Find matching crew (or create new one)
        3. Update crew state
        4. Derive classification from behavior
        5. Update metrics and probability
        """
        now = _now_ms()
        kill_time = _kill_time_ms(killmail)
        km_data = killmail.get("killmail", {})
        system_id = km_data.get("solar_system_id")
        pinpoints = killmail.get("pinpoints", {})
        celestial_data = pinpoints.get("celestialData", {})

        system_name = celestial_data.get("solarsystemname") or str(system_id)
        region_name = celestial_data.get("regionname")

        # 1. Extract attacker info
        attacker_ids, corp_ids, alliance_ids = _extract_attacker_info(km_data)
        if not attacker_ids:
            return  # NPC kill or no valid player attackers

        # 2. Find matching crew
        crew_id, confidence = self._find_matching_crew(
            attacker_ids, corp_ids, alliance_ids, system_id, kill_time
        )

        if crew_id and crew_id in self._crews:
            crew = self._crews[crew_id]
            log.debug(f"Kill matched crew {crew_id} (confidence={confidence:.2f})")
        else:
            # Create new crew
            crew = Crew(
                crew_id=_generate_crew_id(),
                system_id=system_id,
                system_name=system_name,
                region_name=region_name,
                kill_time=kill_time,
            )
            self._crews[crew.id] = crew
            log.info(
                f"New crew {crew.id}: {len(attacker_ids)} attackers in {system_name}"
            )

        # 3. Add kill and update members
        self._add_kill_to_crew(
            crew, killmail, kill_time, system_id, system_name, region_name
        )
        self._update_members_from_kill(crew, km_data, kill_time)
        crew.update_anchor()

        # Update spatial state
        self._update_spatial_state(
            crew, killmail, system_id, system_name, region_name, kill_time
        )

        # Check smartbombs
        if self._has_smartbombs([killmail]):
            crew.has_smartbombs = True

        # 4. Compute probability FIRST (classification depends on it)
        crew.probability = self._calculate_camp_probability(crew)

        # 5. Derive classification from behavior + probability
        prev_class = crew.classification
        crew.classification = self._derive_classification(crew)
        if crew.classification != prev_class:
            self._record_transition(
                crew,
                prev_class,
                kill_time,
                system_id,
                system_name,
                killmail.get("killID"),
            )

    def update_activities(self) -> bool:
        """
        Periodic update: decay probabilities, update member statuses,
        expire dead crews.
        """
        now = _now_ms()
        to_keep: dict[str, Crew] = {}
        changed = False

        for cid, crew in self._crews.items():
            timeout = (
                CAMP_TIMEOUT_MS
                if crew.classification
                in ("camp", "smartbomb", "roaming_camp", "battle")
                else ROAM_TIMEOUT_MS
            )

            if now - crew.last_activity_at > timeout:
                # Expired by timeout
                changed = True
                if len(crew.kills) >= CREW_MIN_KILLS_TO_SAVE:
                    self._expired_queue.append(_serialize_crew(crew))
                continue

            # Update member statuses
            crew.update_member_statuses(now)

            # Check dissolution
            if crew.is_dissolving() and len(crew.kills) >= CREW_MIN_KILLS_TO_SAVE:
                # Crew is effectively dead even if timeout hasn't hit
                changed = True
                self._expired_queue.append(_serialize_crew(crew))
                log.info(
                    f"Crew {cid} dissolved: {crew.active_count}/{crew.total_member_count} active"
                )
                continue

            # Update probability (decay over time)
            prev_prob = crew.probability
            prev_class = crew.classification
            crew.probability = self._calculate_camp_probability(crew)
            crew.classification = self._derive_classification(crew)

            if crew.probability != prev_prob or crew.classification != prev_class:
                changed = True

            to_keep[cid] = crew

        self._crews = to_keep
        return changed

    def pop_expired(self) -> list[dict]:
        expired = self._expired_queue[:]
        self._expired_queue.clear()
        return expired

    # ── Crew Matching ───────────────────────────────────────────────────

    def _find_matching_crew(
        self,
        attacker_ids: set[int],
        corp_ids: set[int],
        alliance_ids: set[int],
        system_id: int,
        kill_time: int,
    ) -> tuple[str | None, float]:
        """
        Find the best matching existing crew for a set of attackers.

        Scoring:
          - Character overlap with active/idle members  (×0.50)
          - Corp/alliance anchor match                  (×0.25)
          - Spatial proximity                           (×0.15)
          - Temporal recency                            (×0.10)

        Returns (crew_id, score) or (None, 0).
        """
        best_id: str | None = None
        best_score: float = 0.0

        for cid, crew in self._crews.items():
            score = 0.0

            # 1. Character overlap (most important signal)
            active_member_ids = {
                mid for mid, m in crew.members.items() if m.status in ("active", "idle")
            }
            if active_member_ids and attacker_ids:
                overlap = active_member_ids & attacker_ids
                if overlap:
                    # Score by fraction of THIS kill's attackers found in the crew
                    char_score = len(overlap) / len(attacker_ids)
                    score += char_score * CHAR_OVERLAP_WEIGHT

                    # Bonus: if most of the crew is on this kill, strong match
                    if len(active_member_ids) > 0:
                        reverse_score = len(overlap) / len(active_member_ids)
                        score += reverse_score * 0.10  # small bonus

            # 2. Corp/alliance match
            if crew.anchor_alliance_id and alliance_ids:
                if crew.anchor_alliance_id in alliance_ids:
                    score += CORP_ALLIANCE_WEIGHT
                elif crew.anchor_corp_ids & corp_ids:
                    score += CORP_ALLIANCE_WEIGHT * 0.60
            elif crew.anchor_corp_id and corp_ids:
                if crew.anchor_corp_id in corp_ids:
                    score += CORP_ALLIANCE_WEIGHT * 0.80

            # 3. Spatial proximity
            if crew.current_system_id == system_id:
                score += SPATIAL_WEIGHT
            elif _is_adjacent_system(crew.current_system_id, system_id):
                score += SPATIAL_WEIGHT * 0.50

            # 4. Temporal recency
            time_since = kill_time - crew.last_kill_at
            if time_since < 10 * 60_000:  # <10 min
                score += TEMPORAL_WEIGHT
            elif time_since < 30 * 60_000:  # <30 min
                score += TEMPORAL_WEIGHT * 0.50
            elif time_since > 120 * 60_000:  # >2 hours
                score -= 0.15  # penalty for stale crews

            if score > best_score:
                best_score = score
                best_id = cid

        if best_score >= MATCH_THRESHOLD:
            return best_id, best_score

        return None, 0.0

    # ── Kill Processing ─────────────────────────────────────────────────

    def _add_kill_to_crew(
        self,
        crew: Crew,
        killmail: dict,
        kill_time: int,
        system_id: int,
        system_name: str,
        region_name: str | None,
    ):
        """Add a killmail to a crew's history."""
        kill_id = killmail.get("killID")
        if any(k.get("killID") == kill_id for k in crew.kills):
            return

        crew.kills.append(killmail)
        crew.total_value += (killmail.get("zkb") or {}).get("totalValue", 0)
        crew.last_kill_at = kill_time
        crew.last_activity_at = kill_time

    def _update_members_from_kill(self, crew: Crew, km_data: dict, kill_time: int):
        """Update crew membership from a killmail's attackers."""
        for a in km_data.get("attackers", []):
            cid = a.get("character_id")
            if not cid:
                continue
            ship_type = a.get("ship_type_id")
            if ship_type == CAPSULE_ID:
                continue
            crew.add_or_update_member(
                char_id=cid,
                corp_id=a.get("corporation_id"),
                alliance_id=a.get("alliance_id"),
                ship_type_id=ship_type,
                kill_time=kill_time,
            )

    def _update_spatial_state(
        self,
        crew: Crew,
        killmail: dict,
        system_id: int,
        system_name: str,
        region_name: str | None,
        kill_time: int,
    ):
        """
        Update crew's current location and movement history.

        Gate-kill ratio logic:
          - Ship kills at a gate always count toward gate_kill_count.
          - Pod kills at a gate only count if the victim does NOT have
            an earlier ship kill in this crew's history (i.e. orphan pods).
          - The denominator for the ratio also excludes follow-up pods,
            so that a camp with 5 ship kills + 4 follow-up pod kills
            has a ratio of 5/5 = 100%, not 5/9 = 55%.
        """
        # Update current system
        if crew.current_system_id != system_id:
            crew.systems_visited.append(
                {
                    "id": system_id,
                    "name": system_name,
                    "region": region_name,
                    "time": kill_time,
                }
            )
            crew.current_system_id = system_id
            crew.current_system_name = system_name
            crew.current_region = region_name
        crew.visited_system_ids.add(system_id)

        # Update location from this kill's pinpoints
        pinpoints = killmail.get("pinpoints", {})
        nc = pinpoints.get("nearestCelestial") or {}
        if nc.get("name"):
            crew.current_location = nc["name"]

        # ── Gate kill tracking (with follow-up pod handling) ────────────
        is_gate_kill = self._is_gate_camp_kill(killmail)
        victim_ship = killmail.get("killmail", {}).get("victim", {}).get("ship_type_id")
        is_pod = victim_ship == CAPSULE_ID

        if is_gate_kill:
            if not is_pod:
                # Ship kill at gate — always counts
                crew.gate_kill_count += 1
            else:
                # Pod kill at gate — only count if it's an orphan pod
                # (no earlier ship kill from the same victim in this crew)
                earlier_kills = crew.kills[:-1]  # everything before this kill
                if not _is_followup_pod(killmail, earlier_kills):
                    crew.gate_kill_count += 1
                # else: follow-up pod, don't increment gate_kill_count

        # Update stargate_name if this was a gate kill
        if is_gate_kill and nc.get("name"):
            crew.stargate_name = nc["name"]

        # ── Gate ratio check ───────────────────────────────────────────
        # Use effective kill count (excludes follow-up pods) as denominator
        # so that follow-up pods don't dilute the gate ratio.
        effective_kills = self._count_effective_kills(crew)
        if effective_kills > 0 and crew.gate_kill_count < (effective_kills / 2):
            crew.stargate_name = None

    def _count_effective_kills(self, crew: Crew) -> int:
        """
        Count kills excluding follow-up pod kills.

        A follow-up pod is a pod kill where the same victim already has
        a ship kill earlier in the crew's kill list.  These are not
        independent engagements and should not dilute the gate-kill ratio.

        Example:
          5 ship kills + 4 follow-up pods = 5 effective kills
          3 ship kills + 1 orphan pod     = 4 effective kills
        """
        seen_ship_victims: set[int] = set()
        count = 0

        for k in crew.kills:
            victim = k.get("killmail", {}).get("victim", {})
            victim_id = victim.get("character_id")
            ship_type = victim.get("ship_type_id")

            if ship_type != CAPSULE_ID:
                # Ship kill — always counts
                if victim_id:
                    seen_ship_victims.add(victim_id)
                count += 1
            else:
                # Pod kill — only count if orphan (no prior ship kill from same victim)
                if victim_id and victim_id not in seen_ship_victims:
                    count += 1
                elif not victim_id:
                    # No character_id on the pod (rare) — count it to be safe
                    count += 1
                # else: follow-up pod, skip

        return count

    def _record_transition(
        self,
        crew: Crew,
        prev_class: str,
        kill_time: int,
        system_id: int,
        system_name: str,
        kill_id: int | None,
    ):
        """Record a classification transition."""
        new_class = crew.classification
        crew.transitions.append(
            {
                "from": prev_class,
                "to": new_class,
                "time": kill_time,
                "systemId": system_id,
                "systemName": system_name,
                "killId": kill_id,
            }
        )
        crew.classification_history.append(
            {
                "classification": new_class,
                "time": kill_time,
                "systemId": system_id,
                "systemName": system_name,
            }
        )
        log.info(f"Crew {crew.id}: {prev_class} → {new_class} in {system_name}")

    # ── Classification ──────────────────────────────────────────────────

    def _derive_classification(self, crew: Crew) -> str:
        """
        Derive what the crew is doing from behavioral signals.

        Key rule: "camp" REQUIRES kills at a stargate (or station).
        Kills at moons, belts, or random celestials are never camps —
        they're activity, roams, or battles.

        Priority:
          1. smartbomb    — smartbomb weapons detected + at a gate
          2. battle       — many participants from multiple sides
          3. solo_roam    — every kill had exactly 1 player attacker
          4. roaming_camp — moved systems but now camping at a gate
          5. camp         — stationary at a gate with camp signals
          6. roam         — moving between systems
          7. activity     — fallback (includes moon/belt kills)
        """
        prob = crew.probability
        systems_count = len(crew.visited_system_ids)
        participants = len(
            [m for m in crew.members.values() if m.status in ("active", "idle")]
        )

        # Gate check: a camp requires majority of kills at a stargate
        is_at_gate = bool(crew.stargate_name)

        # 1. Smartbomb — must be at a gate
        if crew.has_smartbombs and is_at_gate and self._is_stationary_recent(crew):
            return "smartbomb"

        # 2. Battle — this can happen anywhere
        if participants >= BATTLE_PARTICIPANT_THRESHOLD:
            return "battle"

        # 3. Solo roam
        if crew.kills and all(_attacker_count(k) == 1 for k in crew.kills):
            return "solo_roam"

        # 4 & 5: Camp classifications REQUIRE a gate
        if is_at_gate and prob >= 5:
            # 4. Roaming camp — traveled but now camping at a gate
            if systems_count > 1 and self._is_stationary_recent(crew):
                return "roaming_camp"

            # 5. Camp — stationary at a gate
            if systems_count == 1 or self._is_stationary_recent(crew):
                return "camp"

        # 6. Roam — multi-system movement
        if systems_count > 1:
            return "roam"

        # 7. Fallback — single system, not at a gate (moon kills, belt rats, etc.)
        return "activity"

    def _is_stationary_recent(self, crew: Crew) -> bool:
        """Check if the crew's recent kills are all in the same system."""
        recent = crew.kills[-5:] if len(crew.kills) > 5 else crew.kills
        if not recent:
            return True
        systems = {k.get("killmail", {}).get("solar_system_id") for k in recent}
        return len(systems) <= 1

    # ── Probability (kept mostly from original, but crew-aware) ─────────

    def _calculate_camp_probability(self, crew: Crew) -> int:
        """
        Calculate camp probability for a crew.

        IMPORTANT: Camp probability is ONLY for gate camps. If the crew's
        kills are not primarily at a stargate, probability is 0.
        Non-gate activities (moon, belt, random) get classified as
        "activity" or "roam" with no camp probability.
        """
        # No gate = no camp probability
        if not crew.stargate_name:
            return 0

        all_kills = crew.kills
        now = _now_ms()

        # Stage 1: filter
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

        gate_kills = (
            [k for k in kills_for_prob if self._is_gate_camp_kill(k)]
            if crew.stargate_name
            else []
        )
        if crew.stargate_name and not gate_kills:
            return 0

        relevant = gate_kills if crew.stargate_name else kills_for_prob

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

        minutes_since = (now - crew.last_kill_at) / 60_000
        base = 0.0

        # Stage 2: burst penalty
        if len(ship_kills) > 1:
            kill_times = [_kill_time_ms(k) for k in ship_kills]
            camp_age = (now - crew.created_at) / 60_000
            has_burst = any(
                kill_times[i] - kill_times[i - 1] < 120_000
                for i in range(1, len(kill_times))
            )
            if camp_age <= 15 and has_burst:
                base -= BURST_PENALTY

        # Stage 3: threat ships
        if ship_kills:
            threat_score = 0.0
            for kill in ship_kills:
                for attacker in kill.get("killmail", {}).get("attackers", []):
                    st = attacker.get("ship_type_id")
                    if st and st in THREAT_SHIPS:
                        threat_score += THREAT_SHIPS[st]
            base += min(THREAT_SCORE_CAP, threat_score)

        # Stage 4: smartbomb bonus
        if crew.has_smartbombs:
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

        # Stage 5: known location
        if crew.stargate_name:
            camp_info = PERMANENT_CAMPS.get(crew.current_system_id)
            if camp_info and any(
                g.lower() in crew.stargate_name.lower() for g in camp_info["gates"]
            ):
                base += camp_info["weight"]

        # Stage 6: vulnerable victims
        vuln_count = sum(
            1
            for k in ship_kills
            if isinstance(k.get("shipCategories", {}).get("victim"), dict)
            and k["shipCategories"]["victim"].get("category")
            in ("industrial", "mining")
        )
        if vuln_count > 0:
            base += 0.40 if vuln_count > 1 else 0.20

        # Stage 7: attacker consistency
        if len(ship_kills) >= 2:
            check = ship_kills[-3:]
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
            if not skip and len(check) >= 2:
                consistency = 0.0
                latest = {
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
                    overlap = latest & prev
                    if len(overlap) >= max(2, len(prev) // 3) and len(overlap) >= 2:
                        consistency += 0.15
                base += min(MAX_CONSISTENCY_BONUS, consistency)

        # Stage 8: widely spaced kills
        if len(ship_kills) >= 2:
            ktimes = [_kill_time_ms(k) for k in ship_kills]
            spaced = sum(
                WIDELY_SPACED_BONUS
                for i in range(1, len(ktimes))
                if ktimes[i] - ktimes[i - 1] > 300_000
            )
            base += min(MAX_WIDELY_SPACED_BONUS, spaced)

        # Stage 9: pod bonus
        # Only count orphan pods (pods without a matching ship kill from the
        # same victim) to avoid double-counting engagements that already
        # contributed via the ship kill.
        if pod_kills:
            orphan_pod_count = sum(
                1 for pk in pod_kills if not _is_followup_pod(pk, ship_kills)
            )
            # All pods still get a small bonus (even follow-ups indicate
            # camp behavior), but orphan pods get the full bonus.
            effective_pod_count = orphan_pod_count + (
                (len(pod_kills) - orphan_pod_count) * 0.5  # half credit for follow-ups
            )
            base += min(MAX_POD_BONUS, effective_pod_count * POD_BONUS_PER_KILL)

        # Stage 10: cap
        base = max(0.0, min(OVERALL_PROB_CAP, base))

        # Stage 11: decay
        decay_start_min = DECAY_START_MS / 60_000
        if minutes_since > decay_start_min:
            decay_pct = min(1.0, (minutes_since - decay_start_min) * 0.10)
            base *= 1 - decay_pct

        # Stage 12: final
        base = max(0.0, min(OVERALL_PROB_CAP, base))
        pct = round(base * 100)
        if pct < MIN_PROB_THRESHOLD:
            return 0

        crew.max_probability = max(crew.max_probability, pct)
        return pct

    # ── Detection Helpers ───────────────────────────────────────────────

    def _is_gate_camp_kill(self, killmail: dict) -> bool:
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
        for kill in kills:
            for a in kill.get("killmail", {}).get("attackers", []):
                wid = a.get("weapon_type_id")
                if wid is not None and int(wid) in SMARTBOMB_WEAPON_IDS:
                    return True
        return False
