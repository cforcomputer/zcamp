#!/usr/bin/env python3
"""
reset_database.py — Drop all old tables and recreate a clean schema
====================================================================
Run this ONCE to clear out the old JS app's tables (users, killmails,
scores, sessions, etc.) and set up the tables needed by the new tracker.

Usage:
    python reset_database.py

    # Dry-run (show what would be dropped without doing it):
    python reset_database.py --dry-run

Reads DATABASE_URL from .env or environment variables.
"""

import asyncio
import os
import sys

# ─── Load .env if present ───────────────────────────────────────────────────

def load_dotenv():
    """Minimal .env loader — no external dependency needed."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set. Create a .env file or export it.")
    sys.exit(1)

DRY_RUN = "--dry-run" in sys.argv


# ─── Main ───────────────────────────────────────────────────────────────────

async def main():
    try:
        import asyncpg
    except ImportError:
        print("Installing asyncpg…")
        os.system(f"{sys.executable} -m pip install asyncpg -q")
        import asyncpg

    print(f"Connecting to: {DATABASE_URL[:40]}…{'*' * 20}")
    conn = await asyncpg.connect(DATABASE_URL, ssl=False)

    try:
        # ── Step 1: Discover all existing user tables ────────────────────
        rows = await conn.fetch("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        """)
        existing_tables = [r["tablename"] for r in rows]

        print(f"\nFound {len(existing_tables)} tables in public schema:")
        for t in existing_tables:
            print(f"  • {t}")

        if not existing_tables:
            print("\nDatabase is already empty. Creating fresh schema…")
        else:
            if DRY_RUN:
                PRESERVE = {"map_denormalize"}
                to_drop = [t for t in existing_tables if t not in PRESERVE]
                to_keep = [t for t in existing_tables if t in PRESERVE]
                if to_keep:
                    print(f"\n🛡️  Would PRESERVE: {', '.join(to_keep)}")
                if to_drop:
                    print(f"🗑️  Would DROP: {', '.join(to_drop)}")
                print("\n[DRY RUN] Run without --dry-run to execute.")
                return

            # ── Step 2: Separate preserved vs dropped tables ─────────────
            PRESERVE = {"map_denormalize"}
            tables_to_drop = [t for t in existing_tables if t not in PRESERVE]
            tables_to_keep = [t for t in existing_tables if t in PRESERVE]

            if tables_to_keep:
                print(f"\n🛡️  Preserving {len(tables_to_keep)} table(s):")
                for t in tables_to_keep:
                    row_count = await conn.fetchval(f'SELECT COUNT(*) FROM "{t}"')
                    print(f"  • {t} ({row_count:,} rows)")

            if not tables_to_drop:
                print("\nNo tables to drop. Creating any missing schema tables…")
            else:
                print(f"\n⚠️  This will DROP {len(tables_to_drop)} table(s):")
                for t in tables_to_drop:
                    print(f"  • {t}")
                print("   All data in those tables will be permanently deleted.")
                confirm = input("\nType 'yes' to proceed: ").strip().lower()
                if confirm != "yes":
                    print("Aborted.")
                    return

                # ── Step 3: Drop non-preserved tables ────────────────────
                print("\nDropping old tables…")
                for table in tables_to_drop:
                    await conn.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
                    print(f"  ✓ Dropped {table}")

            # Also drop any sequences left behind
            seq_rows = await conn.fetch("""
                SELECT sequencename FROM pg_sequences
                WHERE schemaname = 'public'
            """)
            for seq in seq_rows:
                await conn.execute(f'DROP SEQUENCE IF EXISTS "{seq["sequencename"]}" CASCADE')
                print(f"  ✓ Dropped sequence {seq['sequencename']}")

            print("\nAll old tables removed.")

        # ── Step 4: Create new schema ────────────────────────────────────
        print("\nCreating new schema…\n")

        await conn.execute("""
            -- Killmail deduplication
            CREATE TABLE IF NOT EXISTS processed_kill_ids (
                kill_id      BIGINT PRIMARY KEY,
                processed_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_processed_kills_time
                ON processed_kill_ids(processed_at);
        """)
        print("  ✓ processed_kill_ids")

        await conn.execute("""
            -- Ship classification cache
            CREATE TABLE IF NOT EXISTS ship_types (
                ship_type_id INTEGER PRIMARY KEY,
                category     TEXT NOT NULL,
                name         TEXT NOT NULL,
                tier         TEXT NOT NULL DEFAULT 'T1',
                last_updated TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        print("  ✓ ship_types")

        await conn.execute("""
            -- Archived activities (camps, roams, battles that timed out)
            CREATE TABLE IF NOT EXISTS expired_activities (
                id              SERIAL PRIMARY KEY,
                activity_id     TEXT UNIQUE NOT NULL,
                classification  TEXT NOT NULL,
                system_id       INTEGER,
                stargate_name   TEXT,
                max_probability INTEGER DEFAULT 0,
                start_time      TIMESTAMPTZ,
                last_kill_time  TIMESTAMPTZ,
                end_time        TIMESTAMPTZ,
                total_value     DOUBLE PRECISION DEFAULT 0,
                kill_count      INTEGER DEFAULT 0,
                details         JSONB,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        print("  ✓ expired_activities")

        await conn.execute("""
            -- EVE universe spatial data (celestials, stargates, systems)
            CREATE TABLE IF NOT EXISTS map_denormalize (
                itemID          BIGINT PRIMARY KEY,
                typeID          INTEGER,
                groupID         INTEGER,
                solarSystemID   BIGINT,
                constellationID BIGINT,
                regionID        BIGINT,
                orbitID         BIGINT,
                x               DOUBLE PRECISION,
                y               DOUBLE PRECISION,
                z               DOUBLE PRECISION,
                radius          DOUBLE PRECISION,
                itemName        TEXT,
                security        DOUBLE PRECISION,
                celestialIndex  INTEGER,
                orbitIndex      INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_map_denorm_system
                ON map_denormalize(solarSystemID);
            CREATE INDEX IF NOT EXISTS idx_map_denorm_type
                ON map_denormalize(typeID);
        """)
        print("  ✓ map_denormalize")

        # ── Step 5: Verify ───────────────────────────────────────────────
        new_rows = await conn.fetch("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        """)
        new_tables = [r["tablename"] for r in new_rows]

        print(f"\n✅ Database reset complete. {len(new_tables)} tables created:")
        for t in new_tables:
            print(f"  • {t}")

        print("""
┌──────────────────────────────────────────────────────────┐
│  Done! map_denormalize was preserved with all its data.  │
│                                                          │
│  Start the tracker:                                      │
│     docker compose up --build                            │
│     (or: python server.py)                               │
└──────────────────────────────────────────────────────────┘
""")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())