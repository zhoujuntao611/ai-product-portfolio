"""Check repository-local inline Markdown links and static Pages links, offline.

Uses Git's tracked and unignored new files so it also checks edits before commit.
External URLs and Markdown heading fragments are outside this check's scope.
"""
from html.parser import HTMLParser
from pathlib import Path
import os
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPO_URL = "https://github.com/zhoujuntao611/ai-product-portfolio/"


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        for key in ("href", "src"):
            if attrs.get(key):
                self.links.append(attrs[key])


def main():
    files = set(subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
    ).decode("utf-8").strip("\0").split("\0"))
    # A case-sensitive manifest catches links that work on Windows but fail on Pages.
    targets = set(files)
    for name in files:
        targets.update(p.as_posix() for p in Path(name).parents if p.as_posix() != ".")
    parsed = {}
    for name in sorted(files):
        if name.startswith("docs/") and name.endswith(".html"):
            parser = Links()
            parser.feed((ROOT / name).read_text(encoding="utf-8"))
            parsed[name] = parser
    checked = 0
    errors = []
    for name in sorted(files):
        if name.endswith(".md"):
            body = (ROOT / name).read_text(encoding="utf-8")
            body = re.sub(r"```[\s\S]*?```", "", body)
            links = re.findall(r"\]\(([^\n)]+)\)", body)
        elif name in parsed:
            links = parsed[name].links
        else:
            continue
        for raw in links:
            raw = raw.strip().split(' "')[0].strip("<>")
            url = urlsplit(raw)
            repository_link = False
            if url.scheme or url.netloc:
                # Public links to this repo's main tree can be checked without a request.
                prefixes = [REPO_URL + "blob/main/", REPO_URL + "tree/main/"]
                prefix = next((p for p in prefixes if raw.startswith(p)), None)
                if prefix is None:
                    continue
                target = ROOT / unquote(urlsplit(raw[len(prefix):]).path)
                fragment = ""
                repository_link = True
            elif not url.path:
                if name not in parsed or not url.fragment:
                    continue
                target = ROOT / name
                fragment = unquote(url.fragment)
            elif url.path.startswith("/"):
                # GitHub Pages is served under this repository's project prefix.
                prefix = "/ai-product-portfolio/"
                if not url.path.startswith(prefix):
                    errors.append(f"{name}: root-relative Pages link {raw}")
                    continue
                target = ROOT / "docs" / unquote(url.path[len(prefix):])
                fragment = unquote(url.fragment)
            else:
                target = ROOT / Path(name).parent / unquote(url.path)
                fragment = unquote(url.fragment)
            try:
                # resolve() on Windows may replace the requested spelling with
                # the filesystem's spelling, hiding a wrong-case link.
                relative = Path(os.path.abspath(target)).relative_to(ROOT).as_posix()
                target.resolve().relative_to(ROOT)
            except ValueError:
                errors.append(f"{name}: target outside repository: {raw}")
                continue
            checked += 1
            if relative not in targets or not target.exists():
                errors.append(f"{name}: missing or case-mismatched target: {raw}")
                continue
            if target.is_dir() and name in parsed and not repository_link:
                relative = relative.rstrip("/") + "/index.html"
                if relative not in targets:
                    errors.append(f"{name}: no index.html: {raw}")
                    continue
            if fragment and relative in parsed and fragment not in parsed[relative].ids:
                errors.append(f"{name}: missing HTML fragment: {raw}")
    for error in errors:
        print(error, file=sys.stderr)
    print(f"Checked {checked} local link targets; {len(errors)} failures. External URLs and Markdown fragments not checked.")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
