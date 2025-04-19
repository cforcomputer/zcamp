# cluster_analyzer.py (Enhanced for Interpretability - CORRECTED & REFORMATTED)

import streamlit as st
import pandas as pd
import numpy as np
import psycopg2
import psycopg2.extras  # For dictionary cursor
import os
import json
from dotenv import load_dotenv
import traceback
import requests
import time
from collections import Counter

# Plotting and ML imports
import matplotlib.pyplot as plt
import plotly.express as px
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import (
    SimpleImputer,
)  # Might be useful if NaNs remain before scaling
from sklearn.decomposition import PCA  # For dimensionality reduction

# --- Configuration & Initial Setup ---
load_dotenv()
DATABASE_URL = os.getenv("POSTGRES_URL")
ESI_SYSTEM_ENDPOINT = "https://esi.evetech.net/latest/universe/systems/{system_id}/?datasource=tranquility&language=en-us"
TABLE_NAME = "expired_camps"
TABLE_SCHEMA = "public"

st.set_page_config(layout="wide", page_title="EVE Camp Cluster Analyzer")
st.title("🔬 EVE Camp Cluster Analyzer")
st.markdown(
    """
Explore the characteristics of camps within each cluster label assigned by DBSCAN.
Use the sidebar to select a cluster and view its summary stats compared to the overall average.
Check the tabs below the camp details for feature distributions and a 2D visualization of clusters.
"""
)


# --- Caching Decorators & Helper Functions ---
# --- Database Connection ---
def get_db_connection():
    """Establishes a fresh connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn
    except Exception as e:
        st.error(f"DB Connection Error: {e}")
        return None


# --- Data Fetching ---
@st.cache_data(ttl=600)  # Cache data for 10 minutes
def fetch_all_camps_data_cached():
    """Fetches all camp data, designed to be cleared for refetch."""
    return fetch_camps_data_internal()


def fetch_camps_data_internal():
    """Internal function to fetch data, called by cached wrapper."""
    conn_local = None
    st.info("Fetching data from database...")
    start_time = time.time()
    try:
        conn_local = get_db_connection()
        if conn_local is None:
            return pd.DataFrame()

        # Fetch necessary columns including cluster_label and classifier
        query = (
            f"SELECT * FROM {TABLE_SCHEMA}.{TABLE_NAME} ORDER BY camp_start_time DESC"
        )
        df = pd.read_sql(query, conn_local)

        # Basic Type Conversions
        if "camp_details" in df.columns:

            def safe_json_loads(x):
                try:
                    return json.loads(x) if isinstance(x, str) else x
                except json.JSONDecodeError:
                    return None

            df["camp_details"] = df["camp_details"].apply(safe_json_loads)

        for col in [
            "camp_start_time",
            "last_kill_time",
            "camp_end_time",
            "processing_time",
        ]:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce")

        # Ensure classifier is numeric or NaN
        if "classifier" in df.columns:
            df["classifier"] = pd.to_numeric(df["classifier"], errors="coerce")

        # Ensure cluster_label is integer, fill missing with -1 (consistent with noise)
        if "cluster_label" in df.columns:
            df["cluster_label"] = (
                pd.to_numeric(df["cluster_label"], errors="coerce").fillna(-1).astype(int)
            )
        else:
            st.warning(
                "Column 'cluster_label' not found in fetched data. Assigning all to -1."
            )
            df["cluster_label"] = -1  # Assign default if column missing

        # Ensure relevant numeric cols are numeric
        num_cols_check = ["max_probability", "final_kill_count", "total_value"]
        for col in num_cols_check:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        duration_s = time.time() - start_time
        st.success(f"Fetched {len(df)} camps in {duration_s:.2f} seconds.")
        return df
    except Exception as e:
        st.error(f"Error fetching camps: {e}")
        st.code(traceback.format_exc())
        return pd.DataFrame()
    finally:
        if conn_local and conn_local.closed == 0:
            try:
                conn_local.close()
            except Exception:
                pass


# --- ESI Lookup ---
@st.cache_data(ttl=3600 * 24)  # Cache system names for a day
def get_system_name(system_id):
    """Looks up system name using ESI."""
    if not system_id or pd.isna(system_id):
        return "Unknown System"
    # Convert potential numpy types to standard int
    try:
        system_id = int(system_id)
    except (ValueError, TypeError):
        return "Invalid System ID"
    try:
        url = ESI_SYSTEM_ENDPOINT.format(system_id=system_id)
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()
        return data.get("name", f"ID: {system_id}")
    except requests.exceptions.RequestException:
        return f"ID: {system_id} (ESI Error)"
    except Exception:
        return f"ID: {system_id} (Parse Error)"


# --- Duration Helpers ---
def calculate_duration_seconds(start_time, end_time):
    """Calculates duration safely."""
    if pd.isna(start_time) or pd.isna(end_time):
        return None
    if start_time.tzinfo is not None:
        start_time = start_time.tz_localize(None)
    if end_time.tzinfo is not None:
        end_time = end_time.tz_localize(None)
    try:
        duration_td = end_time - start_time
        if duration_td.total_seconds() < 0:
            return 0
        return duration_td.total_seconds()
    except TypeError:
        return None


def format_duration(seconds):
    """Formats duration in seconds into H M S string."""
    if seconds is None or pd.isna(seconds) or seconds < 0:
        return "N/A"
    total_seconds = int(seconds)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}h {minutes}m {seconds}s"


# --- Classification Status ---
def get_classification_status(classifier_val):
    """Gets text and icon for classification status."""
    # Reuse from active learner script
    if pd.isna(classifier_val):
        val = None
    else:
        try:
            val = int(classifier_val)
        except (ValueError, TypeError):
            val = "Invalid"
    status_map = {None: ("Not Classified", "⚪"), 0: ("False", "🔴"), 1: ("True", "🟢")}
    return status_map.get(val, ("Invalid", "❓"))


# --- Feature Engineering for Analysis/Visualization (Similar to Clustering) ---
# We need this to recreate the space DBSCAN saw for PCA/t-SNE
@st.cache_data  # Cache the prepared data
def prepare_features_for_analysis(df):
    """Prepares features, returning scaled/encoded data and original IDs."""
    st.info("Preparing features for analysis visualization...")
    features = df.copy()
    # --- Feature Creation (Must match dbscan_clusterer.py) ---
    features["duration_seconds"] = features.apply(
        lambda r: calculate_duration_seconds(r["camp_start_time"], r["camp_end_time"]),
        axis=1,
    )
    if pd.api.types.is_datetime64_any_dtype(features["camp_start_time"]):
        features["hour_of_day"] = (
            features["camp_start_time"].dt.hour.fillna(-1).astype(int)
        )
        features["day_of_week"] = (
            features["camp_start_time"].dt.dayofweek.fillna(-1).astype(int)
        )
    else:
        features["hour_of_day"], features["day_of_week"] = -1, -1
    features["num_kills"] = features["camp_details"].apply(
        lambda x: len(x["kills"])
        if isinstance(x, dict) and "kills" in x and isinstance(x["kills"], list)
        else 0
    )
    features["num_attackers"] = features["camp_details"].apply(
        lambda x: x.get("composition", {}).get("activeCount")
        if isinstance(x, dict)
        else None
    )
    features["max_probability"] = pd.to_numeric(
        features["max_probability"], errors="coerce"
    ).fillna(0)
    features["total_value"] = pd.to_numeric(
        features["total_value"], errors="coerce"
    ).fillna(0)
    features["final_kill_count"] = pd.to_numeric(
        features["final_kill_count"], errors="coerce"
    ).fillna(0)
    features["num_attackers"] = pd.to_numeric(
        features["num_attackers"], errors="coerce"
    ).fillna(0)

    # --- Define Columns (Must match dbscan_clusterer.py) ---
    numeric_features = [
        "duration_seconds",
        "max_probability",
        "final_kill_count",
        "total_value",
        "num_kills",
        "num_attackers",
        "hour_of_day",
        "day_of_week",
    ]
    categorical_features = ["system_id", "camp_type"]
    cols_to_select = (
        ["id", "cluster_label"]
        + [c for c in numeric_features if c in features]
        + [c for c in categorical_features if c in features]
    )
    feature_subset = features[cols_to_select].copy()

    # --- Handle Missing Values ---
    active_numeric = [c for c in numeric_features if c in feature_subset]
    for col in active_numeric:
        feature_subset[col] = pd.to_numeric(
            feature_subset[col], errors="coerce"
        ).fillna(-1)
    active_categorical = [c for c in categorical_features if c in feature_subset]
    for col in active_categorical:
        if not pd.api.types.is_categorical_dtype(feature_subset[col]):
            feature_subset[col] = feature_subset[col].astype("category")
        if "Unknown" not in feature_subset[col].cat.categories:
            feature_subset[col] = feature_subset[col].cat.add_categories("Unknown")
        feature_subset[col] = feature_subset[col].fillna("Unknown")

    # --- Preprocessing Pipeline (Must match dbscan_clusterer.py) ---
    numeric_transformer = Pipeline(steps=[("scaler", StandardScaler())])
    categorical_transformer = Pipeline(
        steps=[("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]
    )
    final_numeric = [f for f in active_numeric if f in feature_subset]
    final_categorical = [f for f in active_categorical if f in feature_subset]
    if not final_numeric and not final_categorical:
        return None, None, None
    transformers_list = []
    if final_numeric:
        transformers_list.append(("num", numeric_transformer, final_numeric))
    if final_categorical:
        transformers_list.append(
            ("cat", categorical_transformer, final_categorical)
        )
    preprocessor = ColumnTransformer(transformers=transformers_list, remainder="drop")
    pipeline = Pipeline(steps=[("preprocessor", preprocessor)])
    cols_to_process = final_numeric + final_categorical
    if not cols_to_process:
        return None, None, None

    try:
        X_prepared = pipeline.fit_transform(feature_subset[cols_to_process])
        st.success("Feature preparation for visualization complete.")
        # Return processed data, cluster labels, and original IDs
        return (
            X_prepared,
            feature_subset["cluster_label"],
            feature_subset["id"],
        )
    except Exception as e:
        st.error(f"Error during feature preparation for visualization: {e}")
        st.code(traceback.format_exc())
        return None, None, None


# --- Initialize Session State ---
if "current_camp_index" not in st.session_state:
    st.session_state.current_camp_index = 0
if "selected_cluster" not in st.session_state:
    st.session_state.selected_cluster = -1
if "all_data" not in st.session_state:
    st.session_state.all_data = pd.DataFrame()
if "data_loaded" not in st.session_state:
    st.session_state.data_loaded = False
if "cluster_labels" not in st.session_state:
    st.session_state.cluster_labels = []
if "X_prepared_viz" not in st.session_state:
    st.session_state.X_prepared_viz = None  # Store prepared data
if "viz_cluster_labels" not in st.session_state:
    st.session_state.viz_cluster_labels = None  # Store labels for viz
if "viz_ids" not in st.session_state:
    st.session_state.viz_ids = None  # Store ids for viz


# --- Load Data ---
if not st.session_state.data_loaded:
    raw_data = fetch_all_camps_data_cached()
    if not raw_data.empty:
        st.session_state.data_loaded = True
        # Calculate duration
        raw_data["duration_seconds"] = raw_data.apply(
            lambda row: calculate_duration_seconds(
                row["camp_start_time"], row["camp_end_time"]
            ),
            axis=1,
        )
        st.session_state.all_data = raw_data

        # Get available cluster labels
        if "cluster_label" in st.session_state.all_data.columns:
            labels = sorted(st.session_state.all_data["cluster_label"].unique())
            st.session_state.cluster_labels = labels
            if st.session_state.selected_cluster not in labels:
                st.session_state.selected_cluster = (
                    -1 if -1 in labels else (labels[0] if labels else None)
                )
        else:
            st.session_state.cluster_labels = [-1]  # Default if column missing
            st.session_state.selected_cluster = -1

        # Prepare data for visualizations once
        (
            st.session_state.X_prepared_viz,
            st.session_state.viz_cluster_labels,
            st.session_state.viz_ids,
        ) = prepare_features_for_analysis(st.session_state.all_data)

    else:
        st.error("Failed to load initial data.")
        st.stop()

# --- Sidebar ---
with st.sidebar:
    st.header("Cluster Selection")
    if st.session_state.cluster_labels:
        prev_cluster = st.session_state.selected_cluster
        st.session_state.selected_cluster = st.selectbox(
            "Select Cluster Label:",
            options=st.session_state.cluster_labels,
            index=st.session_state.cluster_labels.index(
                st.session_state.selected_cluster
            )  # Set default index
            if st.session_state.selected_cluster in st.session_state.cluster_labels
            else 0,
            format_func=lambda x: f"Cluster {x}" if x != -1 else "Noise / Outliers (-1)",
        )
        if st.session_state.selected_cluster != prev_cluster:
            st.session_state.current_camp_index = 0
            st.rerun()  # Rerun to update filtered data immediately
    else:
        st.warning("No cluster labels found in the data.")
        st.session_state.selected_cluster = None  # No cluster to select

    st.markdown("---")
    st.header(
        f"Summary: {f'Cluster {st.session_state.selected_cluster}' if st.session_state.selected_cluster != -1 else 'Noise (-1)'}"
    )

    if st.session_state.selected_cluster is not None:
        # Filter data for the selected cluster
        cluster_df = st.session_state.all_data[
            st.session_state.all_data["cluster_label"]
            == st.session_state.selected_cluster
        ].copy()
        all_df = st.session_state.all_data  # For overall comparison
        count = len(cluster_df)
        st.metric("Number of Camps", count)

        if count > 0:
            # --- Enhanced Numeric Summaries ---
            st.subheader("Key Numeric Features")
            numeric_summary_cols = [
                "duration_seconds",
                "total_value",
                "max_probability",
                "final_kill_count",
                "num_kills",
                "num_attackers",
            ]
            for col in numeric_summary_cols:
                if col in cluster_df.columns:
                    cluster_mean = cluster_df[col].mean()
                    cluster_median = cluster_df[col].median()
                    overall_mean = all_df[col].mean()
                    label = col.replace("_", " ").title()
                    disp_val = (
                        f"{cluster_mean:,.1f}"
                        if pd.notna(cluster_mean) and cluster_mean > 100
                        else f"{cluster_mean:.2f}" if pd.notna(cluster_mean) else "N/A"
                    )
                    delta_val = (
                        f"{overall_mean:,.1f}"
                        if pd.notna(overall_mean) and overall_mean > 100
                        else f"{overall_mean:.2f}" if pd.notna(overall_mean) else "N/A"
                    )
                    if pd.notna(cluster_mean) and pd.notna(overall_mean):
                        st.metric(
                            f"Avg. {label}",
                            disp_val,
                            delta=f"Overall Avg: {delta_val}",
                            delta_color="off",
                        )
                        # Optionally add median: st.write(f"Median {label}: {cluster_median:,.1f}")
                    else:
                        st.metric(f"Avg. {label}", "N/A")

            # --- Top Categorical Summaries ---
            st.subheader("Top Systems (Cluster)")
            if "system_id" in cluster_df.columns:
                top_systems = cluster_df["system_id"].value_counts().head(5)
                if not top_systems.empty:
                    for sys_id, num in top_systems.items():
                        st.write(f"- {get_system_name(sys_id)} ({num})")
                else:
                    st.write("No system data.")
            else:
                st.write("System ID missing.")

            st.subheader("Top Camp Types (Cluster)")
            if "camp_type" in cluster_df.columns:
                top_types = cluster_df["camp_type"].value_counts().head(3)
                if not top_types.empty:
                    for camp_type, num in top_types.items():
                        st.write(f"- {str(camp_type).capitalize()} ({num})")
                else:
                    st.write("No camp type data.")
            else:
                st.write("Camp Type missing.")
        else:
            st.write("No camps in this cluster.")

    st.markdown("---")
    if st.button("Reload All Data"):
        fetch_all_camps_data_cached.clear()
        get_system_name.clear()
        # Clear prepared viz data as well
        keys_to_reset = [
            "data_loaded",
            "current_camp_index",
            "all_data",
            "cluster_labels",
            "X_prepared_viz",
            "viz_cluster_labels",
            "viz_ids",
        ]
        for key in keys_to_reset:
            if key in st.session_state:
                del st.session_state[key]
        st.rerun()


# --- Main Display Area --- (Corrected Logic Flow)
if st.session_state.selected_cluster is None:
    st.info("Select a cluster label from the sidebar to begin exploring.")

else:
    # Cluster IS selected, now filter the data
    filtered_df = st.session_state.all_data[
        st.session_state.all_data["cluster_label"] == st.session_state.selected_cluster
    ].reset_index(drop=True)

    total_camps_in_cluster = len(filtered_df)

    # Check if the selected cluster has any camps
    if total_camps_in_cluster == 0:
        st.warning(f"No camps found for Cluster Label: {st.session_state.selected_cluster}")

    else:
        # Cluster has camps, display the browser and analysis tabs

        # Ensure index is valid
        if st.session_state.current_camp_index >= total_camps_in_cluster:
            st.session_state.current_camp_index = 0

        current_camp = filtered_df.iloc[st.session_state.current_camp_index]

        # --- Camp Browser ---
        st.header(
            f"Camp {st.session_state.current_camp_index + 1} of {total_camps_in_cluster} (Cluster {st.session_state.selected_cluster})"
        )
        st.caption(
            f"DB ID: {current_camp['id']} | Unique ID: `{current_camp.get('camp_unique_id', 'N/A')}`"
        )
        # zKill Link ...
        first_kill_id = None
        camp_details_main = current_camp.get("camp_details", {})
        if camp_details_main and camp_details_main.get("kills"):
            fk_list = camp_details_main["kills"]
            if fk_list and isinstance(fk_list[0], dict):
                first_kill_id = fk_list[0].get("killID")
        if first_kill_id and isinstance(first_kill_id, int):
            st.markdown(f"**[zKill ↗](https://zkillboard.com/kill/{first_kill_id}/)**")
        else:
            st.markdown("_(No zKill Link)_")
        st.divider()

        # Navigation ...
        col_nav1, col_nav2 = st.columns(2)
        with col_nav1:
            if st.button("⬅️ Previous Camp", use_container_width=True):
                st.session_state.current_camp_index = (
                    st.session_state.current_camp_index - 1 + total_camps_in_cluster
                ) % total_camps_in_cluster
                st.rerun()
        with col_nav2:
            if st.button("Next Camp ➡️", use_container_width=True):
                st.session_state.current_camp_index = (
                    st.session_state.current_camp_index + 1
                ) % total_camps_in_cluster
                st.rerun()
        st.divider()

        # Camp Summary ...
        st.subheader("Camp Summary")
        col_s1, col_s2, col_s3, col_s4 = st.columns(4)
        with col_s1:
            st.metric(
                "System",
                get_system_name(current_camp["system_id"]),
                delta=f"ID: {current_camp['system_id']}",
                delta_color="off",
            )
            st.markdown(f"**Location:** {current_camp.get('stargate_name', 'Unknown')}")
        with col_s2:
            st.metric("Duration", format_duration(current_camp.get("duration_seconds")))
            st.metric(
                "Max Probability",
                f"{current_camp['max_probability']:.0f}%"
                if pd.notna(current_camp["max_probability"])
                else "N/A",
            )
        with col_s3:
            st.metric(
                "Final Kills",
                f"{current_camp['final_kill_count']:.0f}"
                if pd.notna(current_camp["final_kill_count"])
                else "N/A",
            )
            st.metric(
                "Total Value",
                f"{current_camp['total_value']:,.0f} ISK"
                if pd.notna(current_camp["total_value"])
                else "N/A ISK",
            )
        with col_s4:
            st.metric("Camp Type", current_camp.get("camp_type", "N/A").capitalize())
            status_text, status_icon = get_classification_status(
                current_camp.get("classifier")
            )
            st.markdown(f"**Manual Class:** {status_icon} {status_text}")
            st.markdown(
                f"**Cluster Label:** `{current_camp.get('cluster_label', 'N/A')}`"
            )
        st.divider()

        # --- Tabs for Interpretability ---
        tab_details, tab_dist, tab_viz = st.tabs(
            ["Camp Details", "Feature Distributions", "Cluster Visualization (2D)"]
        )

        with tab_details:
            st.subheader("Raw Camp Details")
            with st.expander("Show Full Camp Details JSON"):
                if not camp_details_main:
                    st.warning("No detailed camp data available.")
                else:
                    st.json(camp_details_main, expanded=False)
                # Add back the more detailed kill/comp/metrics tabs if desired

        with tab_dist:
            st.subheader(
                f"Feature Distributions for Cluster {st.session_state.selected_cluster} vs Overall"
            )
            st.markdown(
                "Comparing how key numeric features are distributed within this cluster compared to all camps."
            )

            # Need all_df for comparison, get from session state
            all_df_dist = st.session_state.all_data

            # Recalculate count for safety within this block
            count_dist = len(filtered_df)

            if count_dist > 0:
                dist_cols = [
                    "duration_seconds",
                    "total_value",
                    "max_probability",
                    "final_kill_count",
                    "num_kills",
                    "num_attackers",
                ]
                # Use plotly for interactive plots
                for col in dist_cols:
                    if (
                        col in filtered_df.columns  # Use filtered_df here
                        and col in all_df_dist.columns
                        and filtered_df[col].notna().any()  # Check filtered_df
                    ):
                        # Create temporary dfs for plotting
                        df_plot_cluster = filtered_df[[col]].copy()
                        df_plot_cluster["Source"] = (
                            f"Cluster {st.session_state.selected_cluster}"
                        )
                        df_plot_all = all_df_dist[[col]].copy()
                        df_plot_all["Source"] = "Overall"
                        df_plot = pd.concat(
                            [df_plot_cluster, df_plot_all], ignore_index=True
                        )

                        # Use histogram
                        try:
                            fig = px.histogram(
                                df_plot,
                                x=col,
                                color="Source",
                                marginal="box",  # Add box plot marginal
                                barmode="overlay",
                                opacity=0.7,
                                title=f"Distribution of {col.replace('_', ' ').title()}",
                            )
                            st.plotly_chart(fig, use_container_width=True)
                        except Exception as plot_err:
                             st.warning(f"Could not plot distribution for '{col}': {plot_err}")

                    else:
                        st.write(
                            f"Not enough data or column missing for '{col}' distribution plot."
                        )
            else:
                st.write("No data in this cluster to plot distributions.")

        with tab_viz:
            st.subheader("2D Cluster Visualization (PCA)")
            st.markdown(
                "Shows how camps separate in a reduced 2D space based on all features used for clustering. Colors represent cluster labels."
            )

            if (
                st.session_state.X_prepared_viz is not None
                and st.session_state.viz_cluster_labels is not None
                and st.session_state.viz_ids is not None # Check ids too
            ):
                with st.spinner("Reducing dimensions with PCA..."):
                    try:
                        pca = PCA(n_components=2, random_state=42)
                        # Ensure X_prepared_viz is not empty before transforming
                        if st.session_state.X_prepared_viz.shape[0] > 0:
                            X_pca = pca.fit_transform(st.session_state.X_prepared_viz)

                            df_pca = pd.DataFrame(
                                {
                                    "PCA1": X_pca[:, 0],
                                    "PCA2": X_pca[:, 1],
                                    "Cluster Label": st.session_state.viz_cluster_labels.astype(
                                        str
                                    ),
                                    "Camp ID": st.session_state.viz_ids,
                                }
                            )

                            highlight_cluster = str(st.session_state.selected_cluster)
                            df_pca["Size"] = df_pca["Cluster Label"].apply(
                                lambda x: 10 if x == highlight_cluster else 4
                            )
                            # This column holds the actual opacity values (1.0 or 0.5)
                            df_pca["Opacity_Values"] = df_pca["Cluster Label"].apply(
                                lambda x: 1.0 if x == highlight_cluster else 0.5
                            )

                            # Create the plot *without* the opacity parameter initially
                            fig_pca = px.scatter(
                                df_pca,
                                x="PCA1",
                                y="PCA2",
                                color="Cluster Label",
                                size="Size", # Keep size mapping by column name
                                hover_data=["Camp ID"],
                                title="2D PCA Visualization of Camp Clusters",
                                color_discrete_map={
                                    "-1": "grey"
                                },  # Color noise points grey
                            )

                            # --- CORRECTED PART ---
                            # Explicitly update the marker opacity using the values from the column
                            fig_pca.update_traces(marker=dict(opacity=df_pca['Opacity_Values']))
                            # --- END CORRECTED PART ---

                            fig_pca.update_layout(legend_title_text="Cluster Label")
                            st.plotly_chart(fig_pca, use_container_width=True)
                        else:
                                st.warning("No data points available for PCA visualization after preparation.")

                    except Exception as pca_err:
                        st.error(f"Failed to generate PCA plot: {pca_err}")
                        st.code(traceback.format_exc())
            else:
                st.warning(
                    "Prepared data for visualization is not available. Try reloading data."
                )

# --- End of Main Display Area ---