# src/training/trainer.py

import pytorch_lightning as pl
import torch
import mlflow
import json
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from datetime import datetime
from ..config import Settings
from ..models.gate_camp_model import GateCampDetector
from ..data.killmail_processor import KillmailProcessor


class GateCampTrainer:
    def __init__(self, config: Settings):
        self.config = config
        self.setup_logging()

    def setup_logging(self) -> None:
        """Initialize MLflow logging"""
        self.mlflow_logger = pl.loggers.MLFlowLogger(
            experiment_name=self.config.EXPERIMENT_NAME,
            tracking_uri=self.config.MLFLOW_TRACKING_URI,
        )

    def train(
        self,
        model: GateCampDetector,
        data_path: Path,
        model_version: str,
        learning_rate: float = 1e-3,
        batch_size: int = 32,
        validation_split: float = 0.2,
        early_stopping_patience: int = 5,
    ) -> None:
        """
        Train the gate camp detection model.

        Args:
            model: The model instance to train
            data_path: Path to training data
            model_version: Version string for model tracking
            learning_rate: Learning rate for optimization
            batch_size: Training batch size
            validation_split: Fraction of data to use for validation
            early_stopping_patience: Number of epochs to wait before early stopping
        """
        # Configure model hyperparameters
        model.hparams.learning_rate = learning_rate
        model.train()

        # Setup data loading
        train_loader, val_loader = self.get_data_loaders(
            data_path, batch_size, validation_split
        )

        # Configure callbacks
        callbacks = [
            pl.callbacks.EarlyStopping(
                monitor="val_loss", patience=early_stopping_patience, mode="min"
            ),
            pl.callbacks.ModelCheckpoint(
                dirpath=self.config.MODELS_DIR,
                filename=f"gatecampdetector-{model_version}",
                monitor="val_loss",
                mode="min",
            ),
            pl.callbacks.LearningRateMonitor(logging_interval="epoch"),
        ]

        # Initialize trainer
        trainer = pl.Trainer(
            max_epochs=self.config.MAX_EPOCHS,
            logger=self.mlflow_logger,
            callbacks=callbacks,
            accelerator="auto",  # Automatically detect GPU/CPU
            devices=1,
        )

        # Log training metadata
        self.log_training_metadata(model_version, data_path)

        # Train the model
        trainer.fit(model, train_loader, val_loader)

        # Save final model state and metadata
        self.save_model(model, model_version)

    def get_data_loaders(
        self, data_path: Path, batch_size: int, validation_split: float
    ) -> Tuple[torch.utils.data.DataLoader, torch.utils.data.DataLoader]:
        """
        Create training and validation data loaders.

        Args:
            data_path: Path to killmail data
            batch_size: Batch size for training
            validation_split: Fraction of data to use for validation

        Returns:
            Tuple of (train_loader, val_loader)
        """
        processor = KillmailProcessor(self.config)
        features, labels = processor.process_killmails(data_path)

        # Calculate split indices
        split_idx = int((1 - validation_split) * len(features))

        # Create training dataset
        train_dataset = torch.utils.data.TensorDataset(
            torch.tensor(features[:split_idx], dtype=torch.float32),
            torch.tensor(labels[:split_idx], dtype=torch.float32),
        )

        # Create validation dataset
        val_dataset = torch.utils.data.TensorDataset(
            torch.tensor(features[split_idx:], dtype=torch.float32),
            torch.tensor(labels[split_idx:], dtype=torch.float32),
        )

        # Create data loaders
        train_loader = torch.utils.data.DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=True,
            num_workers=4,
            pin_memory=True,
        )

        val_loader = torch.utils.data.DataLoader(
            val_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=4,
            pin_memory=True,
        )

        return train_loader, val_loader

    def evaluate(
        self, model: GateCampDetector, test_data_path: Path, batch_size: int = 32
    ) -> Dict[str, float]:
        """
        Evaluate model performance on test data.

        Args:
            model: Trained model to evaluate
            test_data_path: Path to test data
            batch_size: Batch size for evaluation

        Returns:
            Dictionary of evaluation metrics
        """
        model.eval()

        # Create test data loader
        processor = KillmailProcessor(self.config)
        features, labels = processor.process_killmails(test_data_path)

        test_dataset = torch.utils.data.TensorDataset(
            torch.tensor(features, dtype=torch.float32),
            torch.tensor(labels, dtype=torch.float32),
        )

        test_loader = torch.utils.data.DataLoader(
            test_dataset, batch_size=batch_size, shuffle=False
        )

        # Run evaluation
        trainer = pl.Trainer(logger=self.mlflow_logger, accelerator="auto", devices=1)

        results = trainer.test(model, test_loader)[0]

        return results

    def save_model(self, model: GateCampDetector, model_version: str) -> None:
        """
        Save trained model and metadata.

        Args:
            model: Trained model to save
            model_version: Version string for the model
        """
        # Save model state
        model_path = self.config.MODELS_DIR / f"gatecampdetector-{model_version}.pt"
        torch.save(model.state_dict(), model_path)

        # Save model metadata
        metadata = {
            "version": model_version,
            "timestamp": datetime.now().isoformat(),
            "hyperparameters": dict(model.hparams),
            "architecture": str(model),
        }

        metadata_path = (
            self.config.MODELS_DIR / f"gatecampdetector-{model_version}.json"
        )
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

    def log_training_metadata(self, model_version: str, data_path: Path) -> None:
        """
        Log training metadata to MLflow.

        Args:
            model_version: Version string for the model
            data_path: Path to training data
        """
        mlflow.log_params(
            {
                "model_version": model_version,
                "data_path": str(data_path),
                "timestamp": datetime.now().isoformat(),
            }
        )
