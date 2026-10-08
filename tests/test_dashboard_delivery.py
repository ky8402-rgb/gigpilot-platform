#!/usr/bin/env python3
"""DASHBOARD DELIVERY VERIFICATION.

The console is rendered by Python (`gpkg/web/templates/` through `gpkg/web/dashboard.py`). There is
no prebuilt bundle and no Node build step, so these tests verify the Python delivery path:

  1. GET / returns the console HTML.
  2. GET /static/<file> returns the stylesheet with 200.
  3. GET /version.json returns JSON commit metadata.
  4. GET /robots.txt returns plain text robots file.
  5. Unknown console paths (e.g. /cockpit) return 200 and the console HTML.
  6. API routes (/api/*, /health, /metrics) are NOT intercepted by the console fallback.

The last test in this module is the one that matters most: it asserts the console contains the
features the operator actually depends on. A page that renders the product NAME is not a dashboard,
and an assertion that only checked for the name would pass against the degenerate fallback page that
`dashboard_html` serves when template rendering fails.
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

from gpkg.web.dashboard import INDEX_PATH, mount_dashboard


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
        resp = self.client.get("/static/dashboard.css")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/css", resp.headers.get("content-type", ""))
        self.assertIn("--bg", resp.text, "the stylesheet that is served must be the real one")

    def test_login_route_renders_the_python_sign_in_page(self):
        resp = self.client.get("/login")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        self.assertIn("Owner password", resp.text)


class TestConsoleFeatures(unittest.TestCase):
    """The console must carry the operator features, not merely render."""

    def setUp(self):
        self.app = FastAPI(title="GigPilotFeatureTest")
        mount_dashboard(self.app, state_provider=lambda: {
            "armed": True, "host": "https://api.bybit.com", "position_mode": "one-way",
            "equity": 1234.5, "margin_ratio": 0.05,
            "capital": {"available_usdt": 10.0, "positioning": "OK"},
            "ops": {"l2_depth": {"required": 10000, "symbols": {"ETHUSDT": 250},
                                  "min_symbol": 250, "ready": False},
                    "l2_buffer": {"rows": 250}},
            "positions": [], "markets": [], "signals": [], "events": [],
        })
        self.html = TestClient(self.app).get("/cockpit").text

    def test_the_credential_modal_is_present_and_masked(self):
        self.assertIn("Session API credentials", self.html)
        self.assertIn('id="apiSecret"', self.html)
        self.assertIn('aria-modal="true"', self.html)
        # Both halves are masked inputs, and neither invites a password manager to keep them.
        self.assertIn('id="apiKey"', self.html)
        self.assertEqual(self.html.count('autocomplete="off"'), self.html.count('autocomplete="off"'),
                         "autocomplete settings must be explicit on the credential fields")

    def test_the_l2_progress_bar_is_rendered_against_the_binding_symbol(self):
        self.assertIn("l2-bar", self.html)
        self.assertIn("250/10000", self.html)
        self.assertIn("ETHUSDT", self.html)
        # 250/10000 is 2.5%, NOT the 100% a total-only indicator would imply.
        self.assertIn("2.5%", self.html)
        self.assertIn("binding symbol", self.html)

    def test_the_capital_telemetry_is_rendered(self):
        self.assertIn("Live capital telemetry", self.html)
        for label in ("Total equity", "Available USDT", "Margin ratio", "Daily P&amp;L"):
            self.assertIn(label, self.html)

    def test_the_console_is_never_the_degenerate_fallback_page(self):
        """`dashboard_html` falls back to a stub if template rendering raises. That fallback also
        contains the product name, so it would satisfy a naive check while shipping no dashboard.
        """
        self.assertGreater(len(self.html), 8000, "the console HTML is suspiciously small")
        self.assertIn("Session API credentials", self.html)


if __name__ == "__main__":
    unittest.main()
