# src/ui/labeling_interface.py

"""
Streamlit-based interface for labeling potential gate camps and viewing model predictions.
"""

import streamlit as st
import pandas as pd
import mlflow
from datetime import datetime, timedelta
from typing import List, Dict, Set
import plotly.express as px
from pathlib import Path

from ..config import Settings
from ..models.gate_camp_model import GateCampDetector


class LabelingInterface:
    def __init__(self, config: Settings):
        self.config = config
        self.setup_mlflow()
        self.initialize_session_state()

    def setup_mlflow(self) -> None:
        """Initializes MLflow tracking."""
        mlflow.set_tracking_uri(self.config.MLFLOW_TRACKING_URI)
        self.experiment = mlflow.set_experiment("killmail_labeling")

    def initialize_session_state(self) -> None:
        """Initializes Streamlit session state variables."""
        if "labeled_kills" not in st.session_state:
            st.session_state.labeled_kills = set()
        if "current_batch" not in st.session_state:
            st.session_state.current_batch = self.load_next_batch()
        if "user" not in st.session_state:
            st.session_state.user = "unknown"

    def load_next_batch(self, batch_size: int = 50) -> List[Dict]:
        """Loads next batch of unlabeled killmails."""
        # TODO: Implement actual data loading from storage
        return []  # Placeholder

    def render(self) -> None:
        """Renders the main labeling interface."""
        st.title("Gate Camp Detection - Labeling Interface")

        # User identification
        self.render_user_section()

        # Add filtering controls
        self.render_filters()

        # Display killmails in an efficient grid
        self.render_killmail_grid()

        # Add batch operations
        self.render_batch_controls()

        # Display statistics
        self.render_statistics()

    def render_user_section(self) -> None:
        """Renders user identification section."""
        with st.sidebar:
            st.session_state.user = st.text_input(
                "Labeler Name",
                value=st.session_state.user,
                help="Enter your name for tracking labels",
            )

    def render_filters(self) -> None:
        """Renders filtering controls in the sidebar."""
        with st.sidebar:
            st.header("Filters")

            # System filter
            selected_systems = st.multiselect(
                "Filter by System",
                options=self.get_unique_systems(),
                key="system_filter",
            )

            # Time range filter
            date_range = st.date_input(
                "Date Range",
                value=[
                    datetime.now().date() - timedelta(days=7),
                    datetime.now().date(),
                ],
                key="date_filter",
            )

            # Value range filter
            value_range = st.slider(
                "ISK Value Range",
                min_value=0,
                max_value=1_000_000_000,
                value=(0, 1_000_000_000),
                key="value_filter",
            )

    def render_batch_controls(self) -> None:
        """Renders batch operation controls."""
        st.sidebar.header("Batch Operations")

        col1, col2 = st.sidebar.columns(2)

        with col1:
            if st.button("Load Next Batch"):
                st.session_state.current_batch = self.load_next_batch()
                st.experimental_rerun()

        with col2:
            if st.button("Save All Labels"):
                self.save_batch_labels()
                st.success("Labels saved successfully!")

    def render_statistics(self) -> None:
        """Renders labeling statistics."""
        st.sidebar.header("Statistics")

        total_labeled = len(st.session_state.labeled_kills)
        remaining = len(st.session_state.current_batch) - total_labeled

        st.sidebar.metric("Kills Labeled", total_labeled)
        st.sidebar.metric("Remaining", remaining)

    def render_killmail_grid(self) -> None:
        """Renders the grid of killmails for labeling."""
        killmails = self.filter_killmails(st.session_state.current_batch)

        for idx, killmail in enumerate(killmails):
            with st.container():
                col1, col2, col3 = st.columns([2, 2, 1])

                with col1:
                    self.render_killmail_basic_info(killmail)

                with col2:
                    self.render_killmail_details(killmail)

                with col3:
                    self.render_labeling_controls(killmail)

    def render_killmail_basic_info(self, killmail: Dict) -> None:
        """Renders basic killmail information."""
        st.markdown(
            f"""
            ### Kill ID: [{killmail['killmail_id']}](https://zkillboard.com/kill/{killmail['killmail_id']}/)
            **System**: {killmail['system_name']}  
            **Time**: {killmail['timestamp']}  
            **Total Value**: {killmail['total_value']:,.2f} ISK
            """
        )

    def render_killmail_details(self, killmail: Dict) -> None:
        """Renders detailed killmail information."""
        with st.expander("Detailed Information"):
            # Attacker composition
            st.write("Attacker Composition:")
            st.write(f"- Total Attackers: {len(killmail['attackers'])}")
            st.write(
                f"- Unique Corporations: {len(set(a['corporation_id'] for a in killmail['attackers']))}"
            )

            # Ship types involved
            st.write("Ships Involved:")
            for ship in killmail["attackers"]:
                st.write(f"- {ship['ship_type_name']}")

            # Location details
            st.write("Location Details:")
            st.write(f"- Nearest Celestial: {killmail['nearest_celestial']['name']}")
            st.write(f"- Distance: {killmail['nearest_celestial']['distance']:,.0f}m")

    def render_labeling_controls(self, killmail: Dict) -> None:
        """Renders controls for labeling a killmail."""
        kill_id = killmail["killmail_id"]

        # Model prediction if available
        if "prediction" in killmail:
            st.metric(
                "Model Confidence",
                f"{killmail['prediction']:.1%}",
                delta=None,
                delta_color="off",
            )

        label = st.radio(
            "Is this a gate camp kill?",
            options=["Unlabeled", "Yes", "No"],
            key=f"label_{kill_id}",
            horizontal=True,
        )

        if label != "Unlabeled":
            self.save_label(kill_id, label == "Yes")
            st.session_state.labeled_kills.add(kill_id)

    def filter_killmails(self, killmails: List[Dict]) -> List[Dict]:
        """Filters killmails based on selected criteria."""
        filtered = killmails.copy()

        # Apply system filter
        if st.session_state.get("system_filter"):
            filtered = [
                k
                for k in filtered
                if k["solar_system_id"] in st.session_state.system_filter
            ]

        # Apply date filter
        if st.session_state.get("date_filter"):
            date_range = st.session_state.date_filter
            filtered = [
                k
                for k in filtered
                if date_range[0]
                <= datetime.fromisoformat(k["killmail_time"]).date()
                <= date_range[1]
            ]

        # Apply value filter
        if st.session_state.get("value_filter"):
            value_range = st.session_state.value_filter
            filtered = [
                k
                for k in filtered
                if value_range[0] <= k["zkb"]["totalValue"] <= value_range[1]
            ]

        return filtered

    def save_label(self, kill_id: int, is_camp: bool) -> None:
        """Saves a label to MLflow with appropriate metadata."""
        with mlflow.start_run(run_name=f"label_{kill_id}"):
            mlflow.log_params(
                {
                    "kill_id": kill_id,
                    "labeler": st.session_state.get("user", "unknown"),
                    "timestamp": datetime.now().isoformat(),
                }
            )

            mlflow.log_metric("is_camp", int(is_camp))

    def save_batch_labels(self) -> None:
        """Saves all current batch labels."""
        for kill_id in st.session_state.labeled_kills:
            label = st.session_state[f"label_{kill_id}"]
            if label != "Unlabeled":
                self.save_label(kill_id, label == "Yes")

    def get_unique_systems(self) -> List[str]:
        """Returns list of unique systems in current batch."""
        return sorted(
            list(set(k["solar_system_id"] for k in st.session_state.current_batch))
        )
