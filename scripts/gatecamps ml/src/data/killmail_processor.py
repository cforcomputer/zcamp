# src/data/killmail_processor.py

"""
Processes incoming killmails and maintains the state of active camps.
Handles filtering, feature extraction, and camp detection logic.
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Set, Tuple, Optional
from pathlib import Path
from dataclasses import dataclass

from ..config import Settings


@dataclass
class Camp:
    """Data class representing a gate camp."""

    id: str
    system_id: int
    stargate_name: str
    kills: List[Dict]
    first_seen: datetime
    last_kill: datetime
    original_attackers: Set[int]
    active_attackers: Set[int]
    killed_attackers: Set[int]
    total_value: float


class KillmailProcessor:
    def __init__(self, config: Settings):
        """
        Initialize the killmail processor.

        Args:
            config: Application settings
        """
        self.config = config
        self.active_camps: Dict[str, Camp] = {}

    def process_killmails(self, data_path: Path) -> Tuple[np.ndarray, np.ndarray]:
        """
        Process killmails from file and extract features for training.

        Args:
            data_path: Path to killmail data file

        Returns:
            Tuple of (features, labels) as numpy arrays
        """
        # Load killmails from file
        with open(data_path, "r") as f:
            killmails = json.load(f)

        features = []
        labels = []

        # Process each killmail
        for killmail in killmails:
            if self._is_potential_camp_kill(killmail):
                # Update camps state
                camp = self.process_killmail(killmail)

                if camp:
                    # Extract features and label
                    kill_features = self._extract_kill_features(killmail, camp)
                    kill_label = self._get_kill_label(killmail)

                    features.append(kill_features)
                    labels.append(kill_label)

        return np.array(features), np.array(labels)

    def process_killmail(self, killmail: Dict) -> Optional[Camp]:
        """
        Process a single killmail and update camp status.

        Args:
            killmail: Killmail data dictionary

        Returns:
            Updated camp object if kill is part of a camp, None otherwise
        """
        if not self._is_potential_camp_kill(killmail):
            return None

        camp_id = self._generate_camp_id(killmail)

        # Update or create camp
        if camp_id in self.active_camps:
            camp = self._update_existing_camp(camp_id, killmail)
        else:
            camp = self._create_new_camp(camp_id, killmail)

        # Check for expired camps
        self._cleanup_expired_camps()

        return camp

    def _is_potential_camp_kill(self, killmail: Dict) -> bool:
        """
        Determine if a killmail could potentially be part of a gate camp.

        Args:
            killmail: Killmail data to check

        Returns:
            True if kill could be part of a camp, False otherwise
        """
        # Must be near a stargate
        if not (
            killmail.get("pinpoints", {})
            .get("nearestCelestial", {})
            .get("name", "")
            .lower()
            .endswith("gate")
        ):
            return False

        # Exclude pod kills (usually secondary kills)
        if killmail["victim"]["ship_type_id"] == self.config.CAPSULE_ID:
            return False

        # Check if in known camping system
        if killmail["solar_system_id"] in self.config.SYSTEM_RISK_SCORES:
            return True

        return True

    def _generate_camp_id(self, killmail: Dict) -> str:
        """
        Generate a unique identifier for a camp based on location.

        Args:
            killmail: Killmail data

        Returns:
            Unique camp identifier string
        """
        system_id = killmail["solar_system_id"]
        gate_name = killmail["pinpoints"]["nearestCelestial"]["name"]
        return f"{system_id}-{gate_name}"

    def _create_new_camp(self, camp_id: str, killmail: Dict) -> Camp:
        """
        Create a new camp entry from a killmail.

        Args:
            camp_id: Unique camp identifier
            killmail: Initial killmail data

        Returns:
            New Camp object
        """
        timestamp = datetime.fromisoformat(killmail["killmail_time"])

        camp = Camp(
            id=camp_id,
            system_id=killmail["solar_system_id"],
            stargate_name=killmail["pinpoints"]["nearestCelestial"]["name"],
            kills=[killmail],
            first_seen=timestamp,
            last_kill=timestamp,
            original_attackers=set(),
            active_attackers=set(),
            killed_attackers=set(),
            total_value=killmail["zkb"]["totalValue"],
        )

        self._update_attacker_lists(camp, killmail)
        self.active_camps[camp_id] = camp
        return camp

    def _update_existing_camp(self, camp_id: str, killmail: Dict) -> Camp:
        """
        Update an existing camp with a new killmail.

        Args:
            camp_id: Camp identifier
            killmail: New killmail data

        Returns:
            Updated Camp object
        """
        camp = self.active_camps[camp_id]
        timestamp = datetime.fromisoformat(killmail["killmail_time"])

        # Add new kill
        camp.kills.append(killmail)
        camp.last_kill = timestamp
        camp.total_value += killmail["zkb"]["totalValue"]

        # Update attacker tracking
        self._update_attacker_lists(camp, killmail)

        return camp

    def _update_attacker_lists(self, camp: Camp, killmail: Dict) -> None:
        """
        Update the lists of attackers involved in a camp.

        Args:
            camp: Camp to update
            killmail: New killmail data
        """
        new_attackers = {
            a["character_id"] for a in killmail["attackers"] if "character_id" in a
        }

        # Track original attackers
        camp.original_attackers.update(new_attackers)

        # Update active attackers
        camp.active_attackers.update(new_attackers)

        # Track if any active attackers were killed
        victim_id = killmail["victim"].get("character_id")
        if victim_id and victim_id in camp.active_attackers:
            camp.active_attackers.remove(victim_id)
            camp.killed_attackers.add(victim_id)

    def _cleanup_expired_camps(self) -> None:
        """Remove expired camps from tracking."""
        now = datetime.now()
        expired = []

        for camp_id, camp in self.active_camps.items():
            time_since_last_kill = (now - camp.last_kill).total_seconds() * 1000
            if time_since_last_kill > self.config.CAMP_TIMEOUT:
                expired.append(camp_id)

        for camp_id in expired:
            del self.active_camps[camp_id]

    def _extract_kill_features(self, killmail: Dict, camp: Camp) -> np.ndarray:
        """
        Extract features from a killmail and its associated camp.

        Args:
            killmail: Killmail data
            camp: Associated camp object

        Returns:
            Numpy array of features
        """
        system_risk = self.config.SYSTEM_RISK_SCORES.get(
            killmail["solar_system_id"], 0.1
        )

        kill_time = datetime.fromisoformat(killmail["killmail_time"])
        camp_duration = (kill_time - camp.first_seen).total_seconds()

        features = [
            system_risk,
            len(camp.kills),
            len(camp.original_attackers),
            len(camp.active_attackers),
            len(camp.killed_attackers),
            camp.total_value,
            camp_duration,
            len(killmail["attackers"]),
            killmail["zkb"]["totalValue"],
            float(kill_time.hour),  # Time of day
            float(kill_time.weekday()),  # Day of week
        ]

        return np.array(features, dtype=np.float32)

    def _get_kill_label(self, killmail: Dict) -> int:
        """
        Get the label for a killmail (1 for camp kill, 0 for non-camp).

        Args:
            killmail: Killmail data

        Returns:
            Binary label
        """
        # This would use the labeled data from your training set
        # For now, using a simple heuristic
        return 1 if killmail.get("is_camp_kill", False) else 0
