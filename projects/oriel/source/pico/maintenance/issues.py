from __future__ import annotations

import asyncio
import re
import weakref
from dataclasses import dataclass
from typing import Protocol

import httpx

_REPOSITORY = re.compile(r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)")
_GITEE_ISSUE_URL = re.compile(
    r"https://gitee\.com/(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)/issues/(?P<number>[A-Za-z0-9_-]+)"
)
_ISSUE_NUMBER = re.compile(r"#?(?P<number>(?:[1-9]\d*|[A-Za-z][A-Za-z0-9_-]*))")


@dataclass(frozen=True)
class ExternalIssue:
    provider: str
    repository: str
    number: str
    url: str
    title: str
    body: str

    @property
    def key(self) -> str:
        return f"{self.provider}:{self.repository.lower()}:{self.number.lower()}"


class IssuePublisher(Protocol):
    async def create_or_find(self, key: str, title: str, body: str) -> ExternalIssue: ...

    async def resolve(self, issue_ref: str) -> ExternalIssue: ...


class GiteeIssuePublisher:
    def __init__(
        self,
        *,
        repository: str,
        access_token: str,
        api_url: str = "https://gitee.com/api/v5",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        match = _REPOSITORY.fullmatch(repository)
        if match is None:
            raise ValueError("Gitee repository must use owner/repo format")
        if not access_token:
            raise ValueError("Gitee access token is required")
        self.owner = match.group("owner")
        self.repo = match.group("repo")
        self.repository = f"{self.owner}/{self.repo}"
        self.access_token = access_token
        self.api_url = api_url.rstrip("/")
        self.transport = transport
        self._create_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()

    async def create_or_find(self, key: str, title: str, body: str) -> ExternalIssue:
        lock = self._create_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._create_locks[key] = lock
        async with lock:
            marker = f"<!-- pico-maintenance:{key} -->"
            async with self._client() as client:
                response = await client.get(
                    f"/repos/{self.owner}/{self.repo}/issues",
                    params={"state": "all", "sort": "created", "direction": "desc", "page": 1, "per_page": 100},
                )
                data = self._json(response)
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and marker in str(item.get("body") or ""):
                            return self._external(item)
                response = await client.post(
                    f"/repos/{self.owner}/issues",
                    json={
                        "repo": self.repo,
                        "title": title,
                        "body": f"{body.rstrip()}\n\n{marker}",
                    },
                )
                return self._external(self._json(response))

    async def resolve(self, issue_ref: str) -> ExternalIssue:
        url_match = _GITEE_ISSUE_URL.fullmatch(issue_ref)
        if url_match is not None:
            requested = (url_match.group("owner").lower(), url_match.group("repo").lower())
            configured = (self.owner.lower(), self.repo.lower())
            if requested != configured:
                raise ValueError("Issue is outside configured repository")
            number = url_match.group("number")
        else:
            number_match = _ISSUE_NUMBER.fullmatch(issue_ref)
            if number_match is None:
                raise ValueError("Invalid Gitee Issue reference")
            number = number_match.group("number")
        async with self._client() as client:
            response = await client.get(f"/repos/{self.owner}/{self.repo}/issues/{number}")
            return self._external(self._json(response))

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.api_url,
            headers={"Authorization": f"Bearer {self.access_token}", "Accept": "application/json"},
            timeout=20.0,
            transport=self.transport,
        )

    @staticmethod
    def _json(response: httpx.Response):
        if not response.is_success:
            raise RuntimeError(f"Gitee Issue API returned HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError("Gitee Issue API returned invalid JSON") from exc

    def _external(self, data) -> ExternalIssue:
        if not isinstance(data, dict):
            raise RuntimeError("Gitee Issue API returned an invalid Issue")
        number = str(data.get("number") or "")
        url = str(data.get("html_url") or "")
        title = str(data.get("title") or "")
        if not number or not url or not title:
            raise RuntimeError("Gitee Issue API response is missing required fields")
        return ExternalIssue(
            provider="gitee",
            repository=self.repository,
            number=number,
            url=url,
            title=title,
            body=str(data.get("body") or ""),
        )
