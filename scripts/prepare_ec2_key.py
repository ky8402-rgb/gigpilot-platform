#!/usr/bin/env python3
"""
Robust SSH Key Normalizer for AWS EC2 Deployment.
Handles multiple paste formats from GitHub Actions secrets:
- OpenSSH Private Key (-----BEGIN OPENSSH PRIVATE KEY-----)
- RSA Private Key (-----BEGIN RSA PRIVATE KEY-----)
- PuTTY .ppk files (converts to OpenSSH using puttygen)
- Base64 encoded keys
- Keys flattened to a single line with spaces or literal '\n'
- Windows CRLF line endings
"""

import base64
import os
import re
import subprocess
import sys
from pathlib import Path


def log(msg: str):
    print(f"[SSH Key Normalizer] {msg}", flush=True)

def main():
    raw_key = os.environ.get("SSH_KEY", "").strip()
    if not raw_key:
        log("No SSH_KEY provided.")
        sys.exit(1)

    target_path = Path(os.path.expanduser("~/.ssh/id_rsa"))
    target_path.parent.mkdir(parents=True, exist_ok=True)

    log(f"Input key metadata - length: {len(raw_key)}, lines: {len(raw_key.splitlines())}, prefix: {raw_key[:35]!r}, suffix: {raw_key[-35:]!r}")

    # 1. Strip surrounding quotes if present
    if (raw_key.startswith('"') and raw_key.endswith('"')) or \
       (raw_key.startswith("'") and raw_key.endswith("'")):
        raw_key = raw_key[1:-1].strip()

    # 2. Handle literal '\n' escaping first
    if "\\n" in raw_key:
        log("Detected literal '\\n' sequences. Unescaping...")
        raw_key = raw_key.replace("\\n", "\n")

    # 3. Normalize CRLF
    raw_key = raw_key.replace("\r", "").strip()

    # 4. Check if it's base64 encoded
    if not ("BEGIN" in raw_key or "PuTTY" in raw_key or raw_key.startswith("ssh-")):
        try:
            decoded = base64.b64decode(raw_key).decode("utf-8", errors="ignore")
            if "BEGIN" in decoded or "PuTTY" in decoded or decoded.startswith("ssh-"):
                log("Detected base64-encoded SSH key. Decoded successfully.")
                raw_key = decoded.replace("\r", "").strip()
        except Exception:
            pass

    # 5. Handle PuTTY .ppk format
    if raw_key.startswith("PuTTY-User-Key-File"):
        log("Detected PuTTY .ppk format. Converting to OpenSSH...")
        ppk_path = target_path.parent / "key.ppk"
        ppk_path.write_text(raw_key.replace("\r", "") + "\n")

        try:
            subprocess.run(["which", "puttygen"], check=True, stdout=subprocess.DEVNULL)
        except Exception:
            subprocess.run(["sudo", "apt-get", "update", "-qq"], check=False)
            subprocess.run(["sudo", "apt-get", "install", "-y", "-qq", "putty-tools"], check=False)

        res = subprocess.run(
            ["puttygen", str(ppk_path), "-O", "private-openssh", "-o", str(target_path)],
            capture_output=True,
            text=True,
            check=False,  # returncode is inspected below
        )
        if res.returncode == 0:
            target_path.chmod(0o600)
            log("Successfully converted PuTTY key to OpenSSH format.")
            return 0
        else:
            log(f"puttygen conversion failed: {res.stderr}")

    # 6. Check if user accidentally provided public key
    if raw_key.startswith("ssh-rsa ") or raw_key.startswith("ssh-ed25519 ") or raw_key.startswith("ecdsa-"):
        log("⚠️ WARNING: The provided secret is an SSH PUBLIC key, not a PRIVATE key (.pem)!")
        log("EC2 SSH requires the private key file downloaded when creating the AWS key pair.")

    # 7. Handle raw base64 RSA/OpenSSH key body without headers (e.g. starts with MIIE...)
    if (raw_key.startswith("MIIE") or raw_key.startswith("MIIB")) and "BEGIN" not in raw_key:
        log("Detected raw base64 RSA private key without PEM headers. Wrapping with standard PEM markers...")
        body_clean = "".join(raw_key.split())
        chunks = [body_clean[i:i+64] for i in range(0, len(body_clean), 64)]
        raw_key = "-----BEGIN RSA PRIVATE KEY-----\n" + "\n".join(chunks) + "\n-----END RSA PRIVATE KEY-----\n"

    # 8. Check for flattened single-line or space-delimited PEM key
    if "BEGIN" in raw_key and "END" in raw_key:
        m = re.search(r"(-----BEGIN [A-Z0-9 _-]+-----)\s*(.+?)\s*(-----END [A-Z0-9 _-]+-----)", raw_key, re.DOTALL)
        if m:
            header, body, footer = m.groups()
            body_clean = "".join(body.split())
            chunks = [body_clean[i:i+64] for i in range(0, len(body_clean), 64)]
            raw_key = header + "\n" + "\n".join(chunks) + "\n" + footer
            log("PEM structure normalized and chunked to 64-char lines.")

    # 9. Ensure trailing newline
    if not raw_key.endswith("\n"):
        raw_key += "\n"

    target_path.write_text(raw_key)
    target_path.chmod(0o600)
    log(f"SSH private key written to {target_path} ({len(raw_key.splitlines())} lines).")

    # 9. Verify with ssh-keygen if available
    try:
        res = subprocess.run(["ssh-keygen", "-y", "-f", str(target_path)], capture_output=True,
                             text=True, check=False)  # returncode decides the branch
        if res.returncode == 0:
            log(f"Key verification PASSED. Generated public key: {res.stdout.strip()[:35]}...")
            # Save corresponding .pub file
            (target_path.parent / "id_rsa.pub").write_text(res.stdout)
        else:
            log(f"Key verification notice: {res.stderr.strip()}")
    except FileNotFoundError:
        pass

    return 0

if __name__ == "__main__":
    sys.exit(main())
