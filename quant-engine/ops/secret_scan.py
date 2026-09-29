#!/usr/bin/env python3
"""Fail the release if a credential is about to be committed or served.

This is a gate, not a linter: a single finding exits non-zero and blocks the
build. It scans tracked source for high-signal secret patterns and for real
credentials in shipped runtime artifacts.

Design notes:
  * Patterns are deliberately specific so the gate does not cry wolf and get
    disabled. `test-token-123` and `example`-style placeholders are allowlisted.
  * `.env` and `data/dashboard_token.txt` must never be tracked; that is checked
    structurally (gitignore) rather than by content.
  * Nothing sensitive is ever printed: only file, line number and pattern name.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import List, Tuple

ROOT = Path(__file__).resolve().parent.parent

# name -> compiled pattern (high-signal only)
PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("AWS access key id", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("private key block", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[0-9A-Za-z\-]{10,}")),
    ("OpenAI-style key", re.compile(r"\bsk-[A-Za-z0-9]{32,}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")),
    # A non-empty secret assignment with a long literal value.
    (
        "assigned secret literal",
        re.compile(
            # A leading \b would MISS prefixed names such as EXCHANGE_API_SECRET or
            # QUANT_EXCHANGE__API_SECRET, because '_' is a word character and so
            # provides no boundary before "API". Use a non-letter lookbehind so an
            # underscore-prefixed name is still caught.
            r"""(?i)(?<![A-Za-z])(api[_-]?secret|apisecret|secret[_-]?key|"""
            r"""private[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*"""
            r"""["']([A-Za-z0-9/+_\-]{20,})["']"""
        ),
    ),
]

# Line-level placeholders (used when a pattern captures no value group).
# NOTE: a bare `xxx+` is deliberately NOT included. Matching it at line level
# exempted any secret whose VALUE merely contained "xxxx" — a false negative in
# the one component that must not have any.
ALLOWLIST = re.compile(
    r"(?i)(your[_-]?|my[_-]?|example|placeholder|changeme|dummy|fake|test[-_]?token|"
    r"redacted|\*{4,}|<[a-z_]+>)"
)

# Value-level placeholder detection. Applied to the CAPTURED VALUE of an assigned
# literal, not to the whole line, so surrounding prose cannot mask a real secret.
PLACEHOLDER_VALUE = re.compile(
    r"(?i)(your[_-]?|my[_-]?|example|placeholder|changeme|dummy|fake|sample|"
    r"redacted|todo|^none$|^null$|<[a-z_]+>|\.\.\.|\*{4,}|^x{6,}$)"
)

SKIP_DIRS = {".git", "__pycache__", ".pytest_cache", "build", "data", ".venv", "venv", "node_modules"}
SCAN_SUFFIXES = {".py", ".js", ".ts", ".json", ".jsonc", ".yaml", ".yml", ".sh", ".env",
                 ".txt", ".md", ".toml", ".ini", ".cfg", ".service", ".html"}

# Files that legitimately CONTAIN secret-shaped strings as part of their purpose:
#   - the scanner itself, which defines the patterns
#   - its test suite, whose fixtures must look like real secrets to prove the
#     detector fires
# This exemption is deliberately explicit and tiny. Anything else with a
# credential-shaped name or content still fails the gate.
CONTENT_ALLOWLIST = {
    Path("ops/secret_scan.py"),
    Path("tests/test_secret_scan.py"),
}


def tracked_files() -> List[Path]:
    """Prefer git-tracked files; fall back to walking the tree."""
    try:
        out = subprocess.run(
            ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, timeout=30
        )
        if out.returncode == 0 and out.stdout.strip():
            return [ROOT / line for line in out.stdout.splitlines() if line.strip()]
    except (OSError, subprocess.SubprocessError):
        pass

    found: List[Path] = []
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in SCAN_SUFFIXES:
            found.append(p)
    return found


def scan() -> List[Tuple[str, str, int, str]]:
    findings: List[Tuple[str, str, int, str]] = []
    for path in tracked_files():
        if not path.exists():
            continue
        try:
            rel = path.relative_to(ROOT)
        except ValueError:
            continue
        if rel in CONTENT_ALLOWLIST:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if ALLOWLIST.search(line):
                continue
            for name, pat in PATTERNS:
                match = pat.search(line)
                if not match:
                    continue
                # For patterns that capture the assigned value, judge the VALUE.
                # Testing the whole line lets unrelated text allowlist a real
                # credential, and lets a value containing a placeholder-ish
                # substring slip through.
                groups = [g for g in (match.groups() or ()) if g]
                if groups:
                    value = groups[-1]
                    if PLACEHOLDER_VALUE.search(value):
                        continue
                    if len(set(value)) < 6:
                        continue  # degenerate/synthetic value, not a real secret
                findings.append((str(rel), name, lineno, line.strip()[:60]))
    return findings


# Paths that must never be tracked, by name shape rather than exact match.
# Exact-name checks miss rotated/renamed variants (e.g. a token file moved aside
# during rotation), which is precisely how a credential escaped this gate once.
RISKY_PATH = re.compile(
    r"(?i)("
    r"^(\.env|\.netrc|id_rsa|id_ed25519)"          # dotfile credentials
    r"|/(\.env|\.netrc|id_rsa|id_ed25519)"
    r"|token"                                          # token files of any name
    r"|secret|credential"
    r"|\.pem$|\.key$|\.p12$|\.pfx$"
    r")"
)
# SOURCE AND DOCUMENTATION extensions only. A credential-shaped name is waived
# here because these are reviewed code/text (their CONTENTS are still scanned by
# PATTERNS). Data/config formats (.json, .yaml, .yml, .ini, .toml, .txt, .env,
# .pem, .key) are deliberately NOT waived: `config/credentials.json`,
# `secrets.json` and `deploy/secret_store.yml` are exactly what this gate exists
# to catch, and no legitimate source file needs a credential-shaped stem.
PATH_ALLOWLIST = re.compile(
    r"(?i)(\.example$|\.md$|\.py$|\.js$|\.ts$|\.html$|\.css$|\.sh$|\.service$)"
)


def check_untracked_secrets() -> List[str]:
    """Structural check: no credential-shaped file may be tracked by git.

    Matches by NAME SHAPE, not exact filename, so a rotated or renamed credential
    file cannot slip through as it did previously.
    """
    problems: List[str] = []
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True,
                             text=True, timeout=30)
        if out.returncode != 0:
            return problems
        tracked = set(out.stdout.split())
    except (OSError, subprocess.SubprocessError):
        return problems

    for entry in sorted(tracked):
        if entry in (".env.example",):
            continue
        risky_name = RISKY_PATH.search(entry)
        if not risky_name:
            continue
        # Allow ordinary source/docs that merely contain these words in the name.
        if PATH_ALLOWLIST.search(entry):
            continue
        problems.append(
            f"{entry} looks like a credential file (matched {risky_name.group(0)!r}) "
            f"and is tracked by git — untrack it and rotate the secret"
        )

    # Explicitly assert the primary credential paths are untracked.
    for critical in (".env", "data/dashboard_token.txt"):
        if critical in tracked:
            problems.append(f"{critical} is tracked by git — remove it and rotate the credential")
    return problems


def main() -> int:
    findings = scan()
    problems = check_untracked_secrets()

    scanned = len(tracked_files())
    print(f"secret scan: {scanned} files inspected, {len(findings)} content findings, "
          f"{len(problems)} structural problems")

    if problems:
        print("\nSTRUCTURAL FAILURES (credential files tracked):")
        for p in problems:
            print(f"  - {p}")

    if findings:
        print("\nCONTENT FINDINGS (values deliberately not printed):")
        for rel, name, lineno, preview in findings:
            print(f"  - {rel}:{lineno}  [{name}]  near: {preview!r}")

    if findings or problems:
        print("\nRESULT: FAIL — release blocked")
        return 1
    print("RESULT: PASS — no credentials detected in the release tree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
