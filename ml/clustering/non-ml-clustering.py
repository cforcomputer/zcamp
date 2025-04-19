# recurring_campers_analyzer.py (Filtered by Security Status)

import streamlit as st
import pandas as pd
import numpy as np
import psycopg2
import psycopg2.extras
import os
import json
from dotenv import load_dotenv
import traceback
import requests
import time
from collections import Counter
import plotly.express as px

# --- Configuration & Initial Setup ---
load_dotenv()
DATABASE_URL = os.getenv("POSTGRES_URL")
ESI_SYSTEM_ENDPOINT = "https://esi.evetech.net/latest/universe/systems/{system_id}/?datasource=tranquility&language=en-us"
ESI_CHAR_ENDPOINT = (
    "https://esi.evetech.net/latest/characters/{character_id}/?datasource=tranquility"
)
TABLE_NAME = "expired_camps"
TABLE_SCHEMA = "public"

st.set_page_config(layout="wide", page_title="Recurring Campers Analyzer")
st.title("🕵️ Recurring Camper Analyzer (Lowsec/Nullsec Focus)")
st.markdown("""
Find characters who frequently participate in camps within the same specific **Lowsec/Nullsec** systems.
Use the sidebar to select security status filters and the minimum occurrence threshold, then click 'Analyze'.
Select a pair from the results table to see details.
""")


# --- Caching Decorators ---
@st.cache_data(ttl=600)
def fetch_analysis_data_cached():
    """Fetches data needed for recurring camper analysis."""
    return fetch_analysis_data_internal()


# --- ESI Lookups (Combined System Details, Character Name) ---
@st.cache_data(ttl=3600 * 24) # Cache system details for a day
def get_system_details(system_id):
    """Looks up system name and security status using ESI."""
    default_details = {"name": f"ID: {system_id}", "security_status": None}
    if not system_id or pd.isna(system_id):
        return default_details
    try:
        system_id = int(system_id)
    except (ValueError, TypeError):
        default_details["name"] = "Invalid System ID"
        return default_details
    if system_id == 0:
         default_details["name"] = "N/A (Missing ID)"
         return default_details # Return default for placeholder ID 0

    try:
        url = ESI_SYSTEM_ENDPOINT.format(system_id=system_id)
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()
        # Round sec status for easier bucketing
        sec_status = round(data.get("security_status", None), 2) if data.get("security_status") is not None else None
        return {
            "name": data.get("name", f"ID: {system_id}"),
            "security_status": sec_status
        }
    except requests.exceptions.RequestException:
        default_details["name"] = f"ID: {system_id} (ESI Error)"
        return default_details
    except Exception:
        default_details["name"] = f"ID: {system_id} (Parse Error)"
        return default_details

# Wrapper for just getting name (uses cached get_system_details)
def get_system_name(system_id):
    details = get_system_details(system_id)
    return details.get("name", f"ID: {system_id}")

@st.cache_data(ttl=3600 * 24)
def get_character_name(character_id):
    # (Implementation from previous script - unchanged)
    if not character_id or pd.isna(character_id): return "Unknown Character"
    try: character_id = int(character_id)
    except (ValueError, TypeError): return "Invalid Character ID"
    if character_id == 0: return "N/A (Missing)"
    try:
        url = ESI_CHAR_ENDPOINT.format(character_id=character_id)
        response = requests.get(url, timeout=5); response.raise_for_status()
        return response.json().get("name", f"ID: {character_id}")
    except requests.exceptions.HTTPError as http_err:
         if http_err.response.status_code == 404: return f"ID: {character_id} (Not Found)"
         else: return f"ID: {character_id} (ESI HTTP Error)"
    except requests.exceptions.RequestException: return f"ID: {character_id} (ESI Error)"
    except Exception: return f"ID: {character_id} (Parse Error)"


# --- Database Connection ---
def get_db_connection():
    try:
        conn = psycopg2.connect(DATABASE_URL); conn.autocommit = True; return conn
    except Exception as e: st.error(f"DB Connection Error: {e}"); return None


# --- Data Fetching ---
def fetch_analysis_data_internal():
    """Fetches id, system_id, start_time, details."""
    # (Implementation from previous script - unchanged)
    conn_local = None
    st.info("Fetching relevant data for analysis...")
    start_time = time.time()
    try:
        conn_local = get_db_connection()
        if conn_local is None: return pd.DataFrame()
        query = f"SELECT id, system_id, camp_start_time, camp_details FROM {TABLE_SCHEMA}.{TABLE_NAME}"
        df = pd.read_sql(query, conn_local)
        if 'camp_details' in df.columns:
            def safe_json_loads(x):
                try: return json.loads(x) if isinstance(x, str) else x
                except json.JSONDecodeError: return None
            df['camp_details'] = df['camp_details'].apply(safe_json_loads)
        else: df['camp_details'] = None
        if 'camp_start_time' in df.columns:
            df['camp_start_time'] = pd.to_datetime(df['camp_start_time'], errors='coerce')
        else: st.error("camp_start_time missing!"); return pd.DataFrame()
        if 'system_id' in df.columns:
             df['system_id'] = pd.to_numeric(df['system_id'], errors='coerce').fillna(0).astype(int)
        else: df['system_id'] = 0
        duration_s = time.time() - start_time
        st.success(f"Fetched {len(df)} records in {duration_s:.2f} seconds.")
        return df
    except Exception as e: st.error(f"Error fetching analysis data: {e}"); return pd.DataFrame()
    finally:
        if conn_local and conn_local.closed == 0:
            try: conn_local.close()
            except Exception: pass


# --- Core Analysis Function ---
@st.cache_data
def analyze_recurring_campers(df, min_occurrences):
    """Finds character_id / system_id pairs with high frequency from the provided (filtered) df."""
    # This function now receives a potentially pre-filtered DataFrame
    st.info(f"Analyzing {len(df)} filtered camps for recurring attackers...")
    start_time = time.time()
    all_attacker_instances = []
    # (Attacker extraction logic remains the same as before)
    for index, row in df.iterrows():
        camp_id = row['id']; system_id = row['system_id']
        start_time_camp = row['camp_start_time']; details = row['camp_details']
        if pd.isna(start_time_camp) or pd.isna(system_id): continue
        if not isinstance(details, dict) or 'kills' not in details: continue
        kills = details.get('kills', []);
        if not isinstance(kills, list): continue
        camp_attackers = set()
        for kill in kills:
            if not isinstance(kill, dict): continue
            attackers = kill.get('killmail', {}).get('attackers', [])
            if not isinstance(attackers, list): continue
            for attacker in attackers:
                if isinstance(attacker, dict):
                    char_id = attacker.get('character_id')
                    if char_id and char_id > 0: camp_attackers.add(char_id)
        for char_id in camp_attackers:
             all_attacker_instances.append({'character_id': char_id, 'system_id': system_id, 'camp_id': camp_id, 'camp_start_time': start_time_camp})

    if not all_attacker_instances:
        st.warning("No valid attacker instances found in the filtered data.")
        return pd.DataFrame()

    instances_df = pd.DataFrame(all_attacker_instances)
    agg_funcs = {'camp_id': lambda x: list(x.unique()), 'camp_start_time': list}
    grouped = instances_df.groupby(['character_id', 'system_id']).agg(agg_funcs)
    grouped['occurrence_count'] = grouped['camp_id'].apply(len)
    filtered_results = grouped[grouped['occurrence_count'] >= min_occurrences].copy()
    final_results = filtered_results.sort_values(by='occurrence_count', ascending=False).reset_index()
    analysis_duration = time.time() - start_time
    st.success(f"Analysis complete in {analysis_duration:.2f} seconds. Found {len(final_results)} recurring pairs in selected security space(s).")
    return final_results


# --- Initialize Session State ---
# (Same as before)
if 'analysis_results' not in st.session_state: st.session_state.analysis_results = pd.DataFrame()
if 'raw_data' not in st.session_state: st.session_state.raw_data = pd.DataFrame()
if 'selected_pair_key' not in st.session_state: st.session_state.selected_pair_key = None
if 'details_index' not in st.session_state: st.session_state.details_index = 0


# --- Sidebar ---
with st.sidebar:
    st.header("Analysis Controls")
    min_occur = st.slider("Minimum Occurrences Threshold", min_value=2, max_value=50, value=3, step=1)

    # --- NEW: Security Status Filter ---
    st.subheader("Security Status Filter")
    sec_status_options = ["Lowsec (0.1 - 0.4)", "Nullsec (<= 0.0)", "Highsec (>= 0.5)"]
    # Default to Lowsec and Nullsec
    selected_sec_status = st.multiselect(
        "Include Systems From:",
        options=sec_status_options,
        default=["Lowsec (0.1 - 0.4)", "Nullsec (<= 0.0)"]
    )
    # --- End New Filter ---

    if st.button("Analyze Recurring Campers"):
        # Fetch or get from state
        if st.session_state.raw_data.empty:
             st.session_state.raw_data = fetch_analysis_data_cached()

        if not st.session_state.raw_data.empty:
            raw_df = st.session_state.raw_data
            st.session_state.selected_pair_key = None # Clear selection
            st.session_state.details_index = 0      # Reset index

            # --- Add Security Status ---
            with st.spinner("Fetching system security details..."):
                unique_systems = raw_df['system_id'].unique()
                sec_map = {sys_id: get_system_details(sys_id)['security_status'] for sys_id in unique_systems if sys_id != 0}
                raw_df['security_status'] = raw_df['system_id'].map(sec_map)
                # Handle potential None values from ESI errors - treat as unknown/exclude
                raw_df['security_status'] = pd.to_numeric(raw_df['security_status'], errors='coerce')

            # --- Filter by Security Status ---
            df_filtered = pd.DataFrame() # Start with empty df
            conditions = []
            if "Highsec (>= 0.5)" in selected_sec_status:
                conditions.append(raw_df['security_status'] >= 0.5)
            if "Lowsec (0.1 - 0.4)" in selected_sec_status:
                conditions.append((raw_df['security_status'] < 0.5) & (raw_df['security_status'] >= 0.1)) # Use >= 0.1 approx
            if "Nullsec (<= 0.0)" in selected_sec_status:
                # Include exactly 0.0 and negative (W-space if IDs map correctly)
                conditions.append(raw_df['security_status'] <= 0.0)

            if conditions:
                 # Combine conditions with OR logic
                 combined_condition = conditions[0]
                 for condition in conditions[1:]:
                     combined_condition = combined_condition | condition
                 # Also explicitly handle NaNs in security status - exclude them
                 df_filtered = raw_df[combined_condition & raw_df['security_status'].notna()].copy()
                 st.info(f"Filtered down to {len(df_filtered)} camps based on security status selection.")
            elif not selected_sec_status:
                 st.warning("No security statuses selected. Analysis will run on empty data.")
                 df_filtered = raw_df.head(0) # Empty dataframe with same columns
            else: # Should not happen if conditions list is populated but somehow fails
                 st.error("Error applying security filter.")
                 df_filtered = raw_df.head(0)

            # --- Run Analysis on Filtered Data ---
            if not df_filtered.empty:
                st.session_state.analysis_results = analyze_recurring_campers(df_filtered, min_occur)
            else:
                 st.session_state.analysis_results = pd.DataFrame() # Ensure results are empty df
                 if selected_sec_status: # Only warn if selection was made but resulted in no data
                    st.warning("No camps found matching the selected security status criteria.")

            # Clear name cache if data might change? Less critical here.
            # get_system_name.clear() # Maybe not needed unless underlying systems change
            # get_character_name.clear()
            st.rerun()
        else:
             st.error("Failed to load data for analysis.")


# --- Main Display Area ---
st.header("Recurring Camper Pairs")

# Use the results stored in session state
results_df = st.session_state.analysis_results

if not results_df.empty:
    # Add Names for Display
    with st.spinner("Looking up names..."):
        # This might be slow if many new IDs appear, relies on caching
        results_df["Character Name"] = results_df["character_id"].apply(get_character_name)
        results_df["System Name"] = results_df["system_id"].apply(get_system_name)

    # Select columns for display table
    display_df = results_df[
        [
            "Character Name",
            "System Name",
            "occurrence_count",
            "character_id",
            "system_id",
        ]
    ].rename(columns={"occurrence_count": "Occurrences"})

    st.dataframe(display_df, use_container_width=True)

    st.markdown("---")
    st.header("Pair Details")

    # --- Selection Method: Use index ---
    if not results_df.empty:
        st.write("Select a row index from the table above to view details.")
        max_index = len(results_df) - 1
        current_index_val = st.session_state.get("details_index", 0)
        safe_default_index = min(current_index_val, max_index) if max_index >= 0 else 0

        selected_index = st.number_input(
            "Enter Row Index to View Details:",
            min_value=0,
            max_value=max_index if max_index >=0 else 0,
            value=safe_default_index,
            step=1,
            key="details_index",
            disabled=(max_index < 0)
        )

        if not results_df.empty and selected_index <= max_index:
            selected_row = results_df.iloc[selected_index]
            char_id = selected_row["character_id"]
            sys_id = selected_row["system_id"]
            char_name = selected_row["Character Name"]
            sys_name = selected_row["System Name"]
            st.session_state.selected_pair_key = (char_id, sys_id)

            st.subheader(f"Details for {char_name} in {sys_name}")

            # Involved Camp IDs...
            st.write("**Involved Camp IDs:**")
            camp_ids = selected_row.get("camp_id", [])
            if isinstance(camp_ids, list) and camp_ids:
                st.dataframe(
                    pd.DataFrame(camp_ids, columns=["Camp ID"]),
                    use_container_width=True,
                    height=min(len(camp_ids) * 38 + 10, 400),
                )
            elif isinstance(camp_ids, list): st.write("No specific Camp IDs recorded.")
            else: st.warning("Camp ID data is not list.")

            # Time of Day Analysis...
            st.write("**Time of Day Distribution (Camp Start Hour UTC):**")
            camp_times = selected_row.get("camp_start_time", [])
            if camp_times:
                if isinstance(camp_times, list):
                    hours = [pd.to_datetime(t, utc=True, errors="coerce").hour for t in camp_times if pd.notna(t)]
                    hours = [h for h in hours if pd.notna(h)] # Filter NaT results
                    if hours:
                        hour_df = pd.DataFrame(hours, columns=["Hour"])
                        try:
                            fig_time = px.histogram(hour_df, x="Hour", nbins=24, title=f"Camp Start Times")
                            fig_time.update_layout(bargap=0.1)
                            st.plotly_chart(fig_time, use_container_width=True)
                        except Exception as e: st.warning(f"Plot error: {e}")
                    else: st.write("No valid time data.")
                else: st.warning("Camp time data is not list.")
            else: st.write("No time data.")

        elif not results_df.empty:
             st.warning("Selected index out of bounds.")
    # No else needed here

else:
    st.info("Click 'Analyze Recurring Campers' in the sidebar to generate results based on selected filters.")