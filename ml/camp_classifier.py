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
import requests # <<< Added for ESI lookup

# --- Configuration & Initial Setup ---
load_dotenv()
DATABASE_URL = os.getenv("POSTGRES_URL")
TIME_WINDOW_HOURS = 6 # For connected camps analysis
ESI_SYSTEM_ENDPOINT = "https://esi.evetech.net/latest/universe/systems/{system_id}/?datasource=tranquility&language=en-us"

st.set_page_config(layout="wide", page_title="EVE Camp Analyzer")

# --- ESI System Name Lookup ---
@st.cache_data(ttl=3600*24) # Cache system names for a day
def get_system_name(system_id):
    """Looks up system name using ESI."""
    if not system_id or pd.isna(system_id):
        return "Unknown System"
    try:
        url = ESI_SYSTEM_ENDPOINT.format(system_id=int(system_id))
        response = requests.get(url, timeout=5) # Add timeout
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        data = response.json()
        return data.get("name", f"ID: {system_id}")
    except requests.exceptions.RequestException as e:
        # Don't flood UI with errors, just return ID on failure
        # st.warning(f"ESI request failed for system {system_id}: {e}")
        return f"ID: {system_id} (ESI Error)"
    except Exception as e:
        # st.warning(f"Failed to parse ESI data for system {system_id}: {e}")
        return f"ID: {system_id} (Parse Error)"

# --- Database Connection ---
# NO @st.cache_resource
def get_db_connection():
    """Establishes a fresh connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn
    except psycopg2.OperationalError as op_err:
         st.error(f"DB Connection Error: {op_err}")
         st.error("Please check DATABASE_URL in .env and ensure the database is running and accessible.")
         return None
    except Exception as e:
        st.error(f"Error establishing DB connection: {e}")
        return None

# --- Database Operations ---
def update_classification(camp_id, classifier_value):
    """Updates the classifier for a specific camp. Gets its own connection."""
    conn_update = None
    try:
        conn_update = get_db_connection()
        if conn_update is None:
             st.error("Update failed: Could not establish DB connection.")
             return False
        if conn_update.closed != 0:
            st.error(f"Update failed: Connection for camp {camp_id} was already closed before starting transaction.")
            try: conn_update.close()
            except: pass
            return False
        with conn_update.cursor() as cur:
            safe_camp_id = int(camp_id)
            # st.info(f"Attempting to update camp {safe_camp_id}...") # Less verbose
            cur.execute("UPDATE expired_camps SET classifier = %s WHERE id = %s", (classifier_value, safe_camp_id))
        conn_update.commit()
        # st.success(f"Successfully updated camp {safe_camp_id}.") # Less verbose
        return True
    except (psycopg2.InterfaceError, psycopg2.OperationalError) as conn_err:
        st.error(f"Connection Error during update for camp {camp_id}: {conn_err}")
        st.error("The database connection was likely lost or closed unexpectedly.")
        st.code(traceback.format_exc())
        return False
    except Exception as e:
        pgcode = getattr(e, 'pgcode', None)
        st.error(f"Error updating classification for camp {camp_id}: {e} (pgcode: {pgcode})")
        st.code(traceback.format_exc())
        if conn_update and conn_update.closed == 0:
            try: conn_update.rollback(); st.warning("Transaction rolled back due to error.")
            except Exception as rb_e: st.warning(f"Rollback attempt failed after error: {rb_e}")
        return False
    finally:
        if conn_update:
            try:
                if conn_update.closed == 0: conn_update.close()
            except Exception as close_e: st.warning(f"Error during connection close: {close_e}")

@st.cache_data(ttl=300)
def fetch_camps_data(_trigger):
    """Fetches all camp data from the database. Gets and closes its own connection."""
    conn_local = None
    try:
        conn_local = get_db_connection()
        if conn_local is None:
            # Error already shown in get_db_connection
            return pd.DataFrame()
        if conn_local.closed != 0:
             st.error("Fetch failed: DB connection was closed.")
             try: conn_local.close()
             except: pass
             return pd.DataFrame()

        query = "SELECT * FROM expired_camps ORDER BY camp_start_time DESC"
        df = pd.read_sql(query, conn_local)

        if 'camp_details' in df.columns:
            df['camp_details'] = df['camp_details'].apply(lambda x: json.loads(x) if isinstance(x, str) else x)
        for col in ['camp_start_time', 'last_kill_time', 'camp_end_time', 'processing_time']:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')
        return df
    except UserWarning as uw:
         # Ignore pandas warning here
         # st.sidebar.warning(f"Pandas Warning during fetch: {uw}")
         # Pass - If read_sql worked despite warning, df should be returned
         pass
    except (psycopg2.InterfaceError, psycopg2.OperationalError) as conn_err_fetch:
        st.error(f"Connection Error during fetch: {conn_err_fetch}")
        st.code(traceback.format_exc())
        return pd.DataFrame()
    except Exception as e:
        st.error(f"Error fetching camps: {e}")
        st.code(traceback.format_exc())
        return pd.DataFrame()
    finally:
        if conn_local:
            try:
                 if conn_local.closed == 0: conn_local.close()
            except Exception as close_e: st.warning(f"Error closing fetch connection: {close_e}")
    # Ensure df is returned even if UserWarning occurred after pd.read_sql
    # This assumes pd.read_sql succeeds even if it warns. If not, it will fail earlier.
    # Add a check if 'df' exists before returning if needed, though exceptions should catch failure.
    if 'df' in locals():
        return df
    else:
        return pd.DataFrame() # Return empty if fetch failed before df assignment


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
                'id': other_camp['id'], 'camp_unique_id': other_camp['camp_unique_id'],
                'system_id': other_camp['system_id'], 'stargate_name': other_camp['stargate_name'],
                'start_time': other_camp['camp_start_time'], 'shared_count': len(shared_attackers) })
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
        fetch_camps_data.clear()
        get_system_name.clear() # Clear system name cache too
        st.session_state.camps_df = fetch_camps_data("reload_button")
        st.session_state.current_index = 0
        st.session_state.data_loaded = not st.session_state.camps_df.empty
        st.rerun()

    st.markdown("---")
    st.header("Classification")
    # Classification buttons moved to sidebar
    if st.session_state.data_loaded and not st.session_state.camps_df.empty:
        # Need to check if filtered_df exists and is not empty before accessing current_camp
        # We calculate filtered_df in the main body, access it here if possible
        # This requires ensuring filtered_df is calculated *before* the sidebar runs,
        # or passing the necessary info (like current_camp['id'] and classifier status)
        # Let's try accessing it directly, assuming standard execution order
        try:
            temp_filtered_df = st.session_state.camps_df.copy()
            if st.session_state.hide_classified:
                temp_filtered_df = temp_filtered_df[temp_filtered_df['classifier'].isna()]

            if not temp_filtered_df.empty:
                 # Ensure index is valid for the *currently filtered* view
                 temp_current_index = st.session_state.current_index
                 if temp_current_index >= len(temp_filtered_df): temp_current_index = 0

                 sidebar_camp_id = temp_filtered_df.iloc[temp_current_index]['id']
                 sidebar_camp_classifier = temp_filtered_df.iloc[temp_current_index]['classifier']

                 is_classified_sidebar = not pd.isna(sidebar_camp_classifier)
                 classify_disabled_sidebar = is_classified_sidebar and st.session_state.hide_classified

                 st.caption(f"Classify Camp DB ID: {sidebar_camp_id}")

                 if st.button("Classify TRUE ✔️", type="primary", disabled=classify_disabled_sidebar, use_container_width=True):
                     if update_classification(int(sidebar_camp_id), 1):
                          st.session_state.camps_df.loc[st.session_state.camps_df['id'] == sidebar_camp_id, 'classifier'] = 1
                          st.success("Classified as TRUE")
                          if st.session_state.hide_classified:
                               fetch_camps_data.clear(); st.session_state.data_loaded = False; st.rerun()
                          else:
                               # Advance index carefully based on filtered count
                               current_total = len(temp_filtered_df) # Use filtered count
                               st.session_state.current_index = (temp_current_index + 1) % current_total
                               st.rerun()

                 if st.button("Classify FALSE ❌", disabled=classify_disabled_sidebar, use_container_width=True):
                     if update_classification(int(sidebar_camp_id), 0):
                         st.session_state.camps_df.loc[st.session_state.camps_df['id'] == sidebar_camp_id, 'classifier'] = 0
                         st.success("Classified as FALSE")
                         if st.session_state.hide_classified:
                              fetch_camps_data.clear(); st.session_state.data_loaded = False; st.rerun()
                         else:
                               current_total = len(temp_filtered_df) # Use filtered count
                               st.session_state.current_index = (temp_current_index + 1) % current_total
                               st.rerun()
            else:
                 st.write("No camp selected.")

        except IndexError:
             st.warning("Camp index issue in sidebar.")
        except Exception as e:
             st.error(f"Error rendering sidebar classification: {e}")


    st.markdown("---")
    st.caption(f"Data loaded: {st.session_state.data_loaded}")
    if st.session_state.data_loaded and not st.session_state.camps_df.empty:
        # Calculate filtered count again for display
        sidebar_filtered_df = st.session_state.camps_df.copy()
        if st.session_state.hide_classified:
            sidebar_filtered_df = sidebar_filtered_df[sidebar_filtered_df['classifier'].isna()]

        st.caption(f"Total camps in source: {len(st.session_state.camps_df)}")
        st.caption(f"Showing: {len(sidebar_filtered_df)} camps")


# --- Filtering Data (Main Body) ---
# This calculation needs to happen before accessing filtered_df
if st.session_state.data_loaded and not st.session_state.camps_df.empty:
    filtered_df = st.session_state.camps_df.copy()
    if st.session_state.hide_classified:
        filtered_df = filtered_df[filtered_df['classifier'].isna()]
    if not filtered_df.empty and st.session_state.current_index >= len(filtered_df):
        st.session_state.current_index = 0 # Reset index if filter makes it invalid
    elif filtered_df.empty:
         st.session_state.current_index = 0
else: filtered_df = pd.DataFrame()


# --- Display Area ---
st.title("EVE Gate Camp Classifier")

if not st.session_state.data_loaded and get_db_connection() is None:
     st.error("Failed to connect to the database. Please check settings and ensure DB is running.")
elif not st.session_state.data_loaded:
     st.warning("Attempting to load data. If this persists, check database connection details and server logs.")
elif filtered_df.empty:
    st.warning(f"No {'unclassified ' if st.session_state.hide_classified else ''}camps found matching filters.")
else:
    # Get current camp as a Series
    current_camp = filtered_df.iloc[st.session_state.current_index]
    total_filtered_camps = len(filtered_df)

    st.header(f"Camp {st.session_state.current_index + 1} of {total_filtered_camps}")
    st.caption(f"DB ID: {current_camp['id']} | Unique ID: `{current_camp['camp_unique_id']}`") # Display unique ID in code format

    # --- Prominent zKill Link (First Kill) ---
    first_kill_id = None
    camp_details_main = current_camp.get('camp_details', {})
    if camp_details_main and camp_details_main.get('kills'):
         first_kill_list = camp_details_main['kills']
         if first_kill_list and isinstance(first_kill_list[0], dict):
              first_kill_id = first_kill_list[0].get('killID')

    if first_kill_id and isinstance(first_kill_id, int):
         zkill_url = f"https://zkillboard.com/kill/{first_kill_id}/"
         st.markdown(f"**[View First Kill on zKillboard ↗]({zkill_url})**")
    else:
         st.markdown("_(No valid first kill ID found for zKill link)_")

    st.divider()

    # --- Navigation (Main Body) ---
    col_nav1, col_nav2 = st.columns(2)
    with col_nav1:
        if st.button("⬅️ Previous Camp", use_container_width=True):
            st.session_state.current_index = (st.session_state.current_index - 1 + total_filtered_camps) % total_filtered_camps
            st.rerun()
    with col_nav2:
        if st.button("Next Camp ➡️", use_container_width=True):
            st.session_state.current_index = (st.session_state.current_index + 1) % total_filtered_camps
            st.rerun()

    st.divider()

    # --- Camp Summary (Dense Layout) ---
    st.subheader("Summary")
    col_s1, col_s2, col_s3, col_s4 = st.columns(4)

    system_name = get_system_name(current_camp['system_id']) # Fetch system name via ESI
    col_s1.metric("System", system_name, delta=f"ID: {current_camp['system_id']}", delta_color="off")
    col_s1.markdown(f"**Location:** {current_camp.get('stargate_name', 'Unknown')}") # Assumes only stargate camps are saved

    col_s2.metric("Duration", format_duration(current_camp['camp_start_time'], current_camp['camp_end_time']))
    col_s2.metric("Max Probability", f"{current_camp['max_probability']:.0f}%" if pd.notna(current_camp['max_probability']) else "N/A")

    col_s3.metric("Final Kills", f"{current_camp['final_kill_count']:.0f}" if pd.notna(current_camp['final_kill_count']) else "N/A")
    col_s3.metric("Total Value", f"{current_camp['total_value']:,.0f} ISK" if pd.notna(current_camp['total_value']) else "N/A ISK")

    col_s4.metric("Camp Type", current_camp.get('camp_type', "N/A").capitalize())
    status_text, status_icon = get_classification_status(current_camp['classifier'])
    col_s4.markdown(f"**Classification:** {status_icon} {status_text}")

    st.divider()

    # --- Details Expander ---
    with st.expander("Show Full Details"):
        # Reuse camp_details_main from above
        if not camp_details_main: st.warning("No detailed camp data available.")
        else:
            kills_list = camp_details_main.get('kills', [])
            composition = camp_details_main.get('composition', {})
            metrics = camp_details_main.get('metrics', {})
            log = camp_details_main.get('probabilityLog', [])

            tab_kills, tab_comp, tab_metrics, tab_conn, tab_log = st.tabs([
                f" Kills ({len(kills_list)}) ", " Composition ", " Metrics ", " Connected Camps ", " Probability Log "])

            with tab_kills:
                 # ... (Keep the Kills tab content the same as previous version) ...
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
                              # Fetch ship name (optional, requires another API or SDE)
                              # ship_name = get_ship_name(ship_type_id) # Placeholder
                              ship_display = f"Ship ID: {ship_type_id}" # Default to ID
                              st.markdown(f"--- \n#### Attacker {ship_display} ({len(kills_involved)} kills involved)")
                              st.dataframe(pd.DataFrame(kills_involved).set_index('kill_id'),
                                           column_config={"URL": st.column_config.LinkColumn("URL", display_text="zKill Link")}, use_container_width=True)

            with tab_comp:
                 # ... (Keep Composition tab content the same) ...
                st.subheader("Attacker Composition")
                if composition:
                    st.write(f"Original Attackers: {composition.get('originalCount', 'N/A')}")
                    st.write(f"Active Attackers: {composition.get('activeCount', 'N/A')}")
                    st.write(f"Killed Attackers: {composition.get('killedCount', 'N/A')}")
                    st.write(f"Involved Corps: {composition.get('numCorps', 'N/A')}")
                    st.write(f"Involved Alliances: {composition.get('numAlliances', 'N/A')}")
                else: st.write("No composition data.")

            with tab_metrics:
                 # ... (Keep Metrics tab content the same) ...
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
                 # ... (Keep Connected Camps tab content the same) ...
                 st.subheader("Connected Camps Analysis")
                 with st.spinner("Analyzing connections..."):
                     # Ensure we pass the full original dataframe for context
                     connected_camps = find_connected_camps(current_camp, st.session_state.camps_df)
                 if connected_camps:
                      conn_df = pd.DataFrame(connected_camps)
                      # Format time for display
                      conn_df['start_time'] = pd.to_datetime(conn_df['start_time']).dt.strftime('%Y-%m-%d %H:%M')
                      # Select and rename columns for clarity
                      conn_df_display = conn_df[['id', 'system_id', 'stargate_name', 'start_time', 'shared_count']].rename(columns={
                           'id': 'DB ID', 'system_id': 'System', 'stargate_name': 'Location',
                           'start_time': 'Start Time', 'shared_count': 'Shared Attackers'})
                      st.dataframe(conn_df_display, use_container_width=True)
                 else: st.write("No potentially connected camps found within the time window.")

            with tab_log:
                 # ... (Keep Log tab content the same) ...
                st.subheader("Probability Calculation Log")
                if log:
                    log_text = "\n".join(map(str, log))
                    st.text_area("Log", value=log_text, height=300, disabled=True)
                else: st.write("No probability log available.")