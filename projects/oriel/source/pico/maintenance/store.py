from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Literal

from pico.maintenance.models import IssueProposal, MaintenanceJob, MaintenanceOutcome, MaintenanceState


class MaintenanceStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS maintenance_jobs (
                job_id TEXT PRIMARY KEY,
                source_message_id TEXT NOT NULL UNIQUE,
                issue_ref TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                state TEXT NOT NULL,
                base_commit TEXT NOT NULL DEFAULT '',
                candidate_dir TEXT NOT NULL DEFAULT '',
                changed_files TEXT NOT NULL DEFAULT '[]',
                detail TEXT NOT NULL DEFAULT '',
                issue_summary TEXT NOT NULL DEFAULT '',
                issue_key TEXT NOT NULL DEFAULT '',
                issue_url TEXT NOT NULL DEFAULT '',
                message_link TEXT NOT NULL DEFAULT '',
                card_message_id TEXT NOT NULL DEFAULT ''
            )
            """
        )
        columns = {row["name"] for row in self._connection.execute("PRAGMA table_info(maintenance_jobs)")}
        for name in ("issue_summary", "issue_key", "issue_url", "message_link", "card_message_id"):
            if name not in columns:
                self._connection.execute(f"ALTER TABLE maintenance_jobs ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        self._connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS maintenance_active_issue
            ON maintenance_jobs(issue_key)
            WHERE issue_key <> '' AND state IN ('queued', 'running', 'candidate_ready')
            """
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS issue_proposals (
                proposal_id TEXT PRIMARY KEY,
                source_message_id TEXT NOT NULL UNIQUE,
                summary TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                issue_number TEXT NOT NULL DEFAULT '',
                issue_url TEXT NOT NULL DEFAULT '',
                publish_error TEXT NOT NULL DEFAULT ''
            )
            """
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_quota_events (
                channel TEXT NOT NULL,
                message_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                quota_day TEXT NOT NULL,
                kind TEXT NOT NULL,
                PRIMARY KEY (channel, message_id)
            )
            """
        )
        self._connection.execute(
            """
            CREATE INDEX IF NOT EXISTS daily_quota_events_lookup
            ON daily_quota_events(quota_day, kind, channel, sender_id, chat_id)
            """
        )
        proposal_columns = {row["name"] for row in self._connection.execute("PRAGMA table_info(issue_proposals)")}
        for name in ("issue_number", "issue_url", "publish_error"):
            if name not in proposal_columns:
                self._connection.execute(f"ALTER TABLE issue_proposals ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        self._connection.commit()

    def reserve_agent_turn(
        self,
        *,
        channel: str,
        message_id: str,
        sender_id: str,
        chat_id: str,
        quota_day: str,
        max_per_user: int,
        max_per_chat: int,
    ) -> Literal["admitted", "duplicate", "user_limit", "chat_limit"]:
        return self._reserve_quota(
            message_id=message_id,
            channel=channel,
            sender_id=sender_id,
            chat_id=chat_id,
            quota_day=quota_day,
            kind="agent_turn",
            max_per_user=max_per_user,
            max_per_chat=max_per_chat,
        )

    def reserve_fix_job(
        self,
        *,
        channel: str,
        message_id: str,
        sender_id: str,
        chat_id: str,
        quota_day: str,
        max_total: int,
    ) -> Literal["admitted", "duplicate", "total_limit"]:
        return self._reserve_quota(
            message_id=message_id,
            channel=channel,
            sender_id=sender_id,
            chat_id=chat_id,
            quota_day=quota_day,
            kind="fix_job",
            max_total=max_total,
        )

    def _reserve_quota(
        self,
        *,
        channel: str,
        message_id: str,
        sender_id: str,
        chat_id: str,
        quota_day: str,
        kind: Literal["agent_turn", "fix_job"],
        max_per_user: int | None = None,
        max_per_chat: int | None = None,
        max_total: int | None = None,
    ) -> Literal["admitted", "duplicate", "user_limit", "chat_limit", "total_limit"]:
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            existing = self._connection.execute(
                "SELECT 1 FROM daily_quota_events WHERE channel = ? AND message_id = ?",
                (channel, message_id),
            ).fetchone()
            if existing is not None:
                self._connection.rollback()
                return "duplicate"
            user_count = self._connection.execute(
                """
                SELECT COUNT(*) FROM daily_quota_events
                WHERE quota_day = ? AND kind = ? AND channel = ? AND sender_id = ?
                """,
                (quota_day, kind, channel, sender_id),
            ).fetchone()[0]
            if max_per_user is not None and user_count >= max_per_user:
                self._connection.rollback()
                return "user_limit"
            chat_count = self._connection.execute(
                """
                SELECT COUNT(*) FROM daily_quota_events
                WHERE quota_day = ? AND kind = ? AND channel = ? AND chat_id = ?
                """,
                (quota_day, kind, channel, chat_id),
            ).fetchone()[0]
            if max_per_chat is not None and chat_count >= max_per_chat:
                self._connection.rollback()
                return "chat_limit"
            total_count = self._connection.execute(
                "SELECT COUNT(*) FROM daily_quota_events WHERE quota_day = ? AND kind = ?",
                (quota_day, kind),
            ).fetchone()[0]
            if max_total is not None and total_count >= max_total:
                self._connection.rollback()
                return "total_limit"
            self._connection.execute(
                """
                INSERT INTO daily_quota_events (channel, message_id, sender_id, chat_id, quota_day, kind)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (channel, message_id, sender_id, chat_id, quota_day, kind),
            )
            self._connection.commit()
            return "admitted"
        except Exception:
            self._connection.rollback()
            raise

    def release_quota_event(self, channel: str, message_id: str) -> None:
        self._connection.execute(
            "DELETE FROM daily_quota_events WHERE channel = ? AND message_id = ?",
            (channel, message_id),
        )
        self._connection.commit()

    def get_active_job(self, issue_key: str) -> MaintenanceJob | None:
        if not issue_key:
            return None
        row = self._connection.execute(
            """
            SELECT * FROM maintenance_jobs
            WHERE issue_key = ? AND state IN (?, ?, ?)
            ORDER BY rowid DESC LIMIT 1
            """,
            (
                issue_key,
                MaintenanceState.QUEUED.value,
                MaintenanceState.RUNNING.value,
                MaintenanceState.CANDIDATE_READY.value,
            ),
        ).fetchone()
        return self._job(row) if row is not None else None

    def create_or_get_proposal(
        self,
        *,
        source_message_id: str,
        summary: str,
        chat_id: str,
        sender_id: str,
    ) -> tuple[IssueProposal, bool]:
        proposal_id = "pi_" + hashlib.sha256(source_message_id.encode()).hexdigest()[:12]
        try:
            self._connection.execute(
                """
                INSERT INTO issue_proposals (
                    proposal_id, source_message_id, summary, chat_id, sender_id
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (proposal_id, source_message_id, summary, chat_id, sender_id),
            )
            self._connection.commit()
            return IssueProposal(proposal_id, source_message_id, summary, chat_id, sender_id), True
        except sqlite3.IntegrityError:
            # A rejected INSERT still opens a transaction. End it before the
            # duplicate lookup so later quota transactions and writers work.
            self._connection.rollback()
            row = self._connection.execute(
                "SELECT * FROM issue_proposals WHERE source_message_id = ?",
                (source_message_id,),
            ).fetchone()
            if row is None:
                raise
            return (
                IssueProposal(
                    proposal_id=row["proposal_id"],
                    source_message_id=row["source_message_id"],
                    summary=row["summary"],
                    chat_id=row["chat_id"],
                    sender_id=row["sender_id"],
                    issue_number=row["issue_number"],
                    issue_url=row["issue_url"],
                    publish_error=row["publish_error"],
                ),
                False,
            )

    def record_external_issue(self, proposal_id: str, *, number: str, url: str) -> None:
        self._connection.execute(
            """
            UPDATE issue_proposals
            SET issue_number = ?, issue_url = ?, publish_error = ''
            WHERE proposal_id = ?
            """,
            (number, url, proposal_id),
        )
        self._connection.commit()

    def record_proposal_publish_error(self, proposal_id: str, detail: str) -> None:
        self._connection.execute(
            "UPDATE issue_proposals SET publish_error = ? WHERE proposal_id = ?",
            (detail, proposal_id),
        )
        self._connection.commit()

    def create_or_get(
        self,
        *,
        source_message_id: str,
        issue_ref: str,
        chat_id: str,
        sender_id: str,
        issue_summary: str = "",
        issue_key: str = "",
        issue_url: str = "",
        message_link: str = "",
    ) -> tuple[MaintenanceJob, bool]:
        if issue_key:
            row = self._connection.execute(
                """
                SELECT * FROM maintenance_jobs
                WHERE issue_key = ? AND state IN (?, ?, ?)
                ORDER BY rowid DESC LIMIT 1
                """,
                (
                    issue_key,
                    MaintenanceState.QUEUED.value,
                    MaintenanceState.RUNNING.value,
                    MaintenanceState.CANDIDATE_READY.value,
                ),
            ).fetchone()
            if row is not None:
                return self._job(row), False
        job_id = "pm_" + hashlib.sha256(source_message_id.encode()).hexdigest()[:12]
        try:
            self._connection.execute(
                """
                INSERT INTO maintenance_jobs (
                    job_id, source_message_id, issue_ref, chat_id, sender_id, state,
                    issue_summary, issue_key, issue_url, message_link
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    source_message_id,
                    issue_ref,
                    chat_id,
                    sender_id,
                    MaintenanceState.QUEUED.value,
                    issue_summary,
                    issue_key,
                    issue_url,
                    message_link,
                ),
            )
            self._connection.commit()
            return (
                MaintenanceJob(
                    job_id=job_id,
                    source_message_id=source_message_id,
                    issue_ref=issue_ref,
                    chat_id=chat_id,
                    sender_id=sender_id,
                    issue_summary=issue_summary,
                    issue_key=issue_key,
                    issue_url=issue_url,
                    message_link=message_link,
                ),
                True,
            )
        except sqlite3.IntegrityError:
            self._connection.rollback()
            row = self._connection.execute(
                "SELECT * FROM maintenance_jobs WHERE source_message_id = ?",
                (source_message_id,),
            ).fetchone()
            if row is None and issue_key:
                row = self._connection.execute(
                    """
                    SELECT * FROM maintenance_jobs
                    WHERE issue_key = ? AND state IN (?, ?, ?)
                    ORDER BY rowid DESC LIMIT 1
                    """,
                    (
                        issue_key,
                        MaintenanceState.QUEUED.value,
                        MaintenanceState.RUNNING.value,
                        MaintenanceState.CANDIDATE_READY.value,
                    ),
                ).fetchone()
            if row is None:
                raise
            return self._job(row), False

    def mark_running(self, job_id: str) -> None:
        self._connection.execute(
            "UPDATE maintenance_jobs SET state = ? WHERE job_id = ?",
            (MaintenanceState.RUNNING.value, job_id),
        )
        self._connection.commit()

    def mark_unfinished_blocked(self) -> tuple[MaintenanceJob, ...]:
        rows = self._connection.execute(
            "SELECT * FROM maintenance_jobs WHERE state IN (?, ?)",
            (MaintenanceState.QUEUED.value, MaintenanceState.RUNNING.value),
        ).fetchall()
        self._connection.execute(
            """
            UPDATE maintenance_jobs
            SET state = ?, detail = ?
            WHERE state IN (?, ?)
            """,
            (
                MaintenanceState.BLOCKED.value,
                "Gateway restarted before the maintenance job reached a terminal state",
                MaintenanceState.QUEUED.value,
                MaintenanceState.RUNNING.value,
            ),
        )
        self._connection.commit()
        return tuple(
            self._job_with_state(
                row,
                MaintenanceState.BLOCKED,
            )
            for row in rows
        )

    def record_card_message(self, job_id: str, card_message_id: str) -> None:
        self._connection.execute(
            "UPDATE maintenance_jobs SET card_message_id = ? WHERE job_id = ?",
            (card_message_id, job_id),
        )
        self._connection.commit()

    def record_outcome(self, job_id: str, outcome: MaintenanceOutcome) -> None:
        self._connection.execute(
            """
            UPDATE maintenance_jobs
            SET state = ?, base_commit = ?, candidate_dir = ?, changed_files = ?, detail = ?
            WHERE job_id = ?
            """,
            (
                outcome.state.value,
                outcome.base_commit,
                str(outcome.candidate_dir or ""),
                json.dumps(outcome.changed_files),
                outcome.detail,
                job_id,
            ),
        )
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()

    def get_proposal(self, proposal_id: str) -> IssueProposal | None:
        row = self._connection.execute(
            "SELECT * FROM issue_proposals WHERE proposal_id = ?",
            (proposal_id,),
        ).fetchone()
        if row is None:
            return None
        return self._proposal(row)

    def get_proposal_by_source_message(self, source_message_id: str) -> IssueProposal | None:
        row = self._connection.execute(
            "SELECT * FROM issue_proposals WHERE source_message_id = ?",
            (source_message_id,),
        ).fetchone()
        if row is None:
            return None
        return self._proposal(row)

    @staticmethod
    def _proposal(row: sqlite3.Row) -> IssueProposal:
        return IssueProposal(
            proposal_id=row["proposal_id"],
            source_message_id=row["source_message_id"],
            summary=row["summary"],
            chat_id=row["chat_id"],
            sender_id=row["sender_id"],
            issue_number=row["issue_number"],
            issue_url=row["issue_url"],
            publish_error=row["publish_error"],
        )

    @staticmethod
    def _job(row: sqlite3.Row) -> MaintenanceJob:
        return MaintenanceJob(
            job_id=row["job_id"],
            source_message_id=row["source_message_id"],
            issue_ref=row["issue_ref"],
            chat_id=row["chat_id"],
            sender_id=row["sender_id"],
            state=MaintenanceState(row["state"]),
            issue_summary=row["issue_summary"],
            issue_key=row["issue_key"],
            issue_url=row["issue_url"],
            message_link=row["message_link"],
            card_message_id=row["card_message_id"],
        )

    @staticmethod
    def _job_with_state(row: sqlite3.Row, state: MaintenanceState) -> MaintenanceJob:
        return MaintenanceJob(
            job_id=row["job_id"],
            source_message_id=row["source_message_id"],
            issue_ref=row["issue_ref"],
            chat_id=row["chat_id"],
            sender_id=row["sender_id"],
            state=state,
            issue_summary=row["issue_summary"],
            issue_key=row["issue_key"],
            issue_url=row["issue_url"],
            message_link=row["message_link"],
            card_message_id=row["card_message_id"],
        )
