import psycopg2
import os
import re
import sys
from psycopg2.extras import execute_batch

# --- Configuration ---
# Load database connection details from environment variables
# Ensure these are set in your environment where you run the script
DB_URL = os.environ.get("POSTGRES_URL") 

if not DB_URL:
    print("Error: POSTGRES_URL environment variable not set.")
    print("Please set it, e.g., export POSTGRES_URL='postgresql://user:password@host:port/database'")
    sys.exit(1)

# --- Database Connection ---
conn = None
try:
    print(f"Connecting to database...")
    conn = psycopg2.connect(DB_URL)
    print("Connection successful.")
except psycopg2.Error as e:
    print(f"Error connecting to database: {e}")
    sys.exit(1)

cursor = conn.cursor()

# --- Step 1: Ensure destinationID column exists ---
try:
    print("Ensuring 'destinationID' column exists in 'map_denormalize' table...")
    cursor.execute("ALTER TABLE map_denormalize ADD COLUMN IF NOT EXISTS destinationID INTEGER")
    conn.commit()
    print("'destinationID' column ensured.")
except psycopg2.Error as e:
    print(f"Error altering table: {e}")
    conn.rollback() # Rollback changes on error
    conn.close()
    sys.exit(1)

# --- Step 2: Fetch Data ---
all_items = []
try:
    print("Fetching data from map_denormalize (itemID, itemName, solarSystemID, groupID, typeID)...")
    # Fetch only necessary columns to reduce memory usage
    cursor.execute("SELECT itemID, itemName, solarSystemID, groupID, typeID FROM map_denormalize")
    # Fetch all rows - be mindful of memory for very large tables
    all_items = cursor.fetchall() 
    print(f"Fetched {len(all_items)} items.")
except psycopg2.Error as e:
    print(f"Error fetching data: {e}")
    conn.close()
    sys.exit(1)

# --- Step 3: Build System Name -> ID Map ---
print("Building system name to ID map...")
system_name_to_id = {}
# Regex to extract system name from items like "SystemName - Star" or just "SystemName" for typeID 5
# Prioritize typeID 5, then look for patterns. Handles names with hyphens/numbers.
system_name_pattern = re.compile(r"^([a-zA-Z0-9\s\-]+?)(?:\s+-\s+.*)?$") 

items_used_for_map = 0
for item_id, item_name, system_id, group_id, type_id in all_items:
    # Check if this item represents a solar system itself (typeID 5 is often used)
    # or if it's a star/sun (often contains the system name clearly)
    # Only process if we have a system_id and item_name
    if system_id and item_name:
        is_system_defining = (type_id == 5) # TypeID 5 is 'Solar System'
        
        system_name_extracted = None
        
        if is_system_defining:
            # If it's the system object itself, the itemName is usually the system name
             system_name_extracted = item_name.strip()
        else:
             # Fallback: Try parsing names like "SystemName - Star" etc.
             match = system_name_pattern.match(item_name)
             if match:
                 potential_name = match.group(1).strip()
                 # Basic sanity check: avoid overly long names or names containing "Stargate"
                 if len(potential_name) < 50 and "stargate" not in potential_name.lower():
                      system_name_extracted = potential_name
                 # else:
                 #      print(f"DEBUG: Skipped potential name '{potential_name}' from '{item_name}' due to sanity check.")


        if system_name_extracted and system_name_extracted not in system_name_to_id:
             # print(f"DEBUG: Mapping '{system_name_extracted}' -> {system_id} (from item {item_id} '{item_name}', type {type_id})")
             system_name_to_id[system_name_extracted] = system_id
             items_used_for_map += 1
        # elif system_name_extracted and system_name_to_id.get(system_name_extracted) != system_id:
             # print(f"WARNING: Conflicting system ID for '{system_name_extracted}'. Existing: {system_name_to_id.get(system_name_extracted)}, New: {system_id} from item {item_id}")


print(f"Map built with {len(system_name_to_id)} unique system entries using {items_used_for_map} items.")
# For debugging: print the map
# import json
# print("System Map:", json.dumps(system_name_to_id, indent=2))


# --- Step 4: Identify Stargates & Prepare Updates ---
print("Identifying stargates and preparing updates...")
updates_to_perform = []
stargates_processed = 0
stargates_missing_destination = 0

# Regex to extract system name from "Stargate (SystemName)"
stargate_dest_pattern = re.compile(r"Stargate\s*\((.+)\)", re.IGNORECASE)

for item_id, item_name, system_id, group_id, type_id in all_items:
    # Check if it's a stargate (groupID 10)
    if group_id == 10 and item_name:
        stargates_processed += 1
        match = stargate_dest_pattern.match(item_name)
        if match:
            destination_system_name = match.group(1).strip()
            destination_id = system_name_to_id.get(destination_system_name)

            if destination_id is not None:
                # Prepare tuple for batch update: (destination_id, item_id)
                updates_to_perform.append((destination_id, item_id))
                # print(f"  OK: Stargate {item_id} ('{item_name}') -> Destination '{destination_system_name}' ID: {destination_id}")
            else:
                stargates_missing_destination += 1
                # Store None for missing destinations if you want to explicitly mark them
                updates_to_perform.append((None, item_id)) 
                print(f"  WARNING: Destination '{destination_system_name}' not found in map for stargate {item_id} ('{item_name}')")
        else:
             print(f"  ERROR: Could not parse destination name from stargate {item_id} ('{item_name}')")
             # Optionally add update with None if parsing fails but it's groupID 10
             # updates_to_perform.append((None, item_id))


print(f"\nProcessed {stargates_processed} stargates.")
print(f"Prepared {len(updates_to_perform)} updates.")
if stargates_missing_destination > 0:
    print(f"WARNING: Could not find destination IDs for {stargates_missing_destination} stargates (will be set to NULL).")


# --- Step 5: Execute Batch Updates ---
if updates_to_perform:
    print("Executing batch updates...")
    update_sql = "UPDATE map_denormalize SET destinationID = %s WHERE itemID = %s"
    
    try:
        # Execute updates in batches for efficiency
        execute_batch(cursor, update_sql, updates_to_perform, page_size=500) # Adjust page_size as needed
        conn.commit()
        print(f"Successfully executed {len(updates_to_perform)} updates.")
    except psycopg2.Error as e:
        print(f"Error during batch update: {e}")
        print("Attempting to rollback changes...")
        conn.rollback()
    except Exception as e:
        print(f"An unexpected error occurred during batch update: {e}")
        print("Attempting to rollback changes...")
        conn.rollback()
else:
    print("No updates to perform.")

# --- Cleanup ---
print("Closing database connection.")
if cursor:
    cursor.close()
if conn:
    conn.close()

print("\nScript finished.")