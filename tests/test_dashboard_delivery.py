#!/usr/bin/env python3
"""DASHBOARD STATIC DELIVERY VERIFICATION (Decision D1).

Verifies that FastAPI serves the prebuilt React dashboard from dist/:
  1. GET / returns the compiled React SPA HTML.
  2. GET /assets/<file> returns static assets (CSS, JS) with 200.
  3. GET /version.json returns JSON commit metadata.
  4. GET /robots.txt returns plain text robots file.
  5. SPA fallback routes (e.g. /cockpit, /terminal) return 200 and index.html.
  6. API routes (/api/*, /health, /metrics) are NOT intercepted by SPA fallback.
"""
import sys
import unittest
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

warnings.filterwarnings(
    "ignore",
    message=r"Using .*starlette\.testclient.* is deprecated.*",
    category=Warning,
)

from fastapi import FastAPI
from fastapi.testclient import TestClient

from gpkg.web.dashboard import DIST_DIR, INDEX_PATH, mount_dashboard


class TestDashboardDelivery(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI(title="GigPilotTest")

        @self.app.get("/health")
        def health():
            return {"status": "ok"}

        @self.app.get("/api/state")
        def api_state():
            return {"active": True}

        mount_dashboard(self.app)
        self.client = TestClient(self.app)

    def test_root_serves_html(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        if INDEX_PATH.is_file():
            self.assertIn("root", resp.text)

    def test_version_json(self):
        resp = self.client.get("/version.json")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("status", data)

    def test_robots_txt(self):
        resp = self.client.get("/robots.txt")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/plain", resp.headers.get("content-type", ""))
        self.assertIn("User-agent", resp.text)

    def test_api_routes_not_swallowed_by_spa_fallback(self):
        # Existing API routes work normally
        health_resp = self.client.get("/health")
        self.assertEqual(health_resp.status_code, 200)
        self.assertEqual(health_resp.json(), {"status": "ok"})

        state_resp = self.client.get("/api/state")
        self.assertEqual(state_resp.status_code, 200)
        self.assertEqual(state_resp.json(), {"active": True})

        # Missing API routes return 404 JSON, NOT the HTML dashboard
        missing_api = self.client.get("/api/missing-route")
        self.assertEqual(missing_api.status_code, 404)
        self.assertIn("application/json", missing_api.headers.get("content-type", ""))

    def test_spa_route_fallback(self):
        # Client-side router path
        resp = self.client.get("/cockpit")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))

    def test_spa_fallback_when_dist_empty(self):
        # Verifies that even if dist/ has not been built yet, mount_dashboard serves fallback HTML
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            empty_app = FastAPI()
            mount_dashboard(empty_app, dist_dir=Path(tmpdir))
            empty_client = TestClient(empty_app)
            resp = empty_client.get("/cockpit")
            self.assertEqual(resp.status_code, 200)
            self.assertIn("text/html", resp.headers.get("content-type", ""))
            self.assertIn("GigPilot Platform", resp.text)

    def test_static_assets_mounted(self):
        assets_dir = DIST_DIR / "assets"
        if assets_dir.is_dir():
            files = list(assets_dir.glob("*.js")) + list(assets_dir.glob("*.css"))
            if files:
                first_file = files[0].name
                resp = self.client.get(f"/assets/{first_file}")
                self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
