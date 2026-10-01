#!/usr/bin/env python3
import os
import pty
import sys
import select
import termios

AUTH_CODE = sys.argv[1] if len(sys.argv) > 1 else ""

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
    sent = False
    while True:
        r, _, _ = select.select([master], [], [], 15)
        if r:
            try:
                chunk = os.read(master, 1024)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            sys.stdout.write(chunk.decode('utf-8', errors='replace'))
            sys.stdout.flush()
            if b'Enter the authorization code' in output and not sent:
                if AUTH_CODE:
                    os.write(master, (AUTH_CODE + '\n').encode('utf-8'))
                    sent = True
        else:
            break
    _, status = os.waitpid(pid, 0)
    sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
