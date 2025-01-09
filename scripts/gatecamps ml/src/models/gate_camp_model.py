# src/models/gate_camp_model.py

"""
PyTorch Lightning model for gate camp detection.
Implements a neural network that learns to identify gate camping behavior
from extracted features.
"""

import pytorch_lightning as pl
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, Any, List, Tuple, Optional


class GateCampDetector(pl.LightningModule):
    def __init__(
        self,
        input_size: int,
        hidden_sizes: List[int] = [256, 128, 64],
        learning_rate: float = 1e-3,
        dropout_rate: float = 0.3,
    ):
        """
        Initialize the gate camp detection model.

        Args:
            input_size: Number of input features
            hidden_sizes: List of hidden layer sizes
            learning_rate: Learning rate for optimization
            dropout_rate: Dropout rate for regularization
        """
        super().__init__()
        self.save_hyperparameters()

        # Build network layers
        layers = []
        current_size = input_size

        for hidden_size in hidden_sizes:
            layers.extend(
                [
                    nn.Linear(current_size, hidden_size),
                    nn.BatchNorm1d(hidden_size),
                    nn.ReLU(),
                    nn.Dropout(dropout_rate),
                ]
            )
            current_size = hidden_size

        # Output layer for binary classification
        layers.append(nn.Linear(hidden_sizes[-1], 1))
        layers.append(nn.Sigmoid())

        self.model = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass through the model."""
        return self.model(x)

    def training_step(
        self, batch: Dict[str, torch.Tensor], batch_idx: int
    ) -> Dict[str, torch.Tensor]:
        """
        Training step logic.

        Args:
            batch: Dictionary containing features and labels
            batch_idx: Index of current batch

        Returns:
            Dictionary containing loss and metrics
        """
        x, y = batch["features"], batch["labels"]
        y_hat = self(x)

        loss = F.binary_cross_entropy(y_hat, y)

        # Calculate metrics
        predictions = (y_hat > 0.5).float()
        accuracy = (predictions == y).float().mean()
        precision = self._calculate_precision(predictions, y)
        recall = self._calculate_recall(predictions, y)
        f1 = self._calculate_f1(precision, recall)

        # Log metrics
        self.log("train_loss", loss)
        self.log("train_accuracy", accuracy)
        self.log("train_precision", precision)
        self.log("train_recall", recall)
        self.log("train_f1", f1)

        return {
            "loss": loss,
            "accuracy": accuracy,
            "precision": precision,
            "recall": recall,
            "f1": f1,
        }

    def validation_step(
        self, batch: Dict[str, torch.Tensor], batch_idx: int
    ) -> Dict[str, torch.Tensor]:
        """
        Validation step logic.

        Args:
            batch: Dictionary containing features and labels
            batch_idx: Index of current batch

        Returns:
            Dictionary containing loss and metrics
        """
        x, y = batch["features"], batch["labels"]
        y_hat = self(x)

        loss = F.binary_cross_entropy(y_hat, y)

        # Calculate metrics
        predictions = (y_hat > 0.5).float()
        accuracy = (predictions == y).float().mean()
        precision = self._calculate_precision(predictions, y)
        recall = self._calculate_recall(predictions, y)
        f1 = self._calculate_f1(precision, recall)

        # Log metrics
        self.log("val_loss", loss)
        self.log("val_accuracy", accuracy)
        self.log("val_precision", precision)
        self.log("val_recall", recall)
        self.log("val_f1", f1)

        return {
            "val_loss": loss,
            "val_accuracy": accuracy,
            "val_precision": precision,
            "val_recall": recall,
            "val_f1": f1,
        }

    def test_step(
        self, batch: Dict[str, torch.Tensor], batch_idx: int
    ) -> Dict[str, torch.Tensor]:
        """
        Test step logic.

        Args:
            batch: Dictionary containing features and labels
            batch_idx: Index of current batch

        Returns:
            Dictionary containing loss and metrics
        """
        x, y = batch["features"], batch["labels"]
        y_hat = self(x)

        loss = F.binary_cross_entropy(y_hat, y)

        # Calculate metrics
        predictions = (y_hat > 0.5).float()
        accuracy = (predictions == y).float().mean()
        precision = self._calculate_precision(predictions, y)
        recall = self._calculate_recall(predictions, y)
        f1 = self._calculate_f1(precision, recall)

        # Log metrics
        self.log("test_loss", loss)
        self.log("test_accuracy", accuracy)
        self.log("test_precision", precision)
        self.log("test_recall", recall)
        self.log("test_f1", f1)

        return {
            "test_loss": loss,
            "test_accuracy": accuracy,
            "test_precision": precision,
            "test_recall": recall,
            "test_f1": f1,
        }

    def predict_step(
        self, batch: Dict[str, torch.Tensor], batch_idx: int
    ) -> torch.Tensor:
        """
        Prediction step logic.

        Args:
            batch: Dictionary containing features
            batch_idx: Index of current batch

        Returns:
            Model predictions
        """
        x = batch["features"]
        return self(x)

    def configure_optimizers(self) -> torch.optim.Optimizer:
        """Configure model optimizer."""
        return torch.optim.Adam(self.parameters(), lr=self.hparams.learning_rate)

    def _calculate_precision(
        self, predictions: torch.Tensor, targets: torch.Tensor
    ) -> torch.Tensor:
        """Calculate precision metric."""
        true_positives = ((predictions == 1) & (targets == 1)).float().sum()
        predicted_positives = (predictions == 1).float().sum()
        return true_positives / (predicted_positives + 1e-8)

    def _calculate_recall(
        self, predictions: torch.Tensor, targets: torch.Tensor
    ) -> torch.Tensor:
        """Calculate recall metric."""
        true_positives = ((predictions == 1) & (targets == 1)).float().sum()
        actual_positives = (targets == 1).float().sum()
        return true_positives / (actual_positives + 1e-8)

    def _calculate_f1(
        self, precision: torch.Tensor, recall: torch.Tensor
    ) -> torch.Tensor:
        """Calculate F1 score."""
        return 2 * (precision * recall) / (precision + recall + 1e-8)
