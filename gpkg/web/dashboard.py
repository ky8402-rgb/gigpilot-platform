"""Dashboard delivery for FastAPI — Python-rendered, no Node runtime.

WHAT CHANGED AND WHY
--------------------
This module used to serve a prebuilt React single-page bundle out of `dist/`, which meant the
repository still needed npm, Vite and TypeScript to produce the artifact the server returned. The
dashboard is now rendered by Python (Jinja2 templates in `gpkg/web/templates/`, shapes in
`gpkg/web/views.py`), so there is no build step, no `package.json`, and no JavaScript file in the
tree. The server is the only thing that has to exist for the console to be reachable.

WHAT THIS MODULE OWNS
---------------------
Only the HTTP surface: routes, status codes and content types. Shaping engine state into what the
template renders lives in `views.py`, so that logic can be unit-tested without an HTTP client.

`DIST_DIR` / `INDEX_PATH` are retained as the *legacy* bundle locations. If a bundle happens to be
present it is still served (so a rollback to the previous release is not a hard cut), but nothing in
this module requires it, and the Python dashboard is what is served when it is absent.
"""
from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from gpkg.core.clock import now_iso
from gpkg.web import views

ROOT_DIR = Path(__file__).resolve().parent.parent.parent

#: Legacy prebuilt-bundle locations. Optional; never required.
DIST_DIR = ROOT_DIR / "dist"
INDEX_PATH = DIST_DIR / "index.html"

STATIC_DIR = views.STATIC_DIR

#: Rendered when the template layer cannot be reached. Kept deliberately tiny and dependency-free so
#: that a broken template still yields a page naming the product rather than a bare 500.
DEFAULT_FALLBACK_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>GigPilot Platform</title></head>
<body><div id="root"><h1>GigPilot Platform</h1><p>Initializing dashboard...</p></div></body></html>"""

#: Paths the catch-all must never swallow: they belong to the API, not the console.
RESERVED_PREFIXES = ("api/", "static/")
RESERVED_EXACT = {"health", "metrics", "events", "version.json", "robots.txt", "favicon.ico",
                  "app-favicon.ico", "openapi.json", "docs", "redoc"}


log = logging.getLogger("gigpilot")


def _safe_state(provider: Callable[[], dict[str, Any]] | None) -> dict[str, Any]:
    """Read engine state for the initial server render.

    A failure here must not take the console down: the operator needs the page in order to see what
    is wrong. The client re-reads `/api/state` immediately after load, so a blank first paint is
    recoverable while a 500 is not.
    """
    if provider is None:
        return {}
    try:
        state = provider()
    except Exception:
        return {}
    return state if isinstance(state, dict) else {}


def dashboard_html(provider: Callable[[], dict[str, Any]] | None = None) -> str:
    """Render the console, falling back to the minimal notice if the template engine fails.

    The fallback is LOUD on purpose. An earlier revision swallowed the exception silently, which
    turned a real template defect (a missing nested key) into a stub page that still returned HTTP
    200 — the failure was invisible to both the operator and the deploy gate. A degraded page is
    acceptable; a silent one is not.
    """
    try:
        return views.render_dashboard(_safe_state(provider), rendered_at=now_iso())
    except Exception:
        log.exception("dashboard template render failed; serving the minimal fallback page")
        return DEFAULT_FALLBACK_HTML


def login_html() -> str:
    try:
        return views.render_login()
    except Exception:
        log.exception("login template render failed; serving the minimal fallback page")
        return DEFAULT_FALLBACK_HTML


def mount_dashboard(app: FastAPI, dist_dir: Path | None = None, fallback_html: str | None = None,
                    state_provider: Callable[[], dict[str, Any]] | None = None) -> None:
    """Mount the console routes onto the FastAPI application.

    `state_provider` is called for the initial server-rendered values; the operator's browser then
    keeps the page live from `/events` and `/api/state`.
    """
    target_dist = dist_dir or DIST_DIR
    effective_fallback = fallback_html or DEFAULT_FALLBACK_HTML

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # Legacy bundle assets, only when a prebuilt bundle is actually present.
    legacy_assets = target_dist / "assets"
    if legacy_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(legacy_assets)), name="assets")

    @app.get("/version.json")
    async def get_version():
        vpath = target_dist / "version.json"
        if not vpath.is_file():
            vpath = ROOT_DIR / "public" / "version.json"
        if vpath.is_file():
            try:
                return JSONResponse(content=json.loads(vpath.read_text(encoding="utf-8")), status_code=200)
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
        for cand in (target_dist / "app-favicon.ico", ROOT_DIR / "app-favicon.ico",
                     ROOT_DIR / "public" / "app-favicon.ico"):
            if cand.is_file():
                return FileResponse(str(cand), media_type="image/x-icon")
        return Response(status_code=404)

    @app.get("/login", response_class=HTMLResponse)
    async def get_login():
        return HTMLResponse(content=login_html(), status_code=200)

    @app.get("/", response_class=HTMLResponse)
    async def get_index():
        # A legacy bundle at this exact path still wins, so a rollback stays possible.
        if (target_dist / "index.html").is_file():
            return HTMLResponse(content=(target_dist / "index.html").read_text(encoding="utf-8"),
                                status_code=200)
        html = dashboard_html(state_provider)
        return HTMLResponse(content=html if html else effective_fallback, status_code=200)

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def console_fallback(full_path: str):
        if full_path in RESERVED_EXACT or full_path.startswith(RESERVED_PREFIXES):
            return JSONResponse(status_code=404, content={"error": f"API route not found: /{full_path}"})

        direct_file = target_dist / full_path
        if direct_file.is_file() and not full_path.endswith(".html"):
            return FileResponse(str(direct_file))

        if full_path.endswith(".json"):
            return JSONResponse(status_code=404, content={"error": f"not found: /{full_path}"})

        # Every other path is a console route, not a 404: the console is server-routed, so an
        # operator deep-link must land on the console rather than on an error page.
        html = dashboard_html(state_provider)
        return HTMLResponse(content=html if html else effective_fallback, status_code=200)
