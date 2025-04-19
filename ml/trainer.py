# active_learning_classifier.py

import streamlit as st
import pandas as pd
import psycopg2
import psycopg2.extras # For dictionary cursor
import os
import json
from dotenv import load_dotenv
from datetime import datetime, timedelta
import traceback # Import traceback for detailed error logging
import requests
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.preprocessing import LabelEncoder
import joblib # To potentially save/load model later (optional)

# --- Configuration & Initial Setup ---
load_dotenv()
DATABASE_URL = os.getenv("POSTGRES_URL")
ESI_SYSTEM_ENDPOINT = "https://esi.evetech.net/latest/universe/systems/{system_id}/?datasource=tranquility&language=en-us"
NUM_UNCERTAIN_TO_SHOW = 10 # How many uncertain camps to show at once
MIN_SAMPLES_FOR_TRAINING = 10 # Minimum labeled samples needed to train

st.set_page_config(layout="wide", page_title="EVE Camp Active Learner")

# --- Caching Decorators ---
# Clearable cache for data fetching
@st.cache_data(ttl=300) # Cache data for 5 minutes by default
def fetch_camps_data_cached():
    """Fetches all camp data, designed to be cleared for refetch."""
    return fetch_camps_data_internal()

# Stable cache for ESI lookups
@st.cache_data(ttl=3600*24) # Cache system names for a day
def get_system_name(system_id):
    """Looks up system name using ESI."""
    if not system_id or pd.isna(system_id):
        return "Unknown System"
    try:
        url = ESI_SYSTEM_ENDPOINT.format(system_id=int(system_id))
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()
        return data.get("name", f"ID: {system_id}")
    except requests.exceptions.RequestException as e:
        return f"ID: {system_id} (ESI Error)"
    except Exception as e:
        return f"ID: {system_id} (Parse Error)"

# --- Database Connection (Reuse from original script) ---
def get_db_connection():
    """Establishes a fresh connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False # Important for transactions
        return conn
    except Exception as e:
        st.error(f"Error establishing DB connection: {e}")
        return None

# --- Database Operations (Reuse and potentially adapt) ---
def update_classification(camp_id, classifier_value):
    """Updates the classifier for a specific camp. Gets its own connection."""
    conn_update = None
    try:
        conn_update = get_db_connection()
        if conn_update is None:
             st.error("Update failed: Could not establish DB connection.")
             return False
        with conn_update.cursor() as cur:
            safe_camp_id = int(camp_id)
            cur.execute("UPDATE expired_camps SET classifier = %s WHERE id = %s", (classifier_value, safe_camp_id))
        conn_update.commit()
        return True
    except Exception as e:
        pgcode = getattr(e, 'pgcode', None)
        st.error(f"Error updating classification for camp {camp_id}: {e} (pgcode: {pgcode})")
        if conn_update and conn_update.closed == 0:
            try: conn_update.rollback()
            except Exception: pass # Ignore rollback error after primary error
        return False
    finally:
        if conn_update and conn_update.closed == 0:
            try: conn_update.close()
            except Exception: pass

def fetch_camps_data_internal():
    """Internal function to fetch data, called by cached wrapper."""
    conn_local = None
    try:
        conn_local = get_db_connection()
        if conn_local is None: return pd.DataFrame()

        query = "SELECT * FROM expired_camps ORDER BY camp_start_time DESC"
        df = pd.read_sql(query, conn_local)

        # Basic Type Conversions (handle potential errors)
        if 'camp_details' in df.columns:
            def safe_json_loads(x):
                try: return json.loads(x) if isinstance(x, str) else x
                except json.JSONDecodeError: return None # Handle bad JSON
            df['camp_details'] = df['camp_details'].apply(safe_json_loads)

        for col in ['camp_start_time', 'last_kill_time', 'camp_end_time', 'processing_time']:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')

        # Ensure classifier is numeric or NaN
        if 'classifier' in df.columns:
             df['classifier'] = pd.to_numeric(df['classifier'], errors='coerce') # Convert to float (allows NaN)

        return df
    except Exception as e:
        st.error(f"Error fetching camps: {e}")
        st.code(traceback.format_exc())
        return pd.DataFrame()
    finally:
        if conn_local and conn_local.closed == 0:
            try: conn_local.close()
            except Exception: pass

# --- Feature Engineering ---
def calculate_duration_seconds(start_time, end_time):
    if pd.isna(start_time) or pd.isna(end_time): return None
    # Ensure timezone naive for subtraction
    if start_time.tzinfo is not None: start_time = start_time.tz_localize(None)
    if end_time.tzinfo is not None: end_time = end_time.tz_localize(None)
    try:
        duration_td = end_time - start_time
        return duration_td.total_seconds()
    except TypeError:
        return None

def prepare_data(df):
    """Selects features, handles missing values, and encodes categoricals."""
    features = df.copy()

    # 1. Feature Creation / Selection
    features['duration_seconds'] = features.apply(lambda row: calculate_duration_seconds(row['camp_start_time'], row['camp_end_time']), axis=1)
    features['hour_of_day'] = features['camp_start_time'].dt.hour
    features['day_of_week'] = features['camp_start_time'].dt.dayofweek

    # Extract features from camp_details (safely)
    features['num_kills'] = features['camp_details'].apply(lambda x: len(x['kills']) if isinstance(x, dict) and 'kills' in x and isinstance(x['kills'], list) else 0)
    features['num_attackers'] = features['camp_details'].apply(lambda x: x.get('composition', {}).get('activeCount') if isinstance(x, dict) else None)
    features['num_corps'] = features['camp_details'].apply(lambda x: x.get('composition', {}).get('numCorps') if isinstance(x, dict) else None)
    features['num_alliances'] = features['camp_details'].apply(lambda x: x.get('composition', {}).get('numAlliances') if isinstance(x, dict) else None)

    # Define columns to use
    numeric_cols = ['duration_seconds', 'max_probability', 'final_kill_count',
                    'total_value', 'num_kills', 'num_attackers', 'num_corps',
                    'num_alliances', 'hour_of_day', 'day_of_week']
    categorical_cols = ['system_id', 'camp_type'] # Keep stargate_name out for simplicity for now? Add if needed.

    # 2. Handle Missing Values (Simple Strategy)
    for col in numeric_cols:
        if col in features.columns:
             # Use -1 or median as fill value, depending on context. -1 might be okay for counts/duration.
             features[col] = pd.to_numeric(features[col], errors='coerce').fillna(-1)
        else:
             features[col] = -1 # Add column if missing entirely

    for col in categorical_cols:
         if col in features.columns:
              # Ensure 'category' dtype before filling NA
              features[col] = features[col].astype('category')
              if features[col].isnull().any():
                   # Add 'Unknown' category if it doesn't exist
                   if 'Unknown' not in features[col].cat.categories:
                       features[col] = features[col].cat.add_categories('Unknown')
              features[col] = features[col].fillna('Unknown')
         else:
              features[col] = 'Unknown'
              features[col] = features[col].astype('category') # Ensure type

    # 3. Encode Categorical Variables
    # Use pd.get_dummies, store columns used during training
    features_encoded = pd.get_dummies(features[numeric_cols + categorical_cols],
                                      columns=categorical_cols,
                                      dummy_na=False) # Don't create NaN columns

    # Return the encoded features and the original index to map back
    return features_encoded, features.index

# --- Model Training ---
def train_model(X_train, y_train):
    """Trains a RandomForestClassifier."""
    st.write(f"Training model on {len(X_train)} samples...")
    if len(X_train) < MIN_SAMPLES_FOR_TRAINING:
        st.warning(f"Not enough labeled samples ({len(X_train)}) to train. Need at least {MIN_SAMPLES_FOR_TRAINING}.")
        return None, None

    if len(np.unique(y_train)) < 2:
         st.warning(f"Only one class ({np.unique(y_train)[0]}) present in the labeled data. Cannot train classifier.")
         return None, None

    try:
        # Use class_weight='balanced' to handle potential imbalance
        model = RandomForestClassifier(n_estimators=100, random_state=42, class_weight='balanced', n_jobs=-1)
        model.fit(X_train, y_train)
        st.success("Model trained successfully!")

        # Get feature names after fitting
        feature_names = X_train.columns.tolist()

        return model, feature_names
    except Exception as e:
        st.error(f"Error during model training: {e}")
        st.code(traceback.format_exc())
        return None, None

# --- Helper Functions ---
def format_duration(start_time, end_time):
    """Formats duration between two timestamps."""
    seconds = calculate_duration_seconds(start_time, end_time)
    if seconds is None or seconds < 0: return "N/A"
    total_seconds = int(seconds)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}h {minutes}m {seconds}s"

def get_classification_status(classifier_val):
    """Gets text and icon for classification status."""
    if pd.isna(classifier_val): val = None
    else:
        try: val = int(classifier_val)
        except (ValueError, TypeError): val = "Invalid"
    status_map = {None: ("Not Classified", "⚪"), 0: ("False", "🔴"), 1: ("True", "🟢")}
    return status_map.get(val, ("Invalid", "❓"))


# --- Initialize Session State ---
if 'model' not in st.session_state: st.session_state.model = None
if 'feature_names' not in st.session_state: st.session_state.feature_names = None
if 'uncertain_camps' not in st.session_state: st.session_state.uncertain_camps = pd.DataFrame()
if 'all_data' not in st.session_state: st.session_state.all_data = pd.DataFrame()
if 'data_loaded' not in st.session_state: st.session_state.data_loaded = False

# --- Main App Logic ---

st.title("🚀 EVE Gate Camp Active Learner")
st.markdown("""
This tool helps prioritize which gate camps to classify manually.
1.  It trains a model on already classified camps.
2.  It predicts the classification for unclassified camps.
3.  It shows you the camps the model is **most uncertain** about first.
4.  Classify these uncertain camps using the buttons.
5.  Click **Retrain Model** periodically to incorporate your new labels.
""")

# Load data only once unless forced by retraining
if not st.session_state.data_loaded:
    st.session_state.all_data = fetch_camps_data_cached()
    if not st.session_state.all_data.empty:
        st.session_state.data_loaded = True
    else:
        st.error("Failed to load initial data.")
        st.stop() # Stop execution if data loading failed

# Separate labeled and unlabeled data
all_df = st.session_state.all_data
labeled_df = all_df[all_df['classifier'].notna()].copy()
unlabeled_df = all_df[all_df['classifier'].isna()].copy()

st.sidebar.header("📊 Data Status")
st.sidebar.metric("Total Camps", len(all_df))
st.sidebar.metric("Camps Labeled", len(labeled_df))
st.sidebar.metric("Camps Unlabeled", len(unlabeled_df))

# --- Training Section ---
st.sidebar.header("🧠 Model Training")

# Train initially or if model doesn't exist in state
if st.session_state.model is None and not labeled_df.empty:
    st.sidebar.write("Training initial model...")
    X_labeled_prepared, _ = prepare_data(labeled_df) # Use index from labeled_df
    y_labeled = labeled_df['classifier'].astype(int) # Target variable

    # Align columns just in case prepare_data added/removed some based on input
    # (Shouldn't happen if called on full DFs, but good practice)
    # This step is more crucial when preparing prediction data later

    st.session_state.model, st.session_state.feature_names = train_model(X_labeled_prepared, y_labeled)
    if st.session_state.model is None:
         st.sidebar.warning("Initial model training failed or yielded no model.")
    else:
         st.sidebar.success("Initial model ready.")

elif st.session_state.model is None and labeled_df.empty:
     st.sidebar.warning("No labeled data found. Please classify some camps first using the other tool or database directly.")


# Retraining Button
if st.sidebar.button("🔁 Retrain Model", key="retrain_button", help="Retrain the model using all currently labeled data."):
    with st.spinner("Retraining in progress..."):
        # Clear cache to get fresh data including recent classifications
        fetch_camps_data_cached.clear()
        st.session_state.all_data = fetch_camps_data_cached() # Refetch
        st.session_state.data_loaded = not st.session_state.all_data.empty

        if st.session_state.data_loaded:
            # Reseparate data
            labeled_df = st.session_state.all_data[st.session_state.all_data['classifier'].notna()].copy()
            unlabeled_df = st.session_state.all_data[st.session_state.all_data['classifier'].isna()].copy()

            if not labeled_df.empty:
                X_labeled_prepared, _ = prepare_data(labeled_df)
                y_labeled = labeled_df['classifier'].astype(int)
                st.session_state.model, st.session_state.feature_names = train_model(X_labeled_prepared, y_labeled)
                st.session_state.uncertain_camps = pd.DataFrame() # Clear old uncertainty list
                st.rerun() # Rerun to reflect changes and recalculate uncertainty
            else:
                st.session_state.model = None
                st.session_state.feature_names = None
                st.session_state.uncertain_camps = pd.DataFrame()
                st.sidebar.warning("No labeled data found after refetching.")
                st.rerun()
        else:
             st.error("Failed to reload data for retraining.")
             st.session_state.model = None # Reset model state if data failed
             st.session_state.feature_names = None
             st.session_state.uncertain_camps = pd.DataFrame()
             st.rerun()


# --- Prediction and Uncertainty Calculation ---
# Calculate only if model exists and uncertain camps haven't been calculated yet this session/after retrain
if st.session_state.model is not None and st.session_state.uncertain_camps.empty and not unlabeled_df.empty:
     st.write("Calculating predictions and uncertainty for unlabeled camps...")
     try:
         X_unlabeled_prepared, original_indices = prepare_data(unlabeled_df)

         # **Crucial Step**: Align columns of prediction data with training data
         missing_cols = set(st.session_state.feature_names) - set(X_unlabeled_prepared.columns)
         for c in missing_cols:
             X_unlabeled_prepared[c] = 0 # Add missing columns initialized to 0
         extra_cols = set(X_unlabeled_prepared.columns) - set(st.session_state.feature_names)
         X_unlabeled_prepared = X_unlabeled_prepared.drop(columns=list(extra_cols)) # Drop columns not seen during training
         X_unlabeled_prepared = X_unlabeled_prepared[st.session_state.feature_names] # Ensure exact column order

         # Predict probabilities [prob_class_0, prob_class_1]
         probabilities = st.session_state.model.predict_proba(X_unlabeled_prepared)

         # Calculate uncertainty (closeness to 0.5 for the predicted class probability)
         # A simpler uncertainty: absolute difference from 0.5 for prob_class_1
         uncertainty_scores = np.abs(probabilities[:, 1] - 0.5)

         # Create DataFrame with results
         results_df = pd.DataFrame({
             'id': unlabeled_df.loc[original_indices, 'id'], # Map back using original index
             'prob_class_1': probabilities[:, 1],
             'uncertainty': uncertainty_scores
         })

         # Merge with original unlabeled data to get other columns for display
         uncertain_camps_all = pd.merge(unlabeled_df, results_df, on='id')

         # Sort by uncertainty (lowest score = most uncertain)
         st.session_state.uncertain_camps = uncertain_camps_all.sort_values(by='uncertainty', ascending=True).reset_index(drop=True)

         st.success(f"Identified {len(st.session_state.uncertain_camps)} uncertain camps.")
         st.rerun() # Rerun to display the uncertain camps list

     except Exception as e:
         st.error(f"Error during prediction/uncertainty calculation: {e}")
         st.code(traceback.format_exc())
         st.session_state.uncertain_camps = pd.DataFrame() # Ensure it's empty on error

# --- Display Uncertain Camps for Classification ---
st.header(" Camps to Classify (Most Uncertain First)")

if st.session_state.model is None:
    st.warning("Model is not trained. Please ensure there is labeled data and click 'Retrain Model'.")
elif st.session_state.uncertain_camps.empty and unlabeled_df.empty:
     st.info("🎉 All camps have been classified!")
elif st.session_state.uncertain_camps.empty and not unlabeled_df.empty:
     st.info("Calculating uncertainty or waiting for model... If this persists, check logs or try retraining.")
elif not st.session_state.uncertain_camps.empty:
    # Get the top N uncertain camps that haven't been classified in *this session*
    # (We rely on reruns and refetching for permanent updates)
    display_camps = st.session_state.uncertain_camps.head(NUM_UNCERTAIN_TO_SHOW)

    st.write(f"Showing the top {len(display_camps)} most uncertain camps:")

    for index, camp in display_camps.iterrows():
        camp_id = camp['id']
        st.markdown("---")
        col1, col2, col3, col4 = st.columns([2, 2, 1, 1.5])

        with col1:
             system_name = get_system_name(camp['system_id'])
             st.metric("System", system_name, delta=f"ID: {camp['system_id']}", delta_color="off")
             st.markdown(f"**Location:** {camp.get('stargate_name', 'Unknown')}")

        with col2:
            st.metric("Duration", format_duration(camp['camp_start_time'], camp['camp_end_time']))
            prob_true = camp['prob_class_1']
            st.metric("Model Prediction (Prob. True)", f"{prob_true:.2f}",
                      delta=f"Uncertainty: {camp['uncertainty']:.3f}", # Lower is more uncertain
                      delta_color="off")

        with col3:
            st.write(f"**DB ID:** {camp_id}")
            # Add zkill link if details exist
            first_kill_id = None
            camp_details = camp.get('camp_details', {})
            if camp_details and camp_details.get('kills'):
                first_kill_list = camp_details['kills']
                if first_kill_list and isinstance(first_kill_list[0], dict):
                    first_kill_id = first_kill_list[0].get('killID')
            if first_kill_id and isinstance(first_kill_id, int):
                zkill_url = f"https://zkillboard.com/kill/{first_kill_id}/"
                st.markdown(f"**[zKill (First Kill) ↗]({zkill_url})**")
            else:
                st.caption("_(No zKill Link)_")


        with col4:
            st.write("**Classify this Camp:**")
            button_key_base = f"camp_{camp_id}_{index}" # Unique key for buttons

            # Use columns within this column for button layout
            b_col1, b_col2 = st.columns(2)
            with b_col1:
                 if st.button("✔️ TRUE", key=f"{button_key_base}_true", type="primary", use_container_width=True):
                     if update_classification(camp_id, 1):
                         st.success(f"Camp {camp_id} classified as TRUE.")
                         # Remove from session state list immediately for better UX
                         st.session_state.uncertain_camps = st.session_state.uncertain_camps[st.session_state.uncertain_camps['id'] != camp_id]
                         st.rerun() # Rerun to refresh display
                     else:
                         st.error(f"Failed to update camp {camp_id} in DB.")

            with b_col2:
                if st.button("❌ FALSE", key=f"{button_key_base}_false", use_container_width=True):
                     if update_classification(camp_id, 0):
                         st.success(f"Camp {camp_id} classified as FALSE.")
                         # Remove from session state list immediately
                         st.session_state.uncertain_camps = st.session_state.uncertain_camps[st.session_state.uncertain_camps['id'] != camp_id]
                         st.rerun() # Rerun to refresh display
                     else:
                         st.error(f"Failed to update camp {camp_id} in DB.")

        # Optional: Expander for more details
        with st.expander("Show More Details & Raw Data"):
             st.dataframe(pd.DataFrame(camp).transpose()) # Show raw data for this camp


    if len(st.session_state.uncertain_camps) > NUM_UNCERTAIN_TO_SHOW:
         st.info(f"There are {len(st.session_state.uncertain_camps) - NUM_UNCERTAIN_TO_SHOW} more uncertain camps. Classify the ones above, then Retrain or Reload.")

else:
     st.info("No uncertain camps to display currently. Either all camps are labeled, or the model needs training/retraining.")