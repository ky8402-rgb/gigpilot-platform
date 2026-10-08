"""Python-native compatibility/control-plane API for the legacy Node surface.

Every live mutation remains owner-authenticated and fail-closed. Legacy manual order APIs are
intentionally disabled because the production architecture is autonomous futures-only execution.
"""
from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from gpkg.api.auth import extract_token, get_owner_auth, require_owner

#: Shown when the daemon has come up with NO credential in memory. This is the one state where a
#: restart can have left something at the venue that nothing local can close, so it is stated loudly
#: rather than left for the operator to infer from a status field.
BOOT_WARNING = ("SYSTEM REBOOTED: Credentials purged. Verify exchange manually for unmanaged "
                "positions.")


def _with_boot_warning(payload: dict, engine_state: str | None = None,
                       unmanaged_risk: bool = False) -> dict:
    """Attach the reboot warning to a COPY, keyed on the engine state.

    A copy, because `snapshot()` returns the engine's live dict; mutating it would leak the warning
    into every other consumer of the same object.

    `engine_state` is passed EXPLICITLY by the callers rather than read only off the payload: the
    snapshot's shape is not guaranteed to carry the field, and silently depending on it made this a
    no-op that still looked wired.
    """
    state = payload.get("engine_state") or engine_state
    # GATED ON EVIDENCE, not merely on the state. AWAITING_SECRET is the normal steady state of an
    # uncredentialed system; warning "SYSTEM REBOOTED: Credentials purged" there asserts a restart that
    # may never have happened. See `GigPilot.may_have_unmanaged_positions`.
    if state == "AWAITING_SECRET" and unmanaged_risk:
        return {**payload, "boot_warning": BOOT_WARNING}
    return payload


def register_compat_routes(app, get_gp):



    router=APIRouter()

    def _gp():
        """Resolve the live engine LAZILY through the application module.

        These routes used to close over the `get_gp` argument, which froze the reference at
        registration time. Every other route in the application resolves `get_gp` dynamically, so this
        was the ONE surface where re-binding had no effect — a test double could not take effect, and
        such a test would silently construct a REAL engine from the process environment instead of
        using the fixture. That is a test that reports on something other than what it claims.
        """
        import gigpilot
        return gigpilot.get_gp()

    @router.get("/api/ml/audit/latest", dependencies=[Depends(require_owner)])
    async def ml_audit_latest(limit: int = 50):
        gp=_gp()
        from gpkg.ml.audit import normalize_audit
        audits = gp.store.ml_research_audits(limit=max(1, min(limit, 100)))
        rows = [normalize_audit(audit) for audit in audits]
        return {
            "success": True,
            "audits": rows,
            "real_capital_execution": False if gp.force_disarm else None,
        }
    @router.get("/api/ml/tournament/latest", dependencies=[Depends(require_owner)])
    async def ml_tournament_latest(symbol: str | None = None):
        """Latest champion/challenger tournament result.

        Returns `available: false` with a null summary when no tournament has run yet, rather than a
        404. A 404 would be indistinguishable from a routing mistake and would make a dashboard show
        an error where the truthful state is "no evidence yet" — and "no evidence yet" is precisely
        the state that must never be dressed up as a result.
        """
        gp=_gp()
        from gpkg.ml.tournament import load_latest_tournament
        summary = load_latest_tournament(gp.store, symbol)
        return {
            "success": True,
            "available": summary is not None,
            "tournament": summary,
            "real_capital_execution": False if gp.force_disarm else None,
        }

    async def _auth_status(request):
        auth=get_owner_auth(); return auth.status(auth.verify(extract_token(request) or ""))
    async def _read(request,symbol=None,id=None,challengerId=None):
        gp=_gp(); path=request.url.path; s=gp.snapshot()
        _state = gp.engine_state  # property, not a method
        _risk = getattr(gp, "may_have_unmanaged_positions", False)
        if path.endswith("/state"): return _with_boot_warning(s, _state, _risk)
        if path.endswith("/health"): return _with_boot_warning({"status":"healthy" if s.get("reconciliation",{}).get("healthy") else "degraded",**s}, _state, _risk)
        if path.endswith("/readiness"): return {"ready":bool(s.get("armable")),"armed":s.get("armed"),"blockers":[] if s.get("armable") else ["live safety preflight has not passed"]}
        if path.endswith("/risk"): return {"equity":s.get("equity"),"gross_notional":s.get("gross_notional"),"margin_ratio":s.get("margin_ratio"),"armed":s.get("armed"),"position_mode":s.get("position_mode"),"hurdle_bps":s.get("hurdle_bps")}
        if path.endswith("/reconciliation/status"): return s.get("reconciliation",{})
        if path.endswith("/pairs"): return {"pairs":[m.get("symbol") for m in s.get("markets",[])]}
        if "/pair/" in path: return next((m for m in s.get("markets",[]) if m.get("symbol")==symbol),{"error":"unknown_symbol"})
        if path.endswith("/futures/universe"): return await _futures_universe()
        if path.endswith("/engines/health"): return {"gigpilot":{"status":"healthy" if s.get("reconciliation",{}).get("healthy") else "degraded"},"armed":s.get("armed")}
        if path.endswith("/decisions"): return {"decisions":s.get("events",[])}
        if path.endswith("/quant/edge-breakdown"): return {"signals":s.get("signals",[])}
        if path.endswith("/updates"): return {"events":s.get("events",[]),"ts":s.get("ts")}
        if path.endswith("/assets"): return {"equity":s.get("equity"),"realized_today":s.get("realized_today"),"positions":s.get("positions",[])}
        if path.endswith("/audit-logs"): return {"events":s.get("events",[])}
        if path.endswith("/strategies"): return {"strategies":[{"id":"autonomous-edge","status":"active"}]}
        if path.endswith("/strategy-allocator/current"): return {"strategy":"autonomous-edge","allocation":"risk-gated"}
        if path.endswith("/strategy/rollback/status"): return {"status":"not_active","fail_closed":True}
        if path.endswith("/inventory-awareness"): return {"positions":s.get("positions",[]),"gross_notional":s.get("gross_notional")}
        if path.endswith("/regime-transition"): return {"status":"unknown","reason":"No independently verified transition classifier is active"}
        if path.endswith("/research"): return {"status":"available","fail_closed":True}
        if path.endswith("/autonomous-optimizer/status"): return {"status":"fail_closed","enabled":False,"reason":"Python-native optimizer parity is not independently verified"}
        if path.endswith("/sweep/info"): return {"enabled":False,"reason":"withdrawal/sweep automation is disabled until owner-authenticated Python parity is verified"}
        if path.endswith("/exchanges/credentials"): return {"configured":bool(s.get("reconciliation",{}).get("healthy"))}
        if path.endswith(("/status", "/auth-status")): return await _auth_status(request)
        if path.endswith("/webhook-info"): return {"enabled":False,"reason":"deployment webhook is pipeline-owned"}
        if path.startswith("/api/github/"): return {"status":"python","managed_by":"GitHub Actions","fail_closed":True}
        return {"status":"ok","python":True,"path":path}

    async def _futures_universe():
        """The linear-perp universe, built from Bybit's PUBLIC ticker feed.

        WHY THIS WAS REWRITTEN. This route used to return the Node-era legacy shape
        `{"category": "linear", "pairs": [symbols...]}`, but the React terminal requires
        `{"success": true, "markets": [...]}` and THROWS on anything else. `pairs` is a list of bare
        strings, so even a caller that read it could not get a price. The result was a market selector
        stuck on "Select a market", every quote showing "—", and a blank chart — the UI was calling an
        endpoint that existed but answered a different question.

        REAL DATA OR NO FIELD. Every number here comes from the venue: price/24h change/24h volume/
        bid/ask/funding are ticker fields, spread is computed from bid and ask, and qty step plus taker
        fee come from the instrument data the engine already resolved at boot. There is deliberately NO
        `liquidityScore` or `executionScore`: the engine measures no such quantity, and inventing a
        number to satisfy a TypeScript interface would be fabricating a metric. Those two are optional
        in the frontend contract for exactly that reason.

        `eligible` states whether the symbol is in the engine's configured universe — the UI may browse
        the whole venue, but only these can actually be traded, and `reasons` says so in words.
        """
        gp=_gp()
        try:
            rows = await gp.rest.tickers()
            gp.market_feed_ok = bool(rows)
            gp.market_feed_error = ""
        except Exception as e:
            # Record WHY, so the condition is readable from /api/health without an owner session.
            gp.market_feed_ok = False
            gp.market_feed_error = f"{type(e).__name__}: {e}"[:160]
            # Fail VISIBLY and CLOSED. Returning an empty list here would render as "this venue has no
            # markets", which is a different and much more dangerous claim than "the venue could not be
            # read", and would hide a broken feed behind a plausible-looking screen.
            return JSONResponse(status_code=503, content={
                "success": False, "error": "TICKERS_UNAVAILABLE", "message": str(e), "markets": []})

        configured = set(gp.cfg.symbols)

        # MAKER FEE — measured, not assumed.
        #
        # `/v5/account/fee-rate` returns the ACCOUNT's own tier, so this is ONE call per request rather
        # than one per symbol. With no credential loaded (AWAITING_SECRET) the call cannot be signed, so
        # it falls back to the published VIP0 baseline — but it is then LABELLED `baseline` and travels
        # with `makerFeeBpsSource`, so a measurement and an assumption are never presented alike. Showing
        # a hardcoded 2.0 bps as fact would be a fabricated number on any account with volume, and this
        # panel exists precisely to judge whether an edge clears cost.
        maker_bps: float = 2.0
        maker_src: str = "baseline"
        probe = next(iter(gp.cfg.symbols), None)
        if probe:
            try:
                fee = await gp.rest.fee_rate(probe)
                raw = fee.get("makerFeeRate")
                if raw not in (None, ""):
                    maker_bps, maker_src = round(abs(float(raw)) * 10_000, 6), "measured"
            except Exception:
                pass  # keep the LABELLED baseline; never invent a measured value

        def num(row, key):
            """Ticker fields arrive as strings and are sometimes empty; never raise, never NaN."""
            try:
                v = float(row.get(key) or 0.0)
            except (TypeError, ValueError):
                return 0.0
            return v if math.isfinite(v) else 0.0

        markets = []
        for row in rows or []:
            sym = str(row.get("symbol") or "")
            if not sym.endswith("USDT"):
                continue
            bid, ask, last = num(row, "bid1Price"), num(row, "ask1Price"), num(row, "lastPrice")
            mid = (bid + ask) / 2 if (bid > 0 and ask > 0) else last
            raw_funding = row.get("fundingRate")
            markets.append({
                "exchange": "BYBIT",
                "symbol": sym,
                "baseAsset": sym[:-4],
                "quoteAsset": "USDT",
                "contractType": "PERPETUAL",
                # Bybit's ticker carries no listing status. Saying "Trading" is only justified by a
                # live price; otherwise the honest answer is that we do not know.
                "status": "Trading" if last > 0 else "Unknown",
                "price": mid,
                "volume24h": num(row, "volume24h"),
                "change24hPct": num(row, "price24hPctChg"),
                "fundingRate": (float(raw_funding) if raw_funding not in (None, "") else None),
                "bid": bid,
                "ask": ask,
                "spreadBps": ((ask - bid) / mid * 1e4) if (bid > 0 and ask > 0 and mid > 0) else 0.0,
                # The venue's REAL price tick, resolved from the instrument spec at boot.
                "tickSize": gp.tick_size.get(sym),
                "qtyStep": gp.step_size.get(sym),
                "makerFeeBps": maker_bps,
                "makerFeeBpsSource": maker_src,
                "takerFeeBps": gp.fee_rate_bps.get(sym),
                "eligible": sym in configured,
                "reasons": ([] if sym in configured
                            else ["not in the engine's configured trading universe"]),
            })
        markets.sort(key=lambda m: (not m["eligible"], -(m["volume24h"] or 0.0)))
        return {"success": True, "category": "linear",
                "makerFeeBps": maker_bps, "makerFeeBpsSource": maker_src, "markets": markets}

    async def _mutate(request,symbol=None,id=None,challengerId=None):
        gp=_gp(); path=request.url.path
        if path.endswith(("/gigpilot/arm", "/autonomy")):
            ok,reasons=await gp.arm(); return JSONResponse(status_code=200 if ok else 422,content={"success":ok,"armed":gp.armed,"reasons":reasons,"state":gp.snapshot()})
        # EVERY stop path goes through the one implementation. These used to flip `armed` and nothing
        # else, so pressing stop on this door left orders resting on the venue and the hand-entered
        # credential resident in memory — the same button, with weaker safety depending on the route.
        if path.endswith(("/gigpilot/disarm", "/kill-switch/deactivate")):
            from gigpilot import perform_disarm
            return await perform_disarm(gp, "manual")
        if path.endswith(("/gigpilot/kill", "/kill-switch/trigger")):
            from gigpilot import cancel_and_scrub
            gp.kill()
            out = await cancel_and_scrub(gp)
            out.update({"success": True, "killed": True, "armed": False})
            return out
        if path.endswith(("/kill-switch/toggle", "/mode")):
            from gigpilot import perform_disarm
            out = await perform_disarm(gp, "mode_change")
            out["fail_closed"] = True
            return out
        if "/order/" in path: return JSONResponse(status_code=409,content={"success":False,"error":"MANUAL_ORDER_DISABLED","message":"Autonomous futures execution is the sole live order path; direct/manual order submission is disabled."})
        if path.endswith("/reconciliation/audit"): await gp.reconciler.run_once(); return gp.snapshot().get("reconciliation",{})
        if path.endswith("/decisions/evaluate"): return {"tradable":False,"reason":"Only live verified net-edge decisions may authorize execution","signals":gp.snapshot().get("signals",[])}
        if path.endswith("/research/analyze"): return JSONResponse(status_code=503,content={"success":False,"error":"RESEARCH_NOT_VERIFIED","fail_closed":True})
        if path.endswith(("/autonomous-optimizer/run", "/autonomous-optimizer/toggle")): return JSONResponse(status_code=503,content={"success":False,"error":"OPTIMIZER_NOT_VERIFIED","fail_closed":True})
        if path.endswith("/exchanges/keys"): return JSONResponse(status_code=403,content={"success":False,"error":"Credential mutation is deployment/owner controlled"})
        if path.startswith("/api/github/") or path=="/api/deploy": return JSONResponse(status_code=403,content={"success":False,"error":"Deployment administration is pipeline-owned"})
        return {"success":True,"status":"accepted","fail_closed":True,"path":path}

    @router.post("/api/deploy", dependencies=[Depends(require_owner)])
    async def legacy_0(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/auth-status", dependencies=[Depends(require_owner)])
    async def legacy_1(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/configure-remote", dependencies=[Depends(require_owner)])
    async def legacy_2(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.delete("/api/github/delete-ssh", dependencies=[Depends(require_owner)])
    async def legacy_3(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.delete("/api/github/delete-token", dependencies=[Depends(require_owner)])
    async def legacy_4(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/deployments", dependencies=[Depends(require_owner)])
    async def legacy_5(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/generate-ssh", dependencies=[Depends(require_owner)])
    async def legacy_6(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/git-op", dependencies=[Depends(require_owner)])
    async def legacy_7(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/gitops-events", dependencies=[Depends(require_owner)])
    async def legacy_8(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/push-and-deploy", dependencies=[Depends(require_owner)])
    async def legacy_9(request: Request, symbol: str | None=None, id: str | None=None,
                       challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/save-ssh", dependencies=[Depends(require_owner)])
    async def legacy_10(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/save-token", dependencies=[Depends(require_owner)])
    async def legacy_11(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/simulate-webhook", dependencies=[Depends(require_owner)])
    async def legacy_12(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/status", dependencies=[Depends(require_owner)])
    async def legacy_13(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/test-connection", dependencies=[Depends(require_owner)])
    async def legacy_14(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/trigger-deploy", dependencies=[Depends(require_owner)])
    async def legacy_15(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/webhook", dependencies=[Depends(require_owner)])
    async def legacy_16(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/webhook-info", dependencies=[Depends(require_owner)])
    async def legacy_17(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/assets", dependencies=[Depends(require_owner)])
    async def legacy_18(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/audit-logs", dependencies=[Depends(require_owner)])
    async def legacy_19(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/auth/login")
    @router.post("/api/trading/auth/login")
    @router.put("/api/trading/auth/login")
    @router.patch("/api/trading/auth/login")
    @router.delete("/api/trading/auth/login")
    async def legacy_20(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/auth/login/")
    @router.post("/api/trading/auth/login/")
    @router.put("/api/trading/auth/login/")
    @router.patch("/api/trading/auth/login/")
    @router.delete("/api/trading/auth/login/")
    async def legacy_21(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/auth/logout")
    @router.post("/api/trading/auth/logout")
    @router.put("/api/trading/auth/logout")
    @router.patch("/api/trading/auth/logout")
    @router.delete("/api/trading/auth/logout")
    async def legacy_22(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.get("/api/trading/auth/logout/")
    @router.post("/api/trading/auth/logout/")
    @router.put("/api/trading/auth/logout/")
    @router.patch("/api/trading/auth/logout/")
    @router.delete("/api/trading/auth/logout/")
    async def legacy_23(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.get("/api/trading/auth/setup-complete")
    @router.post("/api/trading/auth/setup-complete")
    @router.put("/api/trading/auth/setup-complete")
    @router.patch("/api/trading/auth/setup-complete")
    @router.delete("/api/trading/auth/setup-complete")
    async def legacy_24(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/auth/setup-complete/")
    @router.post("/api/trading/auth/setup-complete/")
    @router.put("/api/trading/auth/setup-complete/")
    @router.patch("/api/trading/auth/setup-complete/")
    @router.delete("/api/trading/auth/setup-complete/")
    async def legacy_25(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/auth/setup-init")
    @router.post("/api/trading/auth/setup-init")
    @router.put("/api/trading/auth/setup-init")
    @router.patch("/api/trading/auth/setup-init")
    @router.delete("/api/trading/auth/setup-init")
    async def legacy_26(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/auth/setup-init/")
    @router.post("/api/trading/auth/setup-init/")
    @router.put("/api/trading/auth/setup-init/")
    @router.patch("/api/trading/auth/setup-init/")
    @router.delete("/api/trading/auth/setup-init/")
    async def legacy_27(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/auth/status")
    @router.post("/api/trading/auth/status")
    @router.put("/api/trading/auth/status")
    @router.patch("/api/trading/auth/status")
    @router.delete("/api/trading/auth/status")
    async def legacy_28(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/auth/status/")
    @router.post("/api/trading/auth/status/")
    @router.put("/api/trading/auth/status/")
    @router.patch("/api/trading/auth/status/")
    @router.delete("/api/trading/auth/status/")
    async def legacy_29(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.post("/api/trading/autonomous-optimizer/run", dependencies=[Depends(require_owner)])
    async def legacy_30(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/autonomous-optimizer/status", dependencies=[Depends(require_owner)])
    async def legacy_31(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/autonomous-optimizer/toggle", dependencies=[Depends(require_owner)])
    async def legacy_32(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/autonomy", dependencies=[Depends(require_owner)])
    async def legacy_33(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/decisions", dependencies=[Depends(require_owner)])
    async def legacy_34(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/decisions/evaluate", dependencies=[Depends(require_owner)])
    async def legacy_35(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/engines/{id}/clear-errors", dependencies=[Depends(require_owner)])
    async def legacy_36(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/engines/{id}/off-switch", dependencies=[Depends(require_owner)])
    async def legacy_37(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/engines/health", dependencies=[Depends(require_owner)])
    async def legacy_38(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/exchanges/credentials", dependencies=[Depends(require_owner)])
    async def legacy_39(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/exchanges/keys", dependencies=[Depends(require_owner)])
    async def legacy_40(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/futures/universe", dependencies=[Depends(require_owner)])
    async def legacy_41(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/gigpilot/arm", dependencies=[Depends(require_owner)])
    async def legacy_42(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/gigpilot/disarm", dependencies=[Depends(require_owner)])
    async def legacy_43(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/gigpilot/health", dependencies=[Depends(require_owner)])
    async def legacy_44(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/gigpilot/kill", dependencies=[Depends(require_owner)])
    async def legacy_45(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/gigpilot/state", dependencies=[Depends(require_owner)])
    async def legacy_46(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/grid/configure", dependencies=[Depends(require_owner)])
    async def legacy_47(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/inventory-awareness", dependencies=[Depends(require_owner)])
    async def legacy_48(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/kill-switch/deactivate", dependencies=[Depends(require_owner)])
    async def legacy_49(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/kill-switch/toggle", dependencies=[Depends(require_owner)])
    async def legacy_50(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/kill-switch/trigger", dependencies=[Depends(require_owner)])
    async def legacy_51(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/login")
    @router.post("/api/trading/login")
    @router.put("/api/trading/login")
    @router.patch("/api/trading/login")
    @router.delete("/api/trading/login")
    async def legacy_52(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/login/")
    @router.post("/api/trading/login/")
    @router.put("/api/trading/login/")
    @router.patch("/api/trading/login/")
    @router.delete("/api/trading/login/")
    async def legacy_53(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/logout")
    @router.post("/api/trading/logout")
    @router.put("/api/trading/logout")
    @router.patch("/api/trading/logout")
    @router.delete("/api/trading/logout")
    async def legacy_54(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.get("/api/trading/logout/")
    @router.post("/api/trading/logout/")
    @router.put("/api/trading/logout/")
    @router.patch("/api/trading/logout/")
    @router.delete("/api/trading/logout/")
    async def legacy_55(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.post("/api/trading/mode", dependencies=[Depends(require_owner)])
    async def legacy_56(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/order/cancel", dependencies=[Depends(require_owner)])
    async def legacy_57(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/order/cancel-all", dependencies=[Depends(require_owner)])
    async def legacy_58(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/order/place", dependencies=[Depends(require_owner)])
    async def legacy_59(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/pair/{symbol}", dependencies=[Depends(require_owner)])
    async def legacy_60(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/pair/select", dependencies=[Depends(require_owner)])
    async def legacy_61(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/pairs", dependencies=[Depends(require_owner)])
    async def legacy_62(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/quant/edge-breakdown", dependencies=[Depends(require_owner)])
    async def legacy_63(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/readiness", dependencies=[Depends(require_owner)])
    async def legacy_64(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/reconciliation/audit", dependencies=[Depends(require_owner)])
    async def legacy_65(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/reconciliation/status", dependencies=[Depends(require_owner)])
    async def legacy_66(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/regime-transition", dependencies=[Depends(require_owner)])
    async def legacy_67(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/research", dependencies=[Depends(require_owner)])
    async def legacy_68(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/research/analyze", dependencies=[Depends(require_owner)])
    async def legacy_69(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/risk", dependencies=[Depends(require_owner)])
    async def legacy_70(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/risk/circuit-breaker/reset", dependencies=[Depends(require_owner)])
    async def legacy_71(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/risk/config", dependencies=[Depends(require_owner)])
    async def legacy_72(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/script/validate", dependencies=[Depends(require_owner)])
    async def legacy_73(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/setup-complete")
    @router.post("/api/trading/setup-complete")
    @router.put("/api/trading/setup-complete")
    @router.patch("/api/trading/setup-complete")
    @router.delete("/api/trading/setup-complete")
    async def legacy_74(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/setup-complete/")
    @router.post("/api/trading/setup-complete/")
    @router.put("/api/trading/setup-complete/")
    @router.patch("/api/trading/setup-complete/")
    @router.delete("/api/trading/setup-complete/")
    async def legacy_75(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/setup-init")
    @router.post("/api/trading/setup-init")
    @router.put("/api/trading/setup-init")
    @router.patch("/api/trading/setup-init")
    @router.delete("/api/trading/setup-init")
    async def legacy_76(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/setup-init/")
    @router.post("/api/trading/setup-init/")
    @router.put("/api/trading/setup-init/")
    @router.patch("/api/trading/setup-init/")
    @router.delete("/api/trading/setup-init/")
    async def legacy_77(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str |
                        None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/state", dependencies=[Depends(require_owner)])
    async def legacy_78(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/status")
    @router.post("/api/trading/status")
    @router.put("/api/trading/status")
    @router.patch("/api/trading/status")
    @router.delete("/api/trading/status")
    async def legacy_79(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/status/")
    @router.post("/api/trading/status/")
    @router.put("/api/trading/status/")
    @router.patch("/api/trading/status/")
    @router.delete("/api/trading/status/")
    async def legacy_80(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/strategies", dependencies=[Depends(require_owner)])
    async def legacy_81(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/strategy-allocator/current", dependencies=[Depends(require_owner)])
    async def legacy_82(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy-allocator/reallocate", dependencies=[Depends(require_owner)])
    async def legacy_83(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/strategy/compare/{challengerId}", dependencies=[Depends(require_owner)])
    async def legacy_84(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/create-variant", dependencies=[Depends(require_owner)])
    async def legacy_85(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/evaluate-evidence", dependencies=[Depends(require_owner)])
    async def legacy_86(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/promote", dependencies=[Depends(require_owner)])
    async def legacy_87(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/rollback", dependencies=[Depends(require_owner)])
    async def legacy_88(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/strategy/rollback/status", dependencies=[Depends(require_owner)])
    async def legacy_89(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/sweep/auto", dependencies=[Depends(require_owner)])
    async def legacy_90(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/sweep/execute", dependencies=[Depends(require_owner)])
    async def legacy_91(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/sweep/info", dependencies=[Depends(require_owner)])
    async def legacy_92(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/sweep/wallet", dependencies=[Depends(require_owner)])
    async def legacy_93(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/updates", dependencies=[Depends(require_owner)])
    async def legacy_94(request: Request, symbol: str | None=None, id: str | None=None,
                        challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    app.include_router(router)
