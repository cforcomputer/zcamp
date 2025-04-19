# recurring_campers_analyzer.py

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
ESI_CHAR_ENDPOINT = "https://esi.evetech.net/latest/characters/{character_id}/?datasource=tranquility"
TABLE_NAME = 'expired_camps'
TABLE_SCHEMA = 'public'

st.set_page_config(layout="wide", page_title="Recurring Campers Analyzer")
st.title("🕵️ Recurring Camper Analyzer")
st.markdown("""
Find characters who frequently participate in camps within the same specific systems.
Set the minimum occurrence threshold and click 'Analyze'. Then select a pair to see details.
""")

# --- Caching Decorators ---
@st.cache_data(ttl=600) # Cache data for 10 minutes
def fetch_analysis_data_cached():
    """Fetches data needed for recurring camper analysis."""
    return fetch_analysis_data_internal()

@st.cache_data(ttl=3600*24) # Cache system names for a day
def get_system_name(system_id):
    """Looks up system name using ESI."""
    if not system_id or pd.isna(system_id): return "Unknown System"
    try: system_id = int(system_id)
    except (ValueError, TypeError): return "Invalid System ID"
    if system_id == 0: return "N/A (Missing)" # Handle placeholder
    try:
        url = ESI_SYSTEM_ENDPOINT.format(system_id=system_id)
        response = requests.get(url, timeout=5); response.raise_for_status()
        return response.json().get("name", f"ID: {system_id}")
    except requests.exceptions.RequestException: return f"ID: {system_id} (ESI Error)"
    except Exception: return f"ID: {system_id} (Parse Error)"

@st.cache_data(ttl=3600*24) # Cache character names for a day
def get_character_name(character_id):
    """Looks up character name using ESI."""
    if not character_id or pd.isna(character_id): return "Unknown Character"
    try: character_id = int(character_id)
    except (ValueError, TypeError): return "Invalid Character ID"
    if character_id == 0: return "N/A (Missing)" # Handle placeholder if used
    try:
        url = ESI_CHAR_ENDPOINT.format(character_id=character_id)
        # Add headers for ESI etiquette if making many requests frequently
        # headers = {'User-Agent': 'YourAppName/Version ContactInfo'}
        # response = requests.get(url, timeout=5, headers=headers)
        response = requests.get(url, timeout=5); response.raise_for_status()
        return response.json().get("name", f"ID: {character_id}")
    except requests.exceptions.HTTPError as http_err:
         if http_err.response.status_code == 404: return f"ID: {character_id} (Not Found)"
         else: return f"ID: {character_id} (ESI HTTP Error)"
    except requests.exceptions.RequestException: return f"ID: {character_id} (ESI Error)"
    except Exception: return f"ID: {character_id} (Parse Error)"

# --- Database Connection ---
def get_db_connection():
    """Establishes a fresh connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(DATABASE_URL); conn.autocommit = True; return conn
    except Exception as e: st.error(f"DB Connection Error: {e}"); return None

# --- Data Fetching ---
def fetch_analysis_data_internal():
    """Fetches id, system_id, start_time, details."""
    conn_local = None
    st.info("Fetching relevant data for analysis...")
    start_time = time.time()
    try:
        conn_local = get_db_connection()
        if conn_local is None: return pd.DataFrame()
        query = f"SELECT id, system_id, camp_start_time, camp_details FROM {TABLE_SCHEMA}.{TABLE_NAME}"
        df = pd.read_sql(query, conn_local)

        # Basic Type Conversions
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
             df['system_id'] = pd.to_numeric(df['system_id'], errors='coerce').fillna(0).astype(int) # Use 0 for missing system
        else: df['system_id'] = 0

        duration_s = time.time() - start_time
        st.success(f"Fetched {len(df)} records in {duration_s:.2f} seconds.")
        return df
    except Exception as e:
        st.error(f"Error fetching analysis data: {e}"); return pd.DataFrame()
    finally:
        if conn_local and conn_local.closed == 0: 
            try: 
                conn_local.close()
            except Exception: pass


# --- Core Analysis Function ---
@st.cache_data # Cache the results of the analysis
def analyze_recurring_campers(df, min_occurrences):
    """Finds character_id / system_id pairs with high frequency."""
    st.info(f"Analyzing {len(df)} camps for recurring attackers...")
    start_time = time.time()

    all_attacker_instances = []

    for index, row in df.iterrows():
        camp_id = row['id']
        system_id = row['system_id']
        start_time_camp = row['camp_start_time']
        details = row['camp_details']

        if pd.isna(start_time_camp) or pd.isna(system_id):
            continue # Skip if essential info missing

        if not isinstance(details, dict) or 'kills' not in details:
            continue

        kills = details.get('kills', [])
        if not isinstance(kills, list): continue

        camp_attackers = set() # Use a set to count unique attackers per camp event
        for kill in kills:
            if not isinstance(kill, dict): continue
            attackers = kill.get('killmail', {}).get('attackers', [])
            if not isinstance(attackers, list): continue

            for attacker in attackers:
                if isinstance(attacker, dict):
                    char_id = attacker.get('character_id')
                    # Ignore NPCs / Structure IDs if necessary (e.g., char_id might be > 90,000,000 or certain ranges)
                    if char_id and char_id > 0: # Basic check for valid player ID
                         camp_attackers.add(char_id)

        # Add instance for each unique attacker in this camp
        for char_id in camp_attackers:
             all_attacker_instances.append({
                  'character_id': char_id,
                  'system_id': system_id,
                  'camp_id': camp_id,
                  'camp_start_time': start_time_camp
             })

    if not all_attacker_instances:
        st.warning("No valid attacker instances found.")
        return pd.DataFrame()

    # Create DataFrame and perform aggregation
    instances_df = pd.DataFrame(all_attacker_instances)

    # Group by character and system, aggregate camp IDs and times
    agg_funcs = {
        'camp_id': lambda x: list(x.unique()), # List of unique camp IDs
        'camp_start_time': list,              # List of all start times for time analysis
        #'camp_id': 'nunique' # Alternative: Just count unique camps directly
    }
    grouped = instances_df.groupby(['character_id', 'system_id']).agg(agg_funcs)

    # Calculate occurrence count based on unique camp IDs
    grouped['occurrence_count'] = grouped['camp_id'].apply(len)

    # Filter by minimum occurrences
    filtered_results = grouped[grouped['occurrence_count'] >= min_occurrences].copy()

    # Sort by frequency
    final_results = filtered_results.sort_values(by='occurrence_count', ascending=False).reset_index()

    analysis_duration = time.time() - start_time
    st.success(f"Analysis complete in {analysis_duration:.2f} seconds. Found {len(final_results)} recurring pairs.")

    return final_results


# --- Initialize Session State ---
if 'analysis_results' not in st.session_state:
    st.session_state.analysis_results = pd.DataFrame()
if 'raw_data' not in st.session_state:
    st.session_state.raw_data = pd.DataFrame()
if 'selected_pair_key' not in st.session_state:
     st.session_state.selected_pair_key = None # Store key like (char_id, sys_id)

# --- Sidebar ---
with st.sidebar:
    st.header("Analysis Controls")
    min_occur = st.slider("Minimum Occurrences Threshold", min_value=2, max_value=50, value=3, step=1)

    if st.button("Analyze Recurring Campers"):
        st.session_state.raw_data = fetch_analysis_data_cached()
        if not st.session_state.raw_data.empty:
             # Clear previous selection when re-analyzing
             st.session_state.selected_pair_key = None
             # Run analysis and store results
             st.session_state.analysis_results = analyze_recurring_campers(st.session_state.raw_data, min_occur)
             # Clear cache related to names if data reloaded
             get_system_name.clear()
             get_character_name.clear()
             st.rerun() # Rerun to update display with results
        else:
             st.error("Failed to load data for analysis.")


# --- Main Display Area ---
st.header("Recurring Camper Pairs")

if not st.session_state.analysis_results.empty:
    results_df = st.session_state.analysis_results

    # Add Names for Display (do this after analysis for efficiency)
    # Use apply with caching for potentially many lookups
    st.info("Looking up names (this may take a moment)...")
    results_df['Character Name'] = results_df['character_id'].apply(get_character_name)
    results_df['System Name'] = results_df['system_id'].apply(get_system_name)
    st.success("Name lookup complete.")

    # Select columns for display table
    display_df = results_df[[
        'Character Name', 'System Name', 'occurrence_count',
        'character_id', 'system_id' # Keep IDs for reference/selection
    ]].rename(columns={'occurrence_count': 'Occurrences'})

    st.dataframe(display_df, use_container_width=True)

    st.markdown("---")
    st.header("Pair Details")

    # --- Simple Selection Method: Use index or buttons ---
    st.write("Select a row index from the table above to view details.")
    selected_index = st.number_input("Enter Row Index to View Details:", min_value=0, max_value=len(results_df)-1, value=0, step=1, key="details_index")

    if selected_index < len(results_df):
         selected_row = results_df.iloc[selected_index]
         char_id = selected_row['character_id']
         sys_id = selected_row['system_id']
         char_name = selected_row['Character Name']
         sys_name = selected_row['System Name']
         st.session_state.selected_pair_key = (char_id, sys_id) # Store the key if needed elsewhere

         st.subheader(f"Details for {char_name} in {sys_name}")

         # Display list of involved Camp IDs
         st.write("**Involved Camp IDs:**")
         camp_ids = selected_row['camp_ids']
         st.dataframe(pd.DataFrame(camp_ids, columns=['Camp ID']), use_container_width=True, height=min(len(camp_ids)*38, 400)) # Dynamic height

         # Time of Day Analysis
         st.write("**Time of Day Distribution (Camp Start Hour UTC):**")
         camp_times = selected_row['camp_times']
         if camp_times:
             # Ensure times are timezone-naive or consistent UTC for hour extraction
             hours = [pd.to_datetime(t, utc=True).hour for t in camp_times if pd.notna(t)]
             if hours:
                 hour_df = pd.DataFrame(hours, columns=['Hour'])
                 try:
                    fig_time = px.histogram(hour_df, x='Hour', nbins=24, title=f"Camp Start Times for {char_name} in {sys_name}")
                    fig_time.update_layout(bargap=0.1)
                    st.plotly_chart(fig_time, use_container_width=True)
                 except Exception as e:
                      st.warning(f"Could not plot time distribution: {e}")
             else:
                  st.write("No valid time data found for this pair.")
         else:
             st.write("No time data available.")

    else:
         st.warning("Selected index is out of bounds.")


else:
    st.info("Click 'Analyze Recurring Campers' in the sidebar to generate results.")