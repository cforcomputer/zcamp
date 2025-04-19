# dbscan_clusterer.py (REVISED FOR SYSTEM/TIME/PROBABILITY CLUSTERING - REFORMATTED with Black)

import streamlit as st
import pandas as pd
import numpy as np
import psycopg2
import psycopg2.extras  # For dictionary cursor, execute_values
import os
import json
from dotenv import load_dotenv
import traceback
import time
import math  # For sin/cos
from collections import Counter  # For finding dominant group

# ML / Plotting imports
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors
import matplotlib.pyplot as plt

# --- Configuration ---
load_dotenv()
DATABASE_URL = os.getenv("POSTGRES_URL")
TABLE_NAME = "expired_camps"
TABLE_SCHEMA = "public"

# !!! CRITICAL DBSCAN PARAMETERS - NEED TUNING FOR *NEW* FEATURE SPACE !!!
# Resetting AGAIN as the feature space has completely changed.
DBSCAN_MIN_SAMPLES = 3  # Keep min camps per cluster low as requested
DBSCAN_EPS = 0.5  # STARTING GUESS - MUST BE RE-TUNED using k-distance plot!

st.set_page_config(layout="wide", page_title="EVE Camp Activity Clusterer")
st.title("DBSCAN Clustering for System/Time/Probability Patterns")
st.markdown(
    f"""
This script attempts to cluster camp activity based on **System ID**, **Time of Day**, and **Max Probability**.
- It ignores features like duration, value, attacker groups etc.
- It uses cyclical time features (sin/cos of hour).
- **Action Required:** Run this script. Examine the **new k-distance plot (k={DBSCAN_MIN_SAMPLES})** generated based on *these specific features*. Update `DBSCAN_EPS` at the top of this script based on the plot's elbow, then rerun. The current `eps={DBSCAN_EPS}` is just a starting guess. Be aware that many unique System IDs can make tuning harder.
"""
)


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


# --- Function to Ensure Column Exists ---
def ensure_cluster_label_column(conn):
    """Checks if cluster_label column exists and tries to add it if not."""
    if conn is None or conn.closed != 0:
        st.error("DB invalid for column check.")
        return False
    column_exists = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name='cluster_label';",
                (TABLE_SCHEMA, TABLE_NAME),
            )
            column_exists = cur.fetchone() is not None
        if column_exists:
            return True
        else:
            st.warning(f"Column 'cluster_label' not found. Adding...")
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"ALTER TABLE {TABLE_SCHEMA}.{TABLE_NAME} ADD COLUMN IF NOT EXISTS cluster_label INTEGER;"
                    )
                conn.commit()
                st.success("Column 'cluster_label' added.")
                return True
            except Exception as alter_err:
                conn.rollback()
                st.error(f"Failed: {alter_err}")
                st.code(
                    f"ALTER TABLE {TABLE_SCHEMA}.{TABLE_NAME} ADD COLUMN cluster_label INTEGER;",
                    language="sql",
                )
                return False
    except Exception as check_err:
        try:
            conn.rollback()
        except Exception:
            pass
        st.error(f"Error checking column: {check_err}")
        return False


# --- Data Fetching ---
@st.cache_data(ttl=600)
def fetch_focused_camp_data():
    """Fetches only data needed for System/Time/Probability clustering."""
    conn_local = None
    st.info("Fetching relevant data (ID, Time, System, Probability)...")
    start_time = time.time()
    try:
        conn_local = get_db_connection()
        if conn_local is None:
            return pd.DataFrame()
        # Fetch necessary columns
        query = f"SELECT id, camp_start_time, system_id, max_probability FROM {TABLE_SCHEMA}.{TABLE_NAME}"
        df = pd.read_sql(query, conn_local)
        # Type Conversions
        if "camp_start_time" in df.columns:
            df["camp_start_time"] = pd.to_datetime(df["camp_start_time"], errors="coerce")
        else:
            st.error("camp_start_time missing!")
            return pd.DataFrame()
        if "max_probability" in df.columns:
            df["max_probability"] = pd.to_numeric(df["max_probability"], errors="coerce")
        else:
            df["max_probability"] = np.nan  # Ensure column exists
        if "system_id" in df.columns:
            df["system_id"] = pd.to_numeric(
                df["system_id"], errors="coerce"
            )  # Keep as number initially for fillna check
        else:
            df["system_id"] = np.nan

        duration_s = time.time() - start_time
        st.success(f"Fetched {len(df)} records in {duration_s:.2f} seconds.")
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


# --- Feature Engineering for NEW Clustering (System/Time/Probability) ---
def prepare_system_time_prob_features(df):
    """Prepares features: System ID, Time (Cyclical), Max Probability."""
    st.info("Preparing System/Time/Probability features...")
    features = df[["id", "camp_start_time", "system_id", "max_probability"]].copy()

    # 1. Handle Missing / Invalid Start Times
    features = features.dropna(subset=["camp_start_time"])
    if features.empty:
        st.error("No valid start times found.")
        return None, None

    # 2. Encode Time Cyclically
    hour = features["camp_start_time"].dt.hour
    features["time_sin"] = np.sin(2 * math.pi * hour / 24)
    features["time_cos"] = np.cos(2 * math.pi * hour / 24)

    # 3. Handle Missing Probability and System ID
    features["max_probability"] = features["max_probability"].fillna(
        0
    )  # Fill missing prob with 0
    # Use a placeholder like 0 for missing system ID, convert to string for OHE
    features["system_id"] = features["system_id"].fillna(0).astype(int).astype(str)

    # 4. Define Columns for Preprocessing
    numeric_features = ["max_probability", "time_sin", "time_cos"]
    categorical_features = ["system_id"]

    feature_subset = features[["id"] + numeric_features + categorical_features].copy()

    # 5. Preprocessing Pipeline (Scale numerics, OneHotEncode system_id)
    numeric_transformer = Pipeline(steps=[("scaler", StandardScaler())])
    # handle_unknown='ignore' is important if new systems appear between runs
    # sparse_output=False might be needed depending on memory, but True is default and often fine
    categorical_transformer = Pipeline(
        steps=[("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=True))]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, numeric_features),
            ("cat", categorical_transformer, categorical_features),
        ],
        remainder="drop",  # Drop 'id'
    )

    pipeline = Pipeline(steps=[("preprocessor", preprocessor)])

    try:
        X_prepared = pipeline.fit_transform(
            feature_subset[numeric_features + categorical_features]
        )
        st.success("System/Time/Probability features prepared.")
        # Return processed data (potentially sparse) and original IDs
        return X_prepared, feature_subset["id"]
    except ValueError as ve:
        if "contains negative values" in str(ve):
            st.error(
                f"Feature engineering error: Problem with data before scaling (check NaNs or values like -1): {ve}"
            )
        else:
            st.error(f"Feature engineering error: {ve}")
        return None, None
    except Exception as e:
        st.error(f"Feature engineering error: {e}")
        st.code(traceback.format_exc())
        return None, None


# --- Database Update ---
def update_cluster_labels_bulk(camp_ids, cluster_labels):
    """Updates the cluster_label for multiple camps efficiently."""
    if len(camp_ids) != len(cluster_labels):
        st.error("ID/label mismatch.")
        return 0
    if isinstance(camp_ids, (pd.Series, pd.Index)):
        camp_ids_list = camp_ids.tolist()
    elif isinstance(camp_ids, np.ndarray):
        camp_ids_list = camp_ids.tolist()
    else:
        camp_ids_list = list(camp_ids)
    if not camp_ids_list:
        st.warning("No IDs for update.")
        return 0
    conn_update = None
    updated_count = 0
    st.info(f"Attempting update for {len(camp_ids_list)} camps...")
    start_time = time.time()
    update_data = [
        (int(cl), int(cid)) for cl, cid in zip(cluster_labels, camp_ids_list)
    ]
    try:
        conn_update = get_db_connection()
        if conn_update is None:
            st.error("DB Update failed: No connection.")
            return 0
        with conn_update.cursor() as cur:
            update_query = f"UPDATE {TABLE_SCHEMA}.{TABLE_NAME} SET cluster_label = data.cluster_label FROM (VALUES %s) AS data(cluster_label, id) WHERE {TABLE_SCHEMA}.{TABLE_NAME}.id = data.id"
            psycopg2.extras.execute_values(
                cur, update_query, update_data, template=None, page_size=500
            )
            updated_count = cur.rowcount
        conn_update.commit()
        duration_s = time.time() - start_time
        st.success(
            f"Successfully updated {updated_count} cluster labels in {duration_s:.2f} seconds."
        )
        return updated_count
    except Exception as e:
        pgcode = getattr(e, "pgcode", None)
        st.error(f"Error updating labels: {e} (pgcode: {pgcode})")
        st.code(traceback.format_exc())
        if conn_update and conn_update.closed == 0:
            try:
                conn_update.rollback()
            except Exception:
                pass
        return 0
    finally:
        if conn_update and conn_update.closed == 0:
            try:
                conn_update.close()
            except Exception:
                pass


# --- Main Execution ---
conn = get_db_connection()
column_ready = False
if conn:
    column_ready = ensure_cluster_label_column(conn)
    if conn.closed == 0:
        try:
            conn.close()
        except Exception:
            pass
else:
    st.error("Could not establish initial DB connection.")

if column_ready:
    if st.button(
        f"Run System/Time/Probability DBSCAN (eps={DBSCAN_EPS}, min_samples={DBSCAN_MIN_SAMPLES})"
    ):
        # 1. Fetch Data
        data_df = fetch_focused_camp_data()  # Fetch specific columns

        if data_df.empty:
            st.error("Cannot proceed without data.")
        elif "id" not in data_df.columns:
            st.error("Dataframe missing 'id' column.")
        else:
            # 2. Prepare Features (NEW approach)
            X_processed, camp_ids_ordered = prepare_system_time_prob_features(data_df)

            if X_processed is None or camp_ids_ordered is None:
                st.error("Feature preparation failed. Cannot run DBSCAN.")
            # Check if X_processed is a sparse matrix or numpy array for shape check
            elif (
                hasattr(X_processed, "shape") and X_processed.shape[0] == 0
            ) or (not hasattr(X_processed, "shape") and not X_processed):
                st.warning(
                    "No data points remaining after feature preparation (check for valid start times)."
                )
            else:
                # --- k-distance plot ---
                st.info(
                    f"Estimating optimal EPS for NEW features (k={DBSCAN_MIN_SAMPLES})..."
                )
                k = DBSCAN_MIN_SAMPLES
                n_samples_available = X_processed.shape[0]
                if n_samples_available <= k:
                    st.warning(f"Not enough samples ({n_samples_available}) for k={k}.")
                else:
                    try:
                        # algorithm='kd_tree' or 'ball_tree' might be faster
                        nbrs = NearestNeighbors(
                            n_neighbors=k, algorithm="auto", n_jobs=-1
                        ).fit(X_processed)
                        distances, indices = nbrs.kneighbors(X_processed)
                        k_distances = np.sort(distances[:, k - 1], axis=0)
                        fig, ax = plt.subplots(figsize=(10, 5))
                        ax.plot(k_distances)
                        ax.set_title(
                            f"k-Distance Graph (k={k}) - System/Time/Probability Features"
                        )
                        ax.set_xlabel("Points sorted by distance")
                        ax.set_ylabel(f"{k}-th Nearest Neighbor Distance")
                        ax.grid(True)
                        st.pyplot(fig)
                        st.markdown(
                            f"**Action:** Examine the plot above. Find the 'elbow'. Update `DBSCAN_EPS` at the top, then rerun."
                        )
                    except Exception as plot_err:
                        st.warning(f"Could not generate k-distance plot: {plot_err}")

                # --- Run DBSCAN ---
                st.info(
                    f"Running DBSCAN with current settings (eps={DBSCAN_EPS}, min_samples={DBSCAN_MIN_SAMPLES})..."
                )
                start_time = time.time()
                try:
                    # metric='euclidean' is default
                    dbscan = DBSCAN(
                        eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, n_jobs=-1
                    )
                    dbscan.fit(X_processed)
                    cluster_labels = dbscan.labels_
                    duration_s = time.time() - start_time
                    st.success(f"DBSCAN finished in {duration_s:.2f} seconds.")

                    n_clusters = len(set(cluster_labels)) - (
                        1 if -1 in cluster_labels else 0
                    )
                    n_noise = np.sum(cluster_labels == -1)
                    st.metric("Clusters Found", n_clusters)
                    st.metric("Noise Points (Outliers)", n_noise)

                    # Update Database for the processed IDs
                    update_cluster_labels_bulk(camp_ids_ordered, cluster_labels)
                except Exception as e:
                    st.error(f"Error during DBSCAN execution: {e}")
                    st.code(traceback.format_exc())
else:
    st.error("Cannot proceed: 'cluster_label' column missing/uncreatable.")

st.markdown("---")
st.markdown(
    f"**Reminder:** Tune `DBSCAN_EPS` based on the k={DBSCAN_MIN_SAMPLES} distance plot for the *System/Time/Probability feature set*."
)