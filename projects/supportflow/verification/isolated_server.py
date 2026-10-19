"""Browser verification server with disposable policy and ticket storage."""
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory(prefix="supportflow-browser-") as directory:
    server.DB_PATH = Path(directory) / "tickets.sqlite3"
    server.knowledge.STORE_PATH = Path(directory) / "knowledge.json"
    server.main()
