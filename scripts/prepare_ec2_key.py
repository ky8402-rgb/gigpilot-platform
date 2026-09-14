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

import os
import sys
import re
import base64
import subprocess
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

    # 1. Strip surrounding quotes if present
    if (raw_key.startswith('"') and raw_key.endswith('"')) or \
       (raw_key.startswith("'") and raw_key.endswith("'")):
        raw_key = raw_key[1:-1].strip()

    # 2. Check if it's base64 encoded
    if not ("BEGIN" in raw_key or "PuTTY" in raw_key):
        try:
            decoded = base64.b64decode(raw_key).decode("utf-8", errors="ignore")
            if "BEGIN" in decoded or "PuTTY" in decoded:
                log("Detected base64-encoded SSH key. Decoded successfully.")
                raw_key = decoded
        except Exception:
            pass

    # 3. Handle PuTTY .ppk format
    if raw_key.startswith("PuTTY-User-Key-File"):
        log("Detected PuTTY .ppk format. Converting to OpenSSH...")
        ppk_path = target_path.parent / "key.ppk"
        ppk_path.write_text(raw_key.replace("\r", "") + "\n")
        
        # Ensure putty-tools is installed
        try:
            subprocess.run(["which", "puttygen"], check=True, stdout=subprocess.DEVNULL)
        except Exception:
            subprocess.run(["sudo", "apt-get", "update", "-qq"], check=False)
            subprocess.run(["sudo", "apt-get", "install", "-y", "-qq", "putty-tools"], check=False)
        
        res = subprocess.run(
            ["puttygen", str(ppk_path), "-O", "private-openssh", "-o", str(target_path)],
            capture_output=True,
            text=True
        )
        if res.returncode == 0:
            target_path.chmod(0o600)
            log("Successfully converted PuTTY key to OpenSSH format.")
            return 0
        else:
            log(f"puttygen conversion failed: {res.stderr}")

    # 4. Check if user accidentally pasted public key
    if raw_key.startswith("ssh-rsa ") or raw_key.startswith("ssh-ed25519 ") or raw_key.startswith("ecdsa-"):
        log("⚠️ WARNING: The provided secret looks like an SSH PUBLIC key, not a PRIVATE key (.pem)!")
        log("OpenSSH requires the private key file downloaded from AWS EC2 Console when launching the instance.")

    # 5. Handle literal '\n' escaping
    if "\\n" in raw_key:
        log("Detected literal '\\n' sequences. Unescaping...")
        raw_key = raw_key.replace("\\n", "\n")

    # 6. Normalize CRLF
    raw_key = raw_key.replace("\r", "").strip()

    # 7. Check for single-line flattened PEM key (e.g. from copy-pasting into a single-line input)
    lines = raw_key.splitlines()
    if len(lines) <= 2 and ("BEGIN" in raw_key and "END" in raw_key):
        log("Detected flattened single-line PEM key. Reconstructing 64-character lines...")
        m = re.search(r"(-----BEGIN [A-Z0-9 ]+-----)(.+)(-----END [A-Z0-9 ]+-----)", raw_key)
        if m:
            header, body, footer = m.groups()
            body_clean = "".join(body.split())
            chunks = [body_clean[i:i+64] for i in range(0, len(body_clean), 64)]
            raw_key = header + "\n" + "\n".join(chunks) + "\n" + footer

    # 8. Ensure trailing newline
    if not raw_key.endswith("\n"):
        raw_key += "\n"

    target_path.write_text(raw_key)
    target_path.chmod(0o600)
    log(f"SSH private key written to {target_path} ({len(raw_key.splitlines())} lines).")

    # 9. Verify with ssh-keygen if available
    try:
        res = subprocess.run(["ssh-keygen", "-y", "-f", str(target_path)], capture_output=True, text=True)
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
