#!/usr/bin/env python3
"""
AWS Login Daemon for remote container environments.
Spawns 'aws login --region ap-south-1 --profile default --remote',
writes the authorization URL to /tmp/aws_auth_url.txt,
and polls /tmp/aws_auth_code.txt for the code provided by the user.
"""
import os
import pty
import select
import sys
import time

URL_FILE = "/tmp/aws_auth_url.txt"
CODE_FILE = "/tmp/aws_auth_code.txt"
STATUS_FILE = "/tmp/aws_auth_status.txt"

# Clean previous state
for f in [URL_FILE, CODE_FILE, STATUS_FILE]:
    if os.path.exists(f):
        try:
            os.remove(f)
        except Exception:
            pass

master, slave = pty.openpty()
pid = os.fork()

if pid == 0:
    os.close(master)
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    os.environ['PATH'] = '/root/.local/bin:' + os.environ.get('PATH', '')
    os.execvp('aws', ['aws', 'login', '--region', 'ap-south-1', '--profile', 'default', '--remote'])
else:
    os.close(slave)
    output = b''
    url_written = False
    with open(STATUS_FILE, "w") as sf:
        sf.write("WAITING_FOR_URL\n")

    # Phase 1: Wait for URL and Prompt
    while True:
        r, _, _ = select.select([master], [], [], 1)
        if r:
            try:
                chunk = os.read(master, 1024)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            if b'https://ap-south-1.signin.aws.amazon.com' in output and not url_written:
                # Extract URL
                text = output.decode('utf-8', errors='replace')
                for line in text.splitlines():
                    if 'https://ap-south-1.signin.aws.amazon.com' in line:
                        with open(URL_FILE, "w") as uf:
                            uf.write(line.strip())
                        url_written = True
                        break
            if b'Enter the authorization code' in output:
                with open(STATUS_FILE, "w") as sf:
                    sf.write("WAITING_FOR_CODE\n")
                break

    # Phase 2: Wait for code in CODE_FILE (up to 10 minutes)
    code_entered = False
    start_time = time.time()
    while time.time() - start_time < 600:
        if os.path.exists(CODE_FILE):
            try:
                with open(CODE_FILE, "r") as cf:
                    code = cf.read().strip()
                if code:
                    os.write(master, (code + "\n").encode("utf-8"))
                    code_entered = True
                    with open(STATUS_FILE, "w") as sf:
                        sf.write("CODE_SUBMITTED\n")
                    break
            except Exception:
                pass
        time.sleep(0.5)

    if not code_entered:
        with open(STATUS_FILE, "w") as sf:
            sf.write("TIMEOUT\n")
        sys.exit(1)

    # Phase 3: Wait for process completion
    result_output = b''
    while True:
        r, _, _ = select.select([master], [], [], 3)
        if r:
            try:
                chunk = os.read(master, 1024)
            except OSError:
                break
            if not chunk:
                break
            result_output += chunk
        else:
            break

    _, status = os.waitpid(pid, 0)
    exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1
    with open(STATUS_FILE, "w") as sf:
        sf.write(f"COMPLETED_{exit_code}\n")
        sf.write(result_output.decode('utf-8', errors='replace'))
    sys.exit(exit_code)
