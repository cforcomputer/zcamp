#!/usr/bin/env python3
"""
migrate_crew_centric.py — Database migration for crew-centric activity tracking
================================================================================
Standalone script. Run once before deploying the new activity_manager.py.

Usage:
    python migrate_crew_centric.py                    # uses DATABASE_URL from env or .env
    python migrate_crew_centric.py --dry-run          # show SQL without executing
    python migrate_crew_centric.py --rollback         # remove added columns
    DATABASE_URL=postgresql://... python migrate_crew_centric.py

Requirements:
    pip install asyncpg
"""

from __future__ import annotations

import argparse
import asyncio
import os
import pathlib
import sys
import time

# ─── Configuration ──────────────────────────────────────────────────────────

MIGRATION_ID = "002_crew_centric"
MIGRATION_DESC = "Add crew-centric columns to activity_sessions"


def _load_dotenv():
    env_path = pathlib.Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tracker:tracker@db:5432/tracker")

# ─── Migration tracking table ──────────────────────────────────────────────

MIGRATION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id    TEXT PRIMARY KEY,
    description     TEXT,
    applied_at      TIMESTAMPTZ DEFAULT NOW(),
    rolled_back_at  TIMESTAMPTZ
);
"""

# ─── Forward migration ─────────────────────────────────────────────────────

FORWARD_STEPS = [
    {
        "description": "Add anchor_corp_id to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS anchor_corp_id INTEGER;",
    },
    {
        "description": "Add anchor_alliance_id to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS anchor_alliance_id INTEGER;",
    },
    {
        "description": "Add active_members_at_end to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS active_members_at_end INTEGER;",
    },
    {
        "description": "Add idle_members_at_end to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS idle_members_at_end INTEGER;",
    },
    {
        "description": "Add departed_members_at_end to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS departed_members_at_end INTEGER;",
    },
    {
        "description": "Add member_states JSONB to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS member_states JSONB;",
    },
    {
        "description": "Add prev_session_id to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS prev_session_id TEXT;",
    },
    {
        "description": "Add next_session_id to activity_sessions",
        "sql": "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS next_session_id TEXT;",
    },
    {
        "description": "Index on prev_session_id for session chain traversal",
        "sql": "CREATE INDEX IF NOT EXISTS idx_sessions_prev ON activity_sessions(prev_session_id) WHERE prev_session_id IS NOT NULL;",
    },
    {
        "description": "Index on next_session_id for session chain traversal",
        "sql": "CREATE INDEX IF NOT EXISTS idx_sessions_next ON activity_sessions(next_session_id) WHERE next_session_id IS NOT NULL;",
    },
    {
        "description": "Index on anchor_corp_id for corp-based queries",
        "sql": "CREATE INDEX IF NOT EXISTS idx_sessions_anchor_corp ON activity_sessions(anchor_corp_id) WHERE anchor_corp_id IS NOT NULL;",
    },
    {
        "description": "Index on anchor_alliance_id for alliance-based queries",
        "sql": "CREATE INDEX IF NOT EXISTS idx_sessions_anchor_alliance ON activity_sessions(anchor_alliance_id) WHERE anchor_alliance_id IS NOT NULL;",
    },
]

# ─── Rollback ───────────────────────────────────────────────────────────────

ROLLBACK_STEPS = [
    {
        "description": "Drop index idx_sessions_anchor_alliance",
        "sql": "DROP INDEX IF EXISTS idx_sessions_anchor_alliance;",
    },
    {
        "description": "Drop index idx_sessions_anchor_corp",
        "sql": "DROP INDEX IF EXISTS idx_sessions_anchor_corp;",
    },
    {
        "description": "Drop index idx_sessions_next",
        "sql": "DROP INDEX IF EXISTS idx_sessions_next;",
    },
    {
        "description": "Drop index idx_sessions_prev",
        "sql": "DROP INDEX IF EXISTS idx_sessions_prev;",
    },
    {
        "description": "Drop next_session_id column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS next_session_id;",
    },
    {
        "description": "Drop prev_session_id column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS prev_session_id;",
    },
    {
        "description": "Drop member_states column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS member_states;",
    },
    {
        "description": "Drop departed_members_at_end column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS departed_members_at_end;",
    },
    {
        "description": "Drop idle_members_at_end column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS idle_members_at_end;",
    },
    {
        "description": "Drop active_members_at_end column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS active_members_at_end;",
    },
    {
        "description": "Drop anchor_alliance_id column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS anchor_alliance_id;",
    },
    {
        "description": "Drop anchor_corp_id column",
        "sql": "ALTER TABLE activity_sessions DROP COLUMN IF EXISTS anchor_corp_id;",
    },
]

# ─── Runner ─────────────────────────────────────────────────────────────────


async def run_migration(dry_run: bool = False, rollback: bool = False):
    import asyncpg

    action = "ROLLBACK" if rollback else "MIGRATE"
    steps = ROLLBACK_STEPS if rollback else FORWARD_STEPS

    print(f"\n{'=' * 60}")
    print(f"  Migration: {MIGRATION_ID}")
    print(f"  Action:    {action}{' (DRY RUN)' if dry_run else ''}")
    print(f"  Database:  {_redact_url(DATABASE_URL)}")
    print(f"  Steps:     {len(steps)}")
    print(f"{'=' * 60}\n")

    if dry_run:
        for i, step in enumerate(steps, 1):
            print(f"  [{i:2d}/{len(steps)}] {step['description']}")
            print(f"         {step['sql']}\n")
        print("Dry run complete. No changes made.\n")
        return

    # Connect
    print("Connecting to database...")
    try:
        conn = await asyncpg.connect(DATABASE_URL, ssl=False)
    except Exception as e:
        print(f"\n  ERROR: Could not connect to database: {e}")
        print(f"  Check DATABASE_URL and ensure the database is running.\n")
        sys.exit(1)

    try:
        # Ensure migration tracking table exists
        await conn.execute(MIGRATION_TABLE_SQL)

        # Check if already applied
        row = await conn.fetchrow(
            "SELECT applied_at, rolled_back_at FROM schema_migrations WHERE migration_id = $1",
            MIGRATION_ID,
        )

        if not rollback and row and not row["rolled_back_at"]:
            print(f"  Migration {MIGRATION_ID} already applied at {row['applied_at']}")
            print(f"  Use --rollback to undo, or skip.\n")
            return

        if rollback and (not row or row["rolled_back_at"]):
            print(
                f"  Migration {MIGRATION_ID} is not currently applied. Nothing to roll back.\n"
            )
            return

        # Verify activity_sessions table exists
        table_exists = await conn.fetchval("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'activity_sessions'
            )
        """)
        if not table_exists:
            print("  ERROR: activity_sessions table does not exist.")
            print("  Run the server once first to create the base schema.\n")
            sys.exit(1)

        # Show current column state
        existing_cols = await conn.fetch("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'activity_sessions'
            ORDER BY ordinal_position
        """)
        existing_names = {r["column_name"] for r in existing_cols}
        print(f"  Current columns: {len(existing_names)}")

        # Count existing rows (for context)
        row_count = await conn.fetchval("SELECT COUNT(*) FROM activity_sessions")
        print(f"  Existing rows:   {row_count}\n")

        # Execute steps in a transaction
        print(f"  Running {len(steps)} steps...\n")
        start = time.monotonic()

        async with conn.transaction():
            for i, step in enumerate(steps, 1):
                print(f"  [{i:2d}/{len(steps)}] {step['description']}...", end=" ")
                try:
                    await conn.execute(step["sql"])
                    print("OK")
                except Exception as e:
                    print(f"FAILED\n         {e}")
                    raise

            # Update migration tracking
            if rollback:
                await conn.execute(
                    "UPDATE schema_migrations SET rolled_back_at = NOW() WHERE migration_id = $1",
                    MIGRATION_ID,
                )
            else:
                await conn.execute(
                    """
                    INSERT INTO schema_migrations (migration_id, description)
                    VALUES ($1, $2)
                    ON CONFLICT (migration_id) DO UPDATE
                    SET applied_at = NOW(), rolled_back_at = NULL, description = $2
                    """,
                    MIGRATION_ID,
                    MIGRATION_DESC,
                )

        elapsed = time.monotonic() - start

        # Verify
        new_cols = await conn.fetch("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'activity_sessions'
            ORDER BY ordinal_position
        """)
        new_names = {r["column_name"] for r in new_cols}

        if rollback:
            removed = existing_names - new_names
            print(
                f"\n  Removed {len(removed)} columns: {', '.join(sorted(removed)) if removed else 'none'}"
            )
        else:
            added = new_names - existing_names
            print(
                f"\n  Added {len(added)} columns: {', '.join(sorted(added)) if added else 'none (already existed)'}"
            )

        print(f"  Completed in {elapsed:.2f}s")
        print(
            f"\n  {'Rollback' if rollback else 'Migration'} {MIGRATION_ID} successful.\n"
        )

    finally:
        await conn.close()


def _redact_url(url: str) -> str:
    """Redact password from database URL for display."""
    if "@" in url and ":" in url.split("@")[0]:
        parts = url.split("@")
        user_pass = parts[0].rsplit(":", 1)
        return f"{user_pass[0]}:****@{parts[1]}"
    return url


# ─── CLI ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description=f"Run database migration: {MIGRATION_ID} — {MIGRATION_DESC}",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python migrate_crew_centric.py                          # apply migration
    python migrate_crew_centric.py --dry-run                # preview SQL
    python migrate_crew_centric.py --rollback               # undo migration
    python migrate_crew_centric.py --rollback --dry-run     # preview rollback
    DATABASE_URL=postgresql://user:pass@host/db python migrate_crew_centric.py
        """,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print SQL statements without executing",
    )
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="Remove columns added by this migration",
    )
    args = parser.parse_args()

    asyncio.run(run_migration(dry_run=args.dry_run, rollback=args.rollback))


if __name__ == "__main__":
    main()
