# src/data/feature_engineering.py

"""
Feature engineering module that transforms raw killmail data into model features.
Handles all the complex logic for extracting meaningful patterns from kills.
"""

from typing import Dict, List, Set
from datetime import datetime, timedelta
import numpy as np
from dataclasses import dataclass
from pathlib import Path

from ..config import Settings


@dataclass
class ExtractedFeatures:
    """Data class for storing extracted features."""

    temporal_features: Dict[str, float]
    attacker_features: Dict[str, float]
    location_features: Dict[str, float]
    pattern_features: Dict[str, float]


class FeatureEngineer:
    def __init__(self, config: Settings):
        """Initialize feature engineering module."""
        self.config = config

    def extract_features(self, camp: Dict) -> ExtractedFeatures:
        """
        Extract all features from a camp object.
        Combines temporal, spatial, and behavioral patterns.

        Args:
            camp: Dictionary containing camp data

        Returns:
            ExtractedFeatures object containing all feature categories
        """
        # Extract each feature category
        temporal = self._extract_temporal_features(camp)
        attacker = self._extract_attacker_features(camp)
        location = self._extract_location_features(camp)
        pattern = self._extract_kill_pattern_features(camp)

        return ExtractedFeatures(
            temporal_features=temporal,
            attacker_features=attacker,
            location_features=location,
            pattern_features=pattern,
        )

    def _extract_temporal_features(self, camp: Dict) -> Dict[str, float]:
        """
        Analyze timing patterns of kills.

        Args:
            camp: Camp data dictionary

        Returns:
            Dictionary of temporal features
        """
        kill_times = [datetime.fromisoformat(k["killmail_time"]) for k in camp["kills"]]
        kill_times.sort()

        # Calculate time differences between consecutive kills
        time_diffs = np.diff([t.timestamp() for t in kill_times])

        return {
            "duration_minutes": (kill_times[-1] - kill_times[0]).total_seconds() / 60,
            "avg_time_between_kills": np.mean(time_diffs) if len(time_diffs) > 0 else 0,
            "std_time_between_kills": np.std(time_diffs) if len(time_diffs) > 0 else 0,
            "kill_frequency": (
                len(kill_times)
                / ((kill_times[-1] - kill_times[0]).total_seconds() / 3600)
                if len(kill_times) > 1
                else 0
            ),
            "prime_time_ratio": len([t for t in kill_times if 18 <= t.hour <= 22])
            / len(kill_times),
            "weekend_ratio": len([t for t in kill_times if t.weekday() >= 5])
            / len(kill_times),
        }

    def _extract_attacker_features(self, camp: Dict) -> Dict[str, float]:
        """
        Analyze patterns in attacker composition and behavior.

        Args:
            camp: Camp data dictionary

        Returns:
            Dictionary of attacker-related features
        """
        all_attackers = set()
        all_corps = set()
        all_alliances = set()
        ship_types = set()

        for kill in camp["kills"]:
            for attacker in kill["attackers"]:
                if attacker.get("character_id"):
                    all_attackers.add(attacker["character_id"])
                if attacker.get("corporation_id"):
                    all_corps.add(attacker["corporation_id"])
                if attacker.get("alliance_id"):
                    all_alliances.add(attacker["alliance_id"])
                if attacker.get("ship_type_id"):
                    ship_types.add(attacker["ship_type_id"])

        return {
            "unique_attackers": len(all_attackers),
            "unique_corporations": len(all_corps),
            "unique_alliances": len(all_alliances),
            "unique_ship_types": len(ship_types),
            "attacker_persistence": len(all_attackers) / len(camp["kills"]),
            "avg_attackers_per_kill": np.mean(
                [len(k["attackers"]) for k in camp["kills"]]
            ),
            "corp_concentration": (
                len(all_corps) / len(all_attackers) if all_attackers else 0
            ),
        }

    def _extract_location_features(self, camp: Dict) -> Dict[str, float]:
        """
        Analyze location-based patterns and risk factors.

        Args:
            camp: Camp data dictionary

        Returns:
            Dictionary of location-related features
        """
        system_id = camp["systemId"]

        kill_distances = [
            k["pinpoints"]["nearestCelestial"]["distance"] for k in camp["kills"]
        ]

        return {
            "system_risk_score": self.config.SYSTEM_RISK_SCORES.get(system_id, 0.1),
            "is_known_camp_system": int(system_id in self.config.SYSTEM_RISK_SCORES),
            "avg_security_status": np.mean(
                [a["security_status"] for k in camp["kills"] for a in k["attackers"]]
            ),
            "avg_kill_distance": np.mean(kill_distances),
            "std_kill_distance": np.std(kill_distances),
            "max_kill_distance": max(kill_distances),
        }

    def _extract_kill_pattern_features(self, camp: Dict) -> Dict[str, float]:
        """
        Analyze patterns in the kills themselves.

        Args:
            camp: Camp data dictionary

        Returns:
            Dictionary of kill pattern features
        """
        kill_values = [k["zkb"]["totalValue"] for k in camp["kills"]]

        return {
            "total_value": sum(kill_values),
            "avg_value_per_kill": np.mean(kill_values),
            "std_value": np.std(kill_values),
            "pod_kill_ratio": sum(
                1
                for k in camp["kills"]
                if k["victim"]["ship_type_id"] == self.config.CAPSULE_ID
            )
            / len(camp["kills"]),
            "kill_count": len(camp["kills"]),
            "value_concentration": np.std(kill_values) / (np.mean(kill_values) + 1e-8),
        }

    def get_feature_names(self) -> List[str]:
        """Get list of all feature names in order."""
        return [
            # Temporal features
            "duration_minutes",
            "avg_time_between_kills",
            "std_time_between_kills",
            "kill_frequency",
            "prime_time_ratio",
            "weekend_ratio",
            # Attacker features
            "unique_attackers",
            "unique_corporations",
            "unique_alliances",
            "unique_ship_types",
            "attacker_persistence",
            "avg_attackers_per_kill",
            "corp_concentration",
            # Location features
            "system_risk_score",
            "is_known_camp_system",
            "avg_security_status",
            "avg_kill_distance",
            "std_kill_distance",
            "max_kill_distance",
            # Kill pattern features
            "total_value",
            "avg_value_per_kill",
            "std_value",
            "pod_kill_ratio",
            "kill_count",
            "value_concentration",
        ]
