# src/main.py
import typer
from pathlib import Path
from typing import Optional
from .config import Settings
from .models.gate_camp_model import GateCampDetector
from .ui.labeling_interface import LabelingInterface
from .data.killmail_processor import KillmailProcessor
from .training.trainer import GateCampTrainer

app = typer.Typer()


@app.command()
def train(
    data_path: Path = typer.Argument(..., help="Path to raw killmail data"),
    model_version: str = typer.Option("1.0.0", help="Version tag for the model"),
    batch_size: int = typer.Option(32, help="Training batch size"),
    epochs: int = typer.Option(100, help="Number of training epochs"),
):
    """Train a new gate camp detection model."""
    config = Settings(BATCH_SIZE=batch_size, MAX_EPOCHS=epochs)

    # Process data
    processor = KillmailProcessor(config)
    features, killmail_ids = processor.process_killmails(data_path)

    # Create and train model
    model = GateCampDetector(num_features=features.shape[1])
    trainer = GateCampTrainer(config)
    trainer.train(model)


@app.command()
def label(
    data_path: Path = typer.Argument(..., help="Path to killmail data for labeling")
):
    """Launch the labeling interface."""
    config = Settings()
    interface = LabelingInterface(config)
    interface.render()


if __name__ == "__main__":
    app()
