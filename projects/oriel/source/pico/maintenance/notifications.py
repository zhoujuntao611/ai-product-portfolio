from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from pico.spine import Source


class MaintenanceNoticeKind(StrEnum):
    ISSUE_CAPTURED = "issue_captured"
    STARTED = "started"
    PROGRESS = "progress"
    HEARTBEAT = "heartbeat"
    CANDIDATE_READY = "candidate_ready"
    VERIFICATION_FAILED = "verification_failed"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class MaintenanceNotice:
    key: str
    kind: MaintenanceNoticeKind
    source: Source
    title: str
    message_link: str = ""
    issue_url: str = ""
    card_message_id: str = ""
    stage: str = ""
    elapsed_seconds: int = 0
    base_commit: str = ""
    changed_files: tuple[str, ...] = ()
    detail: str = ""
    attachments: tuple[Path, ...] = ()


class MaintenanceNotifier(Protocol):
    async def notify(self, notice: MaintenanceNotice) -> str | None: ...
