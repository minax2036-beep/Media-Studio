#!/usr/bin/env python3
"""Media Studio: lightweight local web application server."""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
HOST = "127.0.0.1"
PORT = 8765


def command_info(name: str) -> dict[str, object]:
    path = shutil.which(name)
    return {"available": path is not None, "path": path}


def module_info(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


class MediaStudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def send_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/status":
            self.send_json({
                "app": "Media Studio",
                "status": "running",
                "python": sys.version.split()[0],
                "server_time": datetime.now(timezone.utc).isoformat(),
                "tools": {
                    "ffmpeg": command_info("ffmpeg"),
                    "ffprobe": command_info("ffprobe"),
                    "yt_dlp": module_info("yt_dlp"),
                    "pillow": module_info("PIL"),
                },
            })
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()


def main() -> None:
    if not FRONTEND.is_dir():
        raise SystemExit(f"Frontend directory not found: {FRONTEND}")

    server = ThreadingHTTPServer((HOST, PORT), MediaStudioHandler)
    print("=" * 56)
    print("  Media Studio")
    print(f"  Open http://{HOST}:{PORT} in your browser")
    print("  This server is only accessible from this computer.")
    print("  Press Ctrl+C to stop.")
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Media Studio...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
