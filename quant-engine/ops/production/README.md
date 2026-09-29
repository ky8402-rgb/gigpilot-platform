# Production deployment runbook

Target host: **`35.154.110.156`** — AWS Mumbai (`ap-south-1`), reachable at
`https://35.154.110.156.sslip.io`.

## Read this first — that host is not empty

`35.154.110.156` is **already running a different, live trading platform**:

```
GET https://35-154-110-156.sslip.io/api/health
{
  "service": "Autonomous Crypto Grid Trading Platform",
  "version": "v2.5.0",
  "deployedCommit": "9f26b35b7b85874377865bcc013b5098eda9bc35",
  "environment": "production",
  "tradingEngine": { "tradingMode": "LIVE", "activeSymbol": "DOGE/USDT",
                     "totalEquityUsd": 2.97, "killSwitchActive": false }
}
```
Stack: `nginx/1.24.0` (Ubuntu) → Express (Node) → React SPA. Let's Encrypt cert on
`35-154-110-156.sslip.io`.

This is a **separate codebase** — not this project. It is trading with real money.

Therefore:

* **Nothing in this directory stops, replaces, or reconfigures it.** The installer
  writes only to `/opt/quant`, `/etc/quant` and `/var/log/quant`.
* The two systems are kept apart by **hostname** and **loopback port**:

  | hostname | serves |
  |---|---|
  | `35-154-110-156.sslip.io` | the existing platform (untouched) |
  | `35.154.110.156.sslip.io` | this platform |

  Both names resolve to the same IP; they are distinct `server_name`s, so nginx
  routes them independently and each gets its own certificate.
* The installer **aborts** if `127.0.0.1:8080` is already taken, and binds the app
  to **loopback only** so nginx remains the sole public entry point.

> Deploying this platform *in place of* the existing one is a separate decision with
> a live system on the other side of it. Do not do it implicitly.

## Install

```bash
# on 35.154.110.156
scp build/quant-<sha>-<stamp>.tar.gz ubuntu@35.154.110.156:/tmp/
ssh ubuntu@35.154.110.156
mkdir -p /tmp/quant && tar -xzf /tmp/quant-*.tar.gz -C /tmp/quant
cd /tmp/quant
sudo bash ops/production/install.sh
```

Installs to `/opt/quant`, creates a `quant` system user, a venv, a systemd unit that
binds `127.0.0.1:8080`, and `/etc/quant/quant.env` at `0600`. It finishes by
printing the service health and the version, then leaves you in **paper mode**.

## Expose it over TLS

```bash
sudo cp /opt/quant/ops/production/nginx-quant.conf /etc/nginx/sites-available/quant
sudo ln -s /etc/nginx/sites-available/quant /etc/nginx/sites-enabled/quant
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 35.154.110.156.sslip.io
```

Then confirm, from anywhere:

```bash
curl -fsS https://35.154.110.156.sslip.io/api/health
```

## Credentials

`/etc/quant/quant.env` (`0600`, root-owned, readable by the service):

```bash
QUANT__EXCHANGE__API_KEY=...
QUANT__EXCHANGE__API_SECRET=...
QUANT__EXCHANGE__EXPECTED_HOST_IP=35.154.110.156
```

The variable prefix is **`QUANT__EXCHANGE__`** — a double underscore after `QUANT`.
Names such as `QUANT_BYBIT__API_KEY` are silently ignored by the loader, which is
the single most common configuration mistake here.

Set `EXPECTED_HOST_IP` so the platform **verifies it is on the right machine** and
refuses to trade if it is not. An API key bound to one IP cannot authenticate from
another, so this converts a confusing rejection into a clear, fail-closed halt.

## Dashboard

```bash
sudo cat /opt/quant/data/dashboard_token.txt   # then open the URL and paste it
```

Token is regenerated only if absent; it persists across restarts and is `0600`.

## Go live

```bash
cd /opt/quant
sudo -u quant .venv/bin/python ops/preflight_live.py   # must report CLEAR TO ARM
sudo -u quant bash ops/go_live.sh                      # dry run: shows what changes
sudo -u quant bash ops/go_live.sh --confirm            # arms, then deploys + verifies
```

`go_live.sh` refuses to arm while the preflight reports blockers, and arming needs
all four interlock signals plus a typed `ARM` confirmation.

**Emergency stop — no API access, no token, no DB edit:**

```bash
sudo touch /opt/quant/data/HALT     # halt new risk immediately
sudo rm /opt/quant/data/HALT        # resume (clears only this reason)
```

Kill switches, peak equity and loss streaks are persisted in SQLite, so they
survive a restart of the service.

## Operations

| Task | Command |
|---|---|
| Status | `systemctl status quant` |
| Logs | `journalctl -u quant -f` |
| Health | `curl -s localhost:8080/api/health` |
| Readiness | `curl -s localhost:8080/api/ready` |
| Metrics | `curl -s localhost:8080/api/stats` (Prometheus text) |
| Backups | `bash /opt/quant/ops/backup.sh` (online SQLite, safe while trading) |
| Version | `curl -s localhost:8080/api/version` (reports the deployed commit) |

## Capital requirement — check before arming

Bybit enforces a **$5.00 minimum notional** on all 778 USDT perpetuals. With
`risk_per_trade_pct: 0.5` and `max_position_notional_pct: 25`, the maximum position
notional is 25% of equity:

| equity | max notional | can open a position? |
|---|---|---|
| $2.97 | $0.74 | **no** — below the $5 minimum |
| $25 | $6.25 | yes, but only the smallest one |
| $50 | $12.50 | yes |
| $500 | $125 | yes, comfortably |
| $10,000 | $2,500 | yes |

Preflight checks this per symbol and reports which ones are actually openable at the
account's live equity.
