# src/config.py
"""
Configuration settings for the gate camp detection system.
Centralizes all configurable parameters and paths.
"""

from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Define BASE_DIR first so it can be used by other paths
    BASE_DIR: Path = Path(__file__).parent

    # Google Drive settings
    GOOGLE_CREDS_PATH: Path = BASE_DIR / "key.json"
    EXPORT_FOLDER_ID: str = (
        "1Q8F7vDTejYKMs3gBSpUHOBDX-C70nyRA"  # Add your folder ID here
    )

    # MLflow settings for experiment tracking
    MLFLOW_TRACKING_URI: str = "sqlite:///mlflow.db"
    EXPERIMENT_NAME: str = "gate_camp_detection"

    # Training parameters that control model behavior
    BATCH_SIZE: int = 32
    MAX_EPOCHS: int = 100
    LEARNING_RATE: float = 1e-3

    # System constants from original implementation
    CAMP_TIMEOUT: int = 60 * 60 * 1000  # 1 hour in milliseconds
    ROAM_TIMEOUT: int = 30 * 60 * 1000  # 30 minutes in milliseconds
    CAPSULE_ID: int = 670

    # Project structure paths
    DATA_DIR: Path = BASE_DIR / "data"
    MODELS_DIR: Path = BASE_DIR / "models"

    # Known gate camping systems with risk scores
    SYSTEM_RISK_SCORES: dict = {
        30002813: 0.8,  # Tama
        30003068: 0.7,  # Rancer
        30000142: 0.6,  # Jita
        30002647: 0.6,  # Ignoitton
    }

    # Export settings
    EXPORT_INTERVAL: int = 60 * 60  # 1 hour in seconds

    class Config:
        env_file = ".env"
        arbitrary_types_allowed = True  # Allow Path objects


settings = Settings()
