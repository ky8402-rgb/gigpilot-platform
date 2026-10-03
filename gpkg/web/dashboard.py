"""Dashboard static delivery for FastAPI (Decision D1).

Serves the verified prebuilt React SPA bundle from dist/ without requiring
a Node runtime in production.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DIST_DIR = ROOT_DIR / "dist"
INDEX_PATH = DIST_DIR / "index.html"


def mount_dashboard(app: FastAPI, dist_dir: Optional[Path] = None, fallback_html: Optional[str] = None) -> None:
    """Mounts static asset serving and SPA routing onto the FastAPI application."""
    target_dist = dist_dir or DIST_DIR
    target_index = target_dist / "index.html"
    assets_dir = target_dist / "assets"

    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/version.json")
    async def get_version():
        vpath = target_dist / "version.json"
        if not vpath.is_file():
            vpath = ROOT_DIR / "public" / "version.json"
        if vpath.is_file():
            try:
                data = json.loads(vpath.read_text(encoding="utf-8"))
                return JSONResponse(content=data, status_code=200)
            except Exception:
                pass
        deployed_file = ROOT_DIR / ".gigpilot-data" / "deployed-commit.txt"
        commit = ""
        if deployed_file.is_file():
            commit = deployed_file.read_text(encoding="utf-8").strip()
        if not commit:
            commit = os.getenv("DEPLOYED_COMMIT", "")
        return JSONResponse(content={"commit": commit, "status": "ok"}, status_code=200)

    @app.get("/robots.txt")
    async def get_robots():
        rpath = target_dist / "robots.txt"
        if rpath.is_file():
            return Response(content=rpath.read_text(encoding="utf-8"), media_type="text/plain")
        return Response(content="User-agent: *\nDisallow: /api/\n", media_type="text/plain")

    @app.get("/app-favicon.ico")
    @app.get("/favicon.ico")
    async def get_favicon():
        for cand in [target_dist / "app-favicon.ico", ROOT_DIR / "app-favicon.ico", ROOT_DIR / "public" / "app-favicon.ico"]:
            if cand.is_file():
                return FileResponse(str(cand), media_type="image/x-icon")
        return Response(status_code=404)

    @app.get("/", response_class=HTMLResponse)
    async def get_index():
        if target_index.is_file():
            return HTMLResponse(content=target_index.read_text(encoding="utf-8"), status_code=200)
        if fallback_html:
            return HTMLResponse(content=fallback_html, status_code=200)
        return HTMLResponse(content="<h1>GigPilot Platform</h1><p>Dashboard bundle building or not present.</p>", status_code=200)

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def spa_fallback(full_path: str):
        # Do not intercept API, health, metrics, or events routes
        if full_path.startswith("api/") or full_path in {"health", "metrics", "events"}:
            return JSONResponse(status_code=404, content={"error": f"API route not found: /{full_path}"})

        direct_file = target_dist / full_path
        if direct_file.is_file() and not full_path.endswith(".html"):
            return FileResponse(str(direct_file))

        if target_index.is_file():
            return HTMLResponse(content=target_index.read_text(encoding="utf-8"), status_code=200)
        if fallback_html:
            return HTMLResponse(content=fallback_html, status_code=200)
        return JSONResponse(status_code=404, content={"error": f"Resource not found: /{full_path}"})
