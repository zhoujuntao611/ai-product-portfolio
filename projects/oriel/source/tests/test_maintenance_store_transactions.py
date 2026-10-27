from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from pico.maintenance.store import MaintenanceStore


@pytest.fixture
def store(tmp_path: Path):
    database = MaintenanceStore(tmp_path / "maintenance.sqlite3")
    try:
        yield database
    finally:
        database.close()


def _reserve_fix(store: MaintenanceStore, message_id: str = "fix-next") -> str:
    return store.reserve_fix_job(
        channel="feishu",
        message_id=message_id,
        sender_id="maintainer",
        chat_id="community",
        quota_day="2026-10-26",
        max_total=5,
    )


def test_duplicate_proposal_leaves_connection_ready_for_quota(store: MaintenanceStore) -> None:
    arguments = {
        "source_message_id": "issue-message",
        "summary": "The original bug report",
        "chat_id": "community",
        "sender_id": "maintainer",
    }
    original, created = store.create_or_get_proposal(**arguments)
    store.record_external_issue(original.proposal_id, number="I123ABC", url="https://example.test/issues/I123ABC")

    duplicate, created_again = store.create_or_get_proposal(**{**arguments, "summary": "Retried payload"})

    assert created is True
    assert created_again is False
    assert duplicate.proposal_id == original.proposal_id
    assert duplicate.summary == arguments["summary"]
    assert duplicate.issue_number == "I123ABC"
    assert _reserve_fix(store) == "admitted"


def test_duplicate_job_leaves_connection_ready_for_agent_quota(store: MaintenanceStore) -> None:
    arguments = {
        "source_message_id": "fix-message",
        "issue_ref": "#123",
        "chat_id": "community",
        "sender_id": "maintainer",
    }
    original, created = store.create_or_get(**arguments)

    duplicate, created_again = store.create_or_get(**arguments)

    assert created is True
    assert created_again is False
    assert duplicate == original
    assert (
        store.reserve_agent_turn(
            channel="feishu",
            message_id="question-next",
            sender_id="member",
            chat_id="community",
            quota_day="2026-10-26",
            max_per_user=5,
            max_per_chat=10,
        )
        == "admitted"
    )


def test_active_issue_race_rolls_back_before_returning_existing_job(
    store: MaintenanceStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    competing_store = MaintenanceStore(tmp_path / "maintenance.sqlite3")
    connection = store._connection
    competing_job = []

    class RacingCursor:
        def __init__(self, cursor: sqlite3.Cursor) -> None:
            self.cursor = cursor

        def fetchone(self):
            result = self.cursor.fetchone()
            # A competing request commits after our preflight read found no job.
            assert result is None
            job, created = competing_store.create_or_get(
                source_message_id="competing-fix",
                issue_ref="#123",
                issue_key="repository:#123",
                chat_id="community",
                sender_id="maintainer",
            )
            assert created is True
            competing_job.append(job)
            return result

    class RacingConnection:
        triggered = False

        def execute(self, statement, parameters=()):
            cursor = connection.execute(statement, parameters)
            if not self.triggered and "SELECT * FROM maintenance_jobs" in statement and "issue_key = ?" in statement:
                self.triggered = True
                return RacingCursor(cursor)
            return cursor

        def __getattr__(self, name):
            return getattr(connection, name)

    monkeypatch.setattr(store, "_connection", RacingConnection())
    try:
        existing, created = store.create_or_get(
            source_message_id="our-fix",
            issue_ref="#123",
            issue_key="repository:#123",
            chat_id="community",
            sender_id="maintainer",
        )

        assert created is False
        assert existing == competing_job[0]
        # A second connection can write immediately after the conflict, and our
        # next explicit quota transaction can start normally.
        assert _reserve_fix(competing_store, "other-connection-next") == "admitted"
        assert _reserve_fix(store) == "admitted"
    finally:
        competing_store.close()


def test_unrelated_integrity_error_does_not_leave_a_write_transaction(store: MaintenanceStore) -> None:
    # Trigger a constraint error that cannot be resolved as a duplicate request.
    with pytest.raises(sqlite3.IntegrityError):
        store.create_or_get_proposal(
            source_message_id="invalid-message",
            summary=None,
            chat_id="community",
            sender_id="maintainer",
        )

    assert _reserve_fix(store) == "admitted"
