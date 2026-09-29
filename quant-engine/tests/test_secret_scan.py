"""Regression tests for the release secret gate.

This gate previously had a real hole: it matched credential files by exact
filename, so a rotated token file (`dashboard_token.txt.compromised-<stamp>`)
escaped detection and was committed. Matching by name SHAPE fixed it.

These tests pin the calibration in both directions — credential-shaped names must
be caught, and ordinary source/config files must NOT be, because a gate that cries
wolf gets switched off and then protects nothing.
"""
import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _load():
    spec = importlib.util.spec_from_file_location("secret_scan", ROOT / "ops" / "secret_scan.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def scanner():
    return _load()


def flagged(scanner, path: str) -> bool:
    return bool(scanner.RISKY_PATH.search(path)) and not bool(scanner.PATH_ALLOWLIST.search(path))


# --------------------------------------------------------------- must be caught
@pytest.mark.parametrize("path", [
    "data/dashboard_token.txt",
    "data/dashboard_token.txt.compromised-20260101T000000Z",   # the actual escape
    "data/dashboard_token.bak",
    "config/.env.production",
    "config/.env",
    "keys/api.pem",
    "keys/server.key",
    "config/credentials.json",
    "secrets.json",
    "deploy/secret_store.yml",
    "config/secrets.yaml",
    "id_rsa",
    ".netrc",
])
def test_credential_shaped_paths_are_flagged(scanner, path):
    assert flagged(scanner, path), f"{path} must be flagged as a credential file"


# ----------------------------------------------------------- must NOT be flagged
@pytest.mark.parametrize("path", [
    "app/api.py",
    "app/config.py",
    "app/web/app.js",
    "README.md",
    ".env.example",
    "config/config.yaml",
    "requirements.txt",
    "package.json",
    "ops/secret_scan.py",          # source that discusses secrets
    "ops/build.sh",
    "ops/systemd/quant.service",
    "tests/test_secret_scan.py",
])
def test_ordinary_files_are_not_flagged(scanner, path):
    assert not flagged(scanner, path), f"{path} must NOT be flagged (false positive)"


def test_gitignore_covers_credential_variants():
    text = (ROOT / ".gitignore").read_text()
    assert ".env" in text
    assert "dashboard_token*" in text, "token rotation variants must be ignored by glob"


def test_scanner_passes_on_the_current_tree():
    """The real gate must pass on the shipped tree."""
    out = subprocess.run([sys.executable, str(ROOT / "ops" / "secret_scan.py")],
                         capture_output=True, text=True, cwd=ROOT, timeout=120)
    assert out.returncode == 0, f"secret scan failed:\n{out.stdout}\n{out.stderr}"
    assert "RESULT: PASS" in out.stdout


def test_scanner_detects_assigned_secret_literals(scanner):
    """A hardcoded non-placeholder secret must be caught by the content scan."""
    sample = 'EXCHANGE_API_SECRET = "' + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" + '"\n'
    hits = [n for n, pat in scanner.PATTERNS if pat.search(sample)]
    assert hits, "an assigned high-entropy secret literal must match a pattern"


def test_scanner_ignores_placeholder_literals(scanner):
    """Placeholders must not trip the gate, or it becomes noise."""
    for sample in (
        'api_secret = "your_api_secret_here"',
        'API_SECRET = "<redacted>"',
        'secret_key = "placeholder-xxxxxxxxxxxxxxxx"',
    ):
        assert scanner.ALLOWLIST.search(sample), f"should be allowlisted: {sample}"


# --------------------------------------------------- content-scan calibration
def _reported(scanner, line: str) -> bool:
    """Mirror scan()'s exact decision for a single line."""
    if scanner.ALLOWLIST.search(line):
        return False
    for _name, pat in scanner.PATTERNS:
        match = pat.search(line)
        if not match:
            continue
        groups = [g for g in (match.groups() or ()) if g]
        if groups:
            value = groups[-1]
            if scanner.PLACEHOLDER_VALUE.search(value):
                continue
            if len(set(value)) < 6:
                continue
        return True
    return False


@pytest.mark.parametrize("line", [
    # Prefixed names must be caught: a leading \b misses these because '_' is a
    # word character, which is exactly how EXCHANGE_API_SECRET escaped before.
    'EXCHANGE_API_SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"',
    'QUANT_EXCHANGE__API_SECRET = "zzzz1111yyyy2222xxxx3333wwww4444"',
    'api_secret = "kQ7xR2mN9pL4vT8wZ3yB6cF1dH5jG0sA"',
    'SECRET_KEY = "abcdefghijklmnopqrstuvwx"',
    'access_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpX"',
])
def test_real_secret_literals_are_reported(scanner, line):
    assert _reported(scanner, line), f"must be reported: {line}"


@pytest.mark.parametrize("line", [
    'api_secret = "your_api_secret_here"',
    'api_secret = "placeholder-abcdefghijklmnop"',
    'API_SECRET = "<redacted>"',
    'QUANT_EXCHANGE__API_SECRET=',
    '# set QUANT_EXCHANGE__API_SECRET in the environment',
    'QUANT_EXCHANGE__API_SECRET=your_real_secret_value_here',
])
def test_placeholders_are_not_reported(scanner, line):
    assert not _reported(scanner, line), f"false positive: {line}"


def test_value_containing_placeholder_substring_is_still_reported(scanner):
    """Regression: a line-level allowlist let a secret whose VALUE merely contained
    'xxxx' slip through, because the placeholder check inspected the whole line."""
    line = 'QUANT_EXCHANGE__API_SECRET = "zzzz1111yyyy2222xxxx3333wwww4444"'
    assert _reported(scanner, line)
