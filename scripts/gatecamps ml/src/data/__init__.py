# data/__init__.py
"""
Data processing module for the gate camp detection system.
Handles importing and processing of killmail data.
"""

from .killmail_processor import KillmailProcessor
from .feature_engineering import FeatureEngineer

__all__ = ["KillmailProcessor", "FeatureEngineer"]
