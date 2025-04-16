# camp_classifier.py

import streamlit as st
import pandas as pd
import psycopg2
import psycopg2.extras # For dictionary cursor
import os
import json
from dotenv import load_dotenv
from collections import defaultdict
from datetime import datetime, timedelta
import traceback # Import traceback for detailed error logging

# --- Configuration & Initial Setup ---
load_dotenv()
DATABASE_URL = os.getenv("POSTGRES_URL")
TIME_WINDOW_HOURS = 6 # For connected camps analysis

st.set_page_config(layout="wide", page_title="EVE Camp Analyzer")

# --- Database Connection ---
# NO @st.cache_resource
def get_db_connection():
    """Establishes a fresh connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False # Start transactions manually
        # Optional: Set keepalives if supported/needed, might help with timeouts
        # conn.autocommit = True # Temporarily enable autocommit to set keepalives
        # conn.cursor().execute("SET tcp_keepalives_idle = 60;")
        # conn.cursor().execute("SET tcp_keepalives_interval = 10;")
        # conn.cursor().execute("SET tcp_keepalives_count = 5;")
        # conn.autocommit = False # Disable autocommit again
        return conn
    except psycopg2.OperationalError as op_err:
         # More specific error for connection issues
         st.error(f"DB Connection Error: {op_err}")
         st.error("Please check DATABASE_URL in .env and ensure the database is running and accessible.")
         return None
    except Exception as e:
        st.error(f"Error establishing DB connection: {e}")
        return None

# --- Database Operations ---
# <<< MODIFIED Function: Added pre-check and detailed logging >>>
def update_classification(camp_id, classifier_value):
    """Updates the classifier for a specific camp. Gets its own connection."""
    conn_update = None
    try:
        # Step 1: Try to get a connection
        conn_update = get_db_connection()
        if conn_update is None:
             st.error("Update failed: Could not establish DB connection.")
             return False

        # Step 2: Check if the obtained connection is already closed (shouldn't happen ideally)
        if conn_update.closed != 0:
            st.error(f"Update failed: Connection for camp {camp_id} was already closed before starting transaction.")
            # Try closing object just in case, before returning
            try: conn_update.close()
            except: pass
            return False

        # Step 3: Proceed with transaction
        with conn_update.cursor() as cur:
            # Ensure camp_id is standard int
            safe_camp_id = int(camp_id)
            st.info(f"Attempting to update camp {safe_camp_id}...") # Log attempt

            cur.execute("UPDATE expired_camps SET classifier = %s WHERE id = %s", (classifier_value, safe_camp_id))

        # Step 4: Commit
        conn_update.commit()
        st.success(f"Successfully updated camp {safe_camp_id}.") # More specific success
        return True

    except (psycopg2.InterfaceError, psycopg2.OperationalError) as conn_err:
        # Handle specific connection errors during execute/commit
        st.error(f"Connection Error during update for camp {camp_id}: {conn_err}")
        st.error("The database connection was likely lost or closed unexpectedly.")
        # Log detailed traceback for debugging
        st.error("Traceback:")
        st.code(traceback.format_exc())
        # No rollback needed/possible if connection is dead
        return False
    except Exception as e:
        # Handle other potential errors (data issues, SQL errors etc.)
        pgcode = getattr(e, 'pgcode', None) # Get Postgres error code if available
        st.error(f"Error updating classification for camp {camp_id}: {e} (pgcode: {pgcode})")
        # Log detailed traceback
        st.error("Traceback:")
        st.code(traceback.format_exc())
        # Attempt rollback ONLY if connection seems open after other errors
        if conn_update and conn_update.closed == 0:
            try:
                conn_update.rollback()
                st.warning("Transaction rolled back due to error.")
            except Exception as rb_e:
                 st.warning(f"Rollback attempt failed after error: {rb_e}")
        return False
    finally:
        # Step 5: Ensure connection closure attempt
        if conn_update:
            try:
                # Check again before closing, though close() handles closed connections
                if conn_update.closed == 0:
                     conn_update.close()
                # else: connection object exists but is already closed
            except Exception as close_e:
                 st.warning(f"Error during connection close: {close_e}")


@st.cache_data(ttl=300)
def fetch_camps_data(_trigger):
    """Fetches all camp data from the database. Gets and closes its own connection."""
    conn_local = None
    try:
        conn_local = get_db_connection()
        if conn_local is None:
            st.error("Database connection not available for fetching data.")
            return pd.DataFrame()

        # Check if connection is closed before using (belt and braces)
        if conn_local.closed != 0:
             st.error("Fetch failed: DB connection was closed.")
             try: conn_local.close()
             except: pass
             return pd.DataFrame()

        query = "SELECT * FROM expired_camps ORDER BY camp_start_time DESC"
        df = pd.read_sql(query, conn_local)

        # Convert JSON string to dict
        if 'camp_details' in df.columns:
            df['camp_details'] = df['camp_details'].apply(lambda x: json.loads(x) if isinstance(x, str) else x)
        # Convert timestamps
        for col in ['camp_start_time', 'last_kill_time', 'camp_end_time', 'processing_time']:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')
        return df
    except UserWarning as uw:
         # This specific warning is less critical, display differently
         st.sidebar.warning(f"Pandas Warning during fetch: {uw}")
         # Attempt to return data even if warning occurred
         # This requires df to be defined before the warning occurs, adjust try block if needed
         # If pd.read_sql raises the warning but still returns df, this works.
         # If it fails completely on warning, df won't exist here.
         # Safer to return empty on this specific warning for now.
         return pd.DataFrame()
    except (psycopg2.InterfaceError, psycopg2.OperationalError) as conn_err_fetch:
        st.error(f"Connection Error during fetch: {conn_err_fetch}")
        # Log detailed traceback for debugging
        st.error("Traceback:")
        st.code(traceback.format_exc())
        return pd.DataFrame()
    except Exception as e:
        st.error(f"Error fetching camps: {e}")
        st.error("Traceback:")
        st.code(traceback.format_exc())
        return pd.DataFrame()
    finally:
        if conn_local:
            try:
                 if conn_local.closed == 0:
                      conn_local.close()
            except Exception as close_e:
                 st.warning(f"Error closing fetch connection: {close_e}")


# --- Analysis Functions ---
def get_attacker_ids(camp_details):
    attacker_ids = set()
    if camp_details and 'kills' in camp_details and camp_details['kills']:
        for kill in camp_details['kills']:
            if kill and isinstance(kill, dict) and 'killmail' in kill and isinstance(kill['killmail'], dict) and kill['killmail'].get('attackers'):
                 attackers = kill['killmail']['attackers']
                 if isinstance(attackers, list):
                      for attacker in attackers:
                           if isinstance(attacker, dict) and attacker.get('character_id'):
                                attacker_ids.add(attacker['character_id'])
    return attacker_ids

def find_connected_camps(current_camp_series, all_camps_df, time_window_hours=TIME_WINDOW_HOURS):
    connected_camps_info = []
    required_cols = ['id', 'camp_details', 'camp_start_time', 'system_id', 'stargate_name', 'camp_unique_id']
    if all_camps_df.empty or any(col not in all_camps_df.columns for col in required_cols):
        return connected_camps_info

    current_camp_details = current_camp_series.get('camp_details')
    current_attackers = get_attacker_ids(current_camp_details)
    if not current_attackers: return connected_camps_info
    current_start_time = pd.to_datetime(current_camp_series['camp_start_time'])
    if pd.isna(current_start_time): return connected_camps_info

    time_delta = timedelta(hours=time_window_hours)
    start_window = current_start_time - time_delta
    end_window = current_start_time + time_delta

    if not pd.api.types.is_datetime64_any_dtype(all_camps_df['camp_start_time']):
        all_camps_df['camp_start_time'] = pd.to_datetime(all_camps_df['camp_start_time'], errors='coerce')

    nearby_camps = all_camps_df[
        (all_camps_df['camp_start_time'].notna()) &
        (all_camps_df['camp_start_time'] >= start_window) &
        (all_camps_df['camp_start_time'] <= end_window) &
        (all_camps_df['id'] != current_camp_series['id'])
    ].copy()

    if nearby_camps.empty: return connected_camps_info

    def safe_get_attackers(details): return get_attacker_ids(details)
    nearby_camps['attacker_sets'] = nearby_camps['camp_details'].apply(safe_get_attackers)

    for _, other_camp in nearby_camps.iterrows():
        other_attackers = other_camp['attacker_sets']
        if other_attackers is None: continue
        shared_attackers = current_attackers.intersection(other_attackers)
        if len(shared_attackers) >= 2:
            connected_camps_info.append({
                'id': other_camp['id'],
                'camp_unique_id': other_camp['camp_unique_id'],
                'system_id': other_camp['system_id'],
                'stargate_name': other_camp['stargate_name'],
                'start_time': other_camp['camp_start_time'],
                'shared_count': len(shared_attackers) })
    return connected_camps_info

# --- Helper Functions ---
def format_duration(start_time, end_time):
    if pd.isna(start_time) or pd.isna(end_time): return "N/A"
    if start_time.tzinfo is not None: start_time = start_time.tz_localize(None)
    if end_time.tzinfo is not None: end_time = end_time.tz_localize(None)
    try:
        duration_td = end_time - start_time
        total_seconds = int(duration_td.total_seconds())
        if total_seconds < 0: return "Invalid Range"
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours}h {minutes}m {seconds}s"
    except TypeError: return "Time Error"

def get_classification_status(classifier_val):
    if pd.isna(classifier_val): val = None
    else:
        try: val = int(classifier_val)
        except (ValueError, TypeError): val = "Invalid"
    status_map = {None: ("Not Classified", "⚪"), 0: ("False", "🔴"), 1: ("True", "🟢")}
    return status_map.get(val, ("Invalid", "❓"))

# --- Initialize Session State ---
if 'current_index' not in st.session_state: st.session_state.current_index = 0
if 'hide_classified' not in st.session_state: st.session_state.hide_classified = True
if 'camps_df' not in st.session_state: st.session_state.camps_df = pd.DataFrame()
if 'data_loaded' not in st.session_state: st.session_state.data_loaded = False

# --- Main App Logic ---
if not st.session_state.data_loaded:
     st.session_state.camps_df = fetch_camps_data("initial_load")
     if not st.session_state.camps_df.empty:
          st.session_state.current_index = 0
          st.session_state.data_loaded = True

# --- Sidebar Controls ---
with st.sidebar:
    st.header("Filters & Controls")
    st.session_state.hide_classified = st.checkbox(
        "Hide Already Classified", value=st.session_state.hide_classified, key="cb_hide_classified" )
    if st.button("Reload Data"):
        fetch_camps_data.clear() # Clear data cache
        st.session_state.camps_df = fetch_camps_data("reload_button")
        st.session_state.current_index = 0
        st.session_state.data_loaded = not st.session_state.camps_df.empty
        st.rerun()

# --- Filtering Data ---
if st.session_state.data_loaded and not st.session_state.camps_df.empty:
    filtered_df = st.session_state.camps_df.copy()
    if st.session_state.hide_classified:
        filtered_df = filtered_df[filtered_df['classifier'].isna()]
    if not filtered_df.empty and st.session_state.current_index >= len(filtered_df):
        st.session_state.current_index = 0
    elif filtered_df.empty:
         st.session_state.current_index = 0
else: filtered_df = pd.DataFrame()

# --- Display Area ---
st.title("EVE Gate Camp Classifier")

if not st.session_state.data_loaded and get_db_connection() is None:
     # If data never loaded AND we still can't connect, show persistent error
     st.error("Failed to connect to the database. Please check settings and ensure DB is running.")
elif not st.session_state.data_loaded:
     st.warning("Attempting to load data. If this persists, check database connection details and server logs.")
elif filtered_df.empty:
    st.warning(f"No {'unclassified ' if st.session_state.hide_classified else ''}camps found matching filters.")
else:
    current_camp = filtered_df.iloc[st.session_state.current_index]
    total_filtered_camps = len(filtered_df)

    st.header(f"Camp {st.session_state.current_index + 1} of {total_filtered_camps}")
    st.caption(f"Database ID: {current_camp['id']} | Unique ID: {current_camp['camp_unique_id']}")

    # --- Navigation and Classification ---
    col1, col2, col_spacer, col3, col4 = st.columns([1, 1, 2, 1, 1])
    with col1:
        if st.button("⬅️ Previous", use_container_width=True):
            st.session_state.current_index = (st.session_state.current_index - 1 + total_filtered_camps) % total_filtered_camps
            st.rerun()
    with col2:
        if st.button("Next ➡️", use_container_width=True):
            st.session_state.current_index = (st.session_state.current_index + 1) % total_filtered_camps
            st.rerun()

    is_classified = not pd.isna(current_camp['classifier'])
    classify_disabled = is_classified and st.session_state.hide_classified

    with col3:
        if st.button("Classify TRUE ✔️", type="primary", disabled=classify_disabled, use_container_width=True):
             if update_classification(int(current_camp['id']), 1):
                  st.session_state.camps_df.loc[st.session_state.camps_df['id'] == current_camp['id'], 'classifier'] = 1
                  st.success("Classified as TRUE")
                  if st.session_state.hide_classified:
                       fetch_camps_data.clear(); st.session_state.data_loaded = False; st.rerun()
                  else:
                       st.session_state.current_index = (st.session_state.current_index + 1) % total_filtered_camps; st.rerun()

    with col4:
        if st.button("Classify FALSE ❌", disabled=classify_disabled, use_container_width=True):
             if update_classification(int(current_camp['id']), 0):
                 st.session_state.camps_df.loc[st.session_state.camps_df['id'] == current_camp['id'], 'classifier'] = 0
                 st.success("Classified as FALSE")
                 if st.session_state.hide_classified:
                      fetch_camps_data.clear(); st.session_state.data_loaded = False; st.rerun()
                 else:
                       st.session_state.current_index = (st.session_state.current_index + 1) % total_filtered_camps; st.rerun()

    st.divider()

    # --- Camp Summary ---
    col_s1, col_s2 = st.columns(2)
    with col_s1:
        st.subheader("Camp Info")
        st.metric("System", f"{current_camp['system_id']}")
        location_name = current_camp.get('stargate_name', 'Unknown Location')
        st.markdown(f"**Location:** {location_name}")
        st.metric("Duration", format_duration(current_camp['camp_start_time'], current_camp['camp_end_time']))
        st.metric("Max Probability", f"{current_camp['max_probability']:.0f}%" if pd.notna(current_camp['max_probability']) else "N/A")

    with col_s2:
        st.subheader("Stats & Status")
        st.metric("Final Kills", f"{current_camp['final_kill_count']:.0f}" if pd.notna(current_camp['final_kill_count']) else "N/A")
        st.metric("Total Value", f"{current_camp['total_value']:,.0f} ISK" if pd.notna(current_camp['total_value']) else "N/A ISK")
        st.metric("Camp Type", current_camp.get('camp_type', "N/A").capitalize())
        status_text, status_icon = get_classification_status(current_camp['classifier'])
        st.markdown(f"**Classification:** {status_icon} {status_text}")

    st.divider()

    # --- Details Expander ---
    with st.expander("Show Full Details"):
        camp_details = current_camp.get('camp_details', {})
        if not camp_details: st.warning("No detailed camp data available.")
        else:
            kills_list = camp_details.get('kills', [])
            composition = camp_details.get('composition', {})
            metrics = camp_details.get('metrics', {})
            log = camp_details.get('probabilityLog', [])

            tab_kills, tab_comp, tab_metrics, tab_conn, tab_log = st.tabs([
                f" Kills ({len(kills_list)}) ", " Composition ", " Metrics ", " Connected Camps ", " Probability Log "])

            with tab_kills:
                 st.subheader("Kill Details")
                 if not kills_list: st.write("No kill data found in details.")
                 else:
                      kill_data_for_table = []
                      attacker_ships = defaultdict(list)
                      for i, kill in enumerate(kills_list):
                           if not kill or not isinstance(kill, dict) or 'killmail' not in kill or 'zkb' not in kill: continue
                           kill_id = kill.get('killID', f"no_id_{i}")
                           kill_time_str = kill['killmail'].get('killmail_time', 'N/A')
                           zkb_data = kill.get('zkb', {}); value = zkb_data.get('totalValue', 0)
                           labels = ", ".join(zkb_data.get('labels', [])) if zkb_data.get('labels') else "None"
                           url = f"https://zkillboard.com/kill/{kill_id}/" if isinstance(kill_id, int) else "#"
                           victim_ship_data = kill.get('shipCategories', {}).get('victim', {})
                           victim_ship = victim_ship_data.get('name', 'Unknown') if isinstance(victim_ship_data, dict) else 'Unknown'
                           attackers = kill['killmail'].get('attackers', []); attacker_count = len(attackers) if isinstance(attackers, list) else 0
                           kill_entry_summary = {
                               "Time": kill_time_str, "Victim Ship": victim_ship.capitalize(), "Value": f"{value:,.0f}",
                               "# Att": attacker_count, "Labels": labels, "URL": url, "kill_id": kill_id }
                           kill_data_for_table.append(kill_entry_summary)
                           if isinstance(attackers, list):
                               for attacker in attackers:
                                   if isinstance(attacker, dict):
                                       ship_type_id = attacker.get('ship_type_id')
                                       if ship_type_id: attacker_ships[ship_type_id].append(kill_entry_summary)
                      st.dataframe(pd.DataFrame(kill_data_for_table).set_index('kill_id'),
                                   column_config={"URL": st.column_config.LinkColumn("URL", display_text="zKill Link")}, use_container_width=True)
                      st.subheader("Kills by Attacker Ship Type")
                      if not attacker_ships: st.write("No attacker ship data found.")
                      else:
                          for ship_type_id, kills_involved in attacker_ships.items():
                              st.markdown(f"--- \n#### Attacker Ship ID: {ship_type_id} ({len(kills_involved)} kills involved)")
                              st.dataframe(pd.DataFrame(kills_involved).set_index('kill_id'),
                                           column_config={"URL": st.column_config.LinkColumn("URL", display_text="zKill Link")}, use_container_width=True)
            with tab_comp:
                st.subheader("Attacker Composition")
                if composition:
                    st.write(f"Original Attackers: {composition.get('originalCount', 'N/A')}")
                    st.write(f"Active Attackers: {composition.get('activeCount', 'N/A')}")
                    st.write(f"Killed Attackers: {composition.get('killedCount', 'N/A')}")
                    st.write(f"Involved Corps: {composition.get('numCorps', 'N/A')}")
                    st.write(f"Involved Alliances: {composition.get('numAlliances', 'N/A')}")
                else: st.write("No composition data.")
            with tab_metrics:
                st.subheader("Camp Metrics")
                if metrics:
                    first_seen_ts = metrics.get('firstSeen')
                    first_seen_str = datetime.fromtimestamp(first_seen_ts / 1000).strftime('%Y-%m-%d %H:%M:%S') if first_seen_ts else 'N/A'
                    st.write(f"First Seen: {first_seen_str}")
                    st.write(f"Total Duration (min): {metrics.get('campDuration', 'N/A')}")
                    st.write(f"Active Duration (min): {metrics.get('activeDuration', 'N/A')}")
                    st.write(f"Inactivity Duration (min): {metrics.get('inactivityDuration', 'N/A')}")
                    st.write(f"Pod Kills: {metrics.get('podKills', 'N/A')}")
                    avg_val = metrics.get('avgValuePerKill', 0)
                    st.write(f"Avg Value/Kill: {avg_val:,.0f} ISK" if avg_val else "N/A ISK")
                    party_metrics = metrics.get('partyMetrics', {})
                    if party_metrics:
                         st.write(f"Unique Characters Involved: {party_metrics.get('characters', 'N/A')}")
                         st.write(f"Unique Corporations Involved: {party_metrics.get('corporations', 'N/A')}")
                         st.write(f"Unique Alliances Involved: {party_metrics.get('alliances', 'N/A')}")
                else: st.write("No metrics data.")
            with tab_conn:
                 st.subheader("Connected Camps Analysis")
                 with st.spinner("Analyzing connections..."):
                     connected_camps = find_connected_camps(current_camp, st.session_state.camps_df)
                 if connected_camps:
                      conn_df = pd.DataFrame(connected_camps)
                      conn_df['start_time'] = pd.to_datetime(conn_df['start_time']).dt.strftime('%Y-%m-%d %H:%M')
                      conn_df_display = conn_df[['id', 'system_id', 'stargate_name', 'start_time', 'shared_count']].rename(columns={
                           'id': 'DB ID', 'system_id': 'System', 'stargate_name': 'Location',
                           'start_time': 'Start Time', 'shared_count': 'Shared Attackers'})
                      st.dataframe(conn_df_display, use_container_width=True)
                 else: st.write("No potentially connected camps found within the time window.")
            with tab_log:
                st.subheader("Probability Calculation Log")
                if log:
                    log_text = "\n".join(map(str, log))
                    st.text_area("Log", value=log_text, height=300, disabled=True)
                else: st.write("No probability log available.")

# --- Footer / Status ---
st.sidebar.markdown("---")
st.sidebar.caption(f"Data loaded: {st.session_state.data_loaded}")
if st.session_state.data_loaded and not st.session_state.camps_df.empty:
    st.sidebar.caption(f"Total camps in source: {len(st.session_state.camps_df)}")
    st.sidebar.caption(f"Showing: {len(filtered_df)} camps")