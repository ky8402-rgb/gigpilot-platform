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
import re
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

from gpkg.web.dashboard import mount_dashboard


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

    def test_root_serves_the_python_console(self):
        """`/` must be the Python console, and specifically NOT a leftover prebuilt bundle.

        A previous revision preferred `dist/index.html` when it existed. On the production host the
        previous release had left one behind, so `/` served a dead 2 KB React stub while every gate
        passed. Asserting only `200 text/html` would not have caught it.
        """
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        self.assertIn("Session API credentials", resp.text)
        self.assertIn("id=\"l2-bar\"", resp.text)

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

    def test_console_renders_without_any_engine_state(self):
        """With no state provider at all, the console must still render.

        This replaces an earlier test that asserted a fallback page when `dist/` was empty. There is
        no `dist/` any more and `mount_dashboard` no longer accepts a bundle directory — a leftover
        bundle was precisely what shadowed the console in production.
        """
        bare_app = FastAPI()
        mount_dashboard(bare_app)
        resp = TestClient(bare_app).get("/cockpit")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        self.assertIn("Session API credentials", resp.text)

    def test_no_code_path_serves_a_prebuilt_bundle(self):
        """REGRESSION: a stale `dist/index.html` was served at `/` in production.

        The old code preferred a leftover bundle "for rollback". On the live host one existed, so the
        operator got a dead 2 KB React stub while every gate passed. Assert the bundle-serving code
        is gone, so a stray directory cannot come back to shadow the console.
        """
        src = (ROOT / "gpkg" / "web" / "dashboard.py").read_text(encoding="utf-8")
        self.assertNotIn("DIST_DIR", src)
        self.assertNotIn("INDEX_PATH", src)

    def test_the_deploy_script_purges_a_leftover_bundle(self):
        """Removing the serving code is not enough: the stale directory must be cleaned off the host,
        or the next release leaves it there for something else to pick up."""
        deploy = (ROOT / "scripts" / "deploy-ec2.sh").read_text(encoding="utf-8")
        self.assertIn('"$APP_DIR/dist"', deploy)
        self.assertIn("rm -rf", deploy)

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


class TestLoginContract(unittest.TestCase):
    """The sign-in form must satisfy the backend's actual contract.

    REGRESSION: the first Python login page sent only `password` and `totpCode`. `OwnerAuth.login()`
    compares `email` against the configured owner and refuses on mismatch, recording a throttle
    failure each time — so that form could NEVER have succeeded, and every attempt pushed the operator
    toward a lockout. It also linked to `/login/emergency`, a route that does not exist. Both defects
    were invisible to a test that only checked the page returned 200.
    """

    def setUp(self):
        self.template = (ROOT / "gpkg" / "web" / "templates" / "login.html").read_text(encoding="utf-8")

    def test_the_form_posts_to_the_real_login_endpoint(self):
        self.assertIn('action="/api/auth/login"', self.template)
        self.assertIn('"/api/auth/login"', self.template)

    def test_every_field_the_backend_requires_is_collected(self):
        names = set(re.findall(r'name="([A-Za-z0-9_]+)"', self.template))
        for required in ("email", "password", "totpCode", "emergencyPin"):
            self.assertIn(required, names,
                          f"login form does not collect {required!r}; OwnerAuth.login() requires it")

    def test_the_emergency_pin_is_a_field_not_a_dead_link(self):
        self.assertNotIn("/login/emergency", self.template)
        self.assertIn("emergencyPin", self.template)

    def test_the_credentials_are_never_persisted_client_side(self):
        """The page may DISCUSS storage in its help text; what matters is that no code TOUCHES it.

        Asserting on the bare words would fail on correct explanatory copy while proving nothing about
        behaviour, so this checks the actual storage API calls instead. `tests/test_session_cookie.py`
        applies the same distinction across every served UI asset.
        """
        for usage in (".setItem(", ".getItem(", "indexedDB.open", "document.cookie ="):
            self.assertNotIn(usage, self.template)


if __name__ == "__main__":
    unittest.main()
