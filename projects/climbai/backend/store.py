import copy
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_state() -> dict:
    return {
        "profile": None, "goal": None, "profile_versions": [], "plans": [],
        "current_plan_id": None, "current_plan": None, "sessions": [],
        "logs": [], "reports": [], "answers": [], "runs": [], "events": [],
        "paused": False, "engine": "demo", "knowledge_meta": {},
    }


class Store:
    """One transactional state per anonymous bearer ID plus queryable snapshots.

    BEGIN IMMEDIATE serializes writers across worker processes. Expected-plan
    version checks run inside the same transaction as the accepted update.
    """

    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connection() as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS user_state (
                    session_id TEXT PRIMARY KEY, state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS snapshots (
                    session_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1, payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, kind, entity_id, version)
                );
                CREATE INDEX IF NOT EXISTS snapshots_owner_kind ON snapshots(session_id,kind);
            """)

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    def read(self, session_id: str) -> dict:
        with self.connection() as conn:
            row = conn.execute("SELECT state_json FROM user_state WHERE session_id=?", (session_id,)).fetchone()
        return json.loads(row[0]) if row else empty_state()

    @contextmanager
    def mutate(self, session_id: str) -> Iterator[dict]:
        with self.lock, self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute("SELECT state_json FROM user_state WHERE session_id=?", (session_id,)).fetchone()
                state = json.loads(row[0]) if row else empty_state()
                yield state
                self.sync_current(state)
                conn.execute("INSERT INTO user_state VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at", (session_id,json.dumps(state,ensure_ascii=False),now()))
                for kind, key in [("profile","profile_versions"),("plan","plans"),("training","logs"),("report","reports"),("answer","answers"),("run","runs")]:
                    for item in state[key]:
                        entity_id = str(item.get("id", kind))
                        version = item.get("version",1)
                        conn.execute("INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?,?,?)", (session_id,kind,entity_id,version,json.dumps(item,ensure_ascii=False),item.get("created_at",now())))
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    @staticmethod
    def sync_current(state: dict):
        candidates = [p for p in state["plans"] if p["id"] == state["current_plan_id"]]
        plan = max(candidates, key=lambda p: p["version"]) if candidates else None
        state["current_plan"] = copy.deepcopy(plan)
        state["sessions"] = copy.deepcopy(plan["sessions"]) if plan else []

    def delete(self, session_id: str):
        with self.lock, self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM user_state WHERE session_id=?", (session_id,))
            conn.execute("DELETE FROM snapshots WHERE session_id=?", (session_id,))
            conn.execute("COMMIT")
