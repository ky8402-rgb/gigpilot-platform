"""Python-native compatibility/control-plane API for the legacy Node surface.

Every live mutation remains owner-authenticated and fail-closed. Legacy manual order APIs are
intentionally disabled because the production architecture is autonomous futures-only execution.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from gpkg.api.auth import require_owner, get_owner_auth, extract_token

def register_compat_routes(app, get_gp):
    router=APIRouter()

    @router.get("/api/ml/audit/latest", dependencies=[Depends(require_owner)])
    async def ml_audit_latest(limit: int = 50):
        gp = get_gp()
        audits = gp.store.ml_research_audits(limit=max(1, min(limit, 100)))
        rows = []
        for audit in audits:
            payload = audit.get("payload") or {}
            evidence = payload.get("evidence") if isinstance(payload.get("evidence"), dict) else payload
            costs = payload.get("cost_deductions") or payload.get("costs") or {}
            net = payload.get("net_edge_bps", payload.get("mean_net_bps", evidence.get("mean_net_bps", 0.0)))
            gross = payload.get("gross_edge_bps", evidence.get("gross_edge_bps", 0.0))
            rows.append({
                "ts_ms": audit["ts_ms"], "model_id": audit["model_id"], "outcome": audit["outcome"],
                "reason": audit["reason"], "model_family": payload.get("family") or payload.get("model_family") or audit["model_id"],
                "gross_edge_bps": float(gross or 0.0),
                "cost_deductions": {
                    "fees_bps": float(costs.get("fees_bps", 0.0) or 0.0),
                    "two_x_peak_spread_bps": float(costs.get("two_x_peak_spread_bps", costs.get("spread_bps", 0.0)) or 0.0),
                    "modeled_impact_bps": float(costs.get("modeled_impact_bps", costs.get("slippage_bps", 0.0)) or 0.0),
                },
                "net_edge_bps": float(net or 0.0),
                "t_stat": float(payload.get("t_stat", evidence.get("t_stat", 0.0)) or 0.0),
                "oos_sharpe": float(payload.get("oos_sharpe", evidence.get("oos_sharpe", 0.0)) or 0.0),
                "gate_outcome": bool(payload.get("gate_outcome", evidence.get("verified", audit["outcome"] == "VERIFIED"))),
                "gate_thresholds": payload.get("gate_thresholds", {"net_edge_bps": 8.0, "t_stat": 3.0, "oos_sharpe": 1.5}),
            })
        return {"success": True, "audits": rows, "real_capital_execution": False if gp.force_disarm else None}
    async def _auth_status(request):
        auth=get_owner_auth(); return auth.status(auth.verify(extract_token(request) or ""))
    async def _read(request,symbol=None,id=None,challengerId=None):
        gp=get_gp(); path=request.url.path; s=gp.snapshot()
        if path.endswith("/state"): return s
        if path.endswith("/health"): return {"status":"healthy" if s.get("reconciliation",{}).get("healthy") else "degraded",**s}
        if path.endswith("/readiness"): return {"ready":bool(s.get("armable")),"armed":s.get("armed"),"blockers":[] if s.get("armable") else ["live safety preflight has not passed"]}
        if path.endswith("/risk"): return {"equity":s.get("equity"),"gross_notional":s.get("gross_notional"),"margin_ratio":s.get("margin_ratio"),"armed":s.get("armed"),"position_mode":s.get("position_mode"),"hurdle_bps":s.get("hurdle_bps")}
        if path.endswith("/reconciliation/status"): return s.get("reconciliation",{})
        if path.endswith("/pairs"): return {"pairs":[m.get("symbol") for m in s.get("markets",[])]}
        if "/pair/" in path: return next((m for m in s.get("markets",[]) if m.get("symbol")==symbol),{"error":"unknown_symbol"})
        if path.endswith("/futures/universe"): return {"category":"linear","pairs":[m.get("symbol") for m in s.get("markets",[])]}
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
        if path.endswith("/status") or path.endswith("/auth-status"): return await _auth_status(request)
        if path.endswith("/webhook-info"): return {"enabled":False,"reason":"deployment webhook is pipeline-owned"}
        if path.startswith("/api/github/"): return {"status":"python","managed_by":"GitHub Actions","fail_closed":True}
        return {"status":"ok","python":True,"path":path}
    async def _mutate(request,symbol=None,id=None,challengerId=None):
        gp=get_gp(); path=request.url.path
        if path.endswith("/gigpilot/arm") or path.endswith("/autonomy"):
            ok,reasons=await gp.arm(); return JSONResponse(status_code=200 if ok else 422,content={"success":ok,"armed":gp.armed,"reasons":reasons,"state":gp.snapshot()})
        if path.endswith("/gigpilot/disarm") or path.endswith("/kill-switch/deactivate"): gp.disarm("manual"); return {"success":True,"armed":False}
        if path.endswith("/gigpilot/kill") or path.endswith("/kill-switch/trigger"): gp.kill(); return {"success":True,"killed":True,"armed":False}
        if path.endswith("/kill-switch/toggle") or path.endswith("/mode"): gp.disarm("mode_change"); return {"success":True,"armed":False,"fail_closed":True}
        if "/order/" in path: return JSONResponse(status_code=409,content={"success":False,"error":"MANUAL_ORDER_DISABLED","message":"Autonomous futures execution is the sole live order path; direct/manual order submission is disabled."})
        if path.endswith("/reconciliation/audit"): await gp.reconciler.run_once(); return gp.snapshot().get("reconciliation",{})
        if path.endswith("/decisions/evaluate"): return {"tradable":False,"reason":"Only live verified net-edge decisions may authorize execution","signals":gp.snapshot().get("signals",[])}
        if path.endswith("/research/analyze"): return JSONResponse(status_code=503,content={"success":False,"error":"RESEARCH_NOT_VERIFIED","fail_closed":True})
        if path.endswith("/autonomous-optimizer/run") or path.endswith("/autonomous-optimizer/toggle"): return JSONResponse(status_code=503,content={"success":False,"error":"OPTIMIZER_NOT_VERIFIED","fail_closed":True})
        if path.endswith("/exchanges/keys"): return JSONResponse(status_code=403,content={"success":False,"error":"Credential mutation is deployment/owner controlled"})
        if path.startswith("/api/github/") or path=="/api/deploy": return JSONResponse(status_code=403,content={"success":False,"error":"Deployment administration is pipeline-owned"})
        return {"success":True,"status":"accepted","fail_closed":True,"path":path}

    @router.post("/api/deploy", dependencies=[Depends(require_owner)])
    async def legacy_0(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/auth-status", dependencies=[Depends(require_owner)])
    async def legacy_1(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/configure-remote", dependencies=[Depends(require_owner)])
    async def legacy_2(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.delete("/api/github/delete-ssh", dependencies=[Depends(require_owner)])
    async def legacy_3(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.delete("/api/github/delete-token", dependencies=[Depends(require_owner)])
    async def legacy_4(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/deployments", dependencies=[Depends(require_owner)])
    async def legacy_5(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/generate-ssh", dependencies=[Depends(require_owner)])
    async def legacy_6(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/git-op", dependencies=[Depends(require_owner)])
    async def legacy_7(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/gitops-events", dependencies=[Depends(require_owner)])
    async def legacy_8(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/push-and-deploy", dependencies=[Depends(require_owner)])
    async def legacy_9(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/save-ssh", dependencies=[Depends(require_owner)])
    async def legacy_10(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/save-token", dependencies=[Depends(require_owner)])
    async def legacy_11(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/simulate-webhook", dependencies=[Depends(require_owner)])
    async def legacy_12(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/status", dependencies=[Depends(require_owner)])
    async def legacy_13(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/github/test-connection", dependencies=[Depends(require_owner)])
    async def legacy_14(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/trigger-deploy", dependencies=[Depends(require_owner)])
    async def legacy_15(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/github/webhook", dependencies=[Depends(require_owner)])
    async def legacy_16(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/github/webhook-info", dependencies=[Depends(require_owner)])
    async def legacy_17(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/assets", dependencies=[Depends(require_owner)])
    async def legacy_18(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/audit-logs", dependencies=[Depends(require_owner)])
    async def legacy_19(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/auth/login")
    @router.post("/api/trading/auth/login")
    @router.put("/api/trading/auth/login")
    @router.patch("/api/trading/auth/login")
    @router.delete("/api/trading/auth/login")
    async def legacy_20(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/auth/login/")
    @router.post("/api/trading/auth/login/")
    @router.put("/api/trading/auth/login/")
    @router.patch("/api/trading/auth/login/")
    @router.delete("/api/trading/auth/login/")
    async def legacy_21(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/auth/logout")
    @router.post("/api/trading/auth/logout")
    @router.put("/api/trading/auth/logout")
    @router.patch("/api/trading/auth/logout")
    @router.delete("/api/trading/auth/logout")
    async def legacy_22(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.get("/api/trading/auth/logout/")
    @router.post("/api/trading/auth/logout/")
    @router.put("/api/trading/auth/logout/")
    @router.patch("/api/trading/auth/logout/")
    @router.delete("/api/trading/auth/logout/")
    async def legacy_23(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.get("/api/trading/auth/setup-complete")
    @router.post("/api/trading/auth/setup-complete")
    @router.put("/api/trading/auth/setup-complete")
    @router.patch("/api/trading/auth/setup-complete")
    @router.delete("/api/trading/auth/setup-complete")
    async def legacy_24(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/auth/setup-complete/")
    @router.post("/api/trading/auth/setup-complete/")
    @router.put("/api/trading/auth/setup-complete/")
    @router.patch("/api/trading/auth/setup-complete/")
    @router.delete("/api/trading/auth/setup-complete/")
    async def legacy_25(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/auth/setup-init")
    @router.post("/api/trading/auth/setup-init")
    @router.put("/api/trading/auth/setup-init")
    @router.patch("/api/trading/auth/setup-init")
    @router.delete("/api/trading/auth/setup-init")
    async def legacy_26(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/auth/setup-init/")
    @router.post("/api/trading/auth/setup-init/")
    @router.put("/api/trading/auth/setup-init/")
    @router.patch("/api/trading/auth/setup-init/")
    @router.delete("/api/trading/auth/setup-init/")
    async def legacy_27(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/auth/status")
    @router.post("/api/trading/auth/status")
    @router.put("/api/trading/auth/status")
    @router.patch("/api/trading/auth/status")
    @router.delete("/api/trading/auth/status")
    async def legacy_28(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/auth/status/")
    @router.post("/api/trading/auth/status/")
    @router.put("/api/trading/auth/status/")
    @router.patch("/api/trading/auth/status/")
    @router.delete("/api/trading/auth/status/")
    async def legacy_29(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.post("/api/trading/autonomous-optimizer/run", dependencies=[Depends(require_owner)])
    async def legacy_30(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/autonomous-optimizer/status", dependencies=[Depends(require_owner)])
    async def legacy_31(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/autonomous-optimizer/toggle", dependencies=[Depends(require_owner)])
    async def legacy_32(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/autonomy", dependencies=[Depends(require_owner)])
    async def legacy_33(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/decisions", dependencies=[Depends(require_owner)])
    async def legacy_34(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/decisions/evaluate", dependencies=[Depends(require_owner)])
    async def legacy_35(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/engines/{id}/clear-errors", dependencies=[Depends(require_owner)])
    async def legacy_36(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/engines/{id}/off-switch", dependencies=[Depends(require_owner)])
    async def legacy_37(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/engines/health", dependencies=[Depends(require_owner)])
    async def legacy_38(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/exchanges/credentials", dependencies=[Depends(require_owner)])
    async def legacy_39(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/exchanges/keys", dependencies=[Depends(require_owner)])
    async def legacy_40(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/futures/universe", dependencies=[Depends(require_owner)])
    async def legacy_41(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/gigpilot/arm", dependencies=[Depends(require_owner)])
    async def legacy_42(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/gigpilot/disarm", dependencies=[Depends(require_owner)])
    async def legacy_43(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/gigpilot/health", dependencies=[Depends(require_owner)])
    async def legacy_44(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/gigpilot/kill", dependencies=[Depends(require_owner)])
    async def legacy_45(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/gigpilot/state", dependencies=[Depends(require_owner)])
    async def legacy_46(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/grid/configure", dependencies=[Depends(require_owner)])
    async def legacy_47(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/inventory-awareness", dependencies=[Depends(require_owner)])
    async def legacy_48(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/kill-switch/deactivate", dependencies=[Depends(require_owner)])
    async def legacy_49(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/kill-switch/toggle", dependencies=[Depends(require_owner)])
    async def legacy_50(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/kill-switch/trigger", dependencies=[Depends(require_owner)])
    async def legacy_51(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/login")
    @router.post("/api/trading/login")
    @router.put("/api/trading/login")
    @router.patch("/api/trading/login")
    @router.delete("/api/trading/login")
    async def legacy_52(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/login/")
    @router.post("/api/trading/login/")
    @router.put("/api/trading/login/")
    @router.patch("/api/trading/login/")
    @router.delete("/api/trading/login/")
    async def legacy_53(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/logout")
    @router.post("/api/trading/logout")
    @router.put("/api/trading/logout")
    @router.patch("/api/trading/logout")
    @router.delete("/api/trading/logout")
    async def legacy_54(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.get("/api/trading/logout/")
    @router.post("/api/trading/logout/")
    @router.put("/api/trading/logout/")
    @router.patch("/api/trading/logout/")
    @router.delete("/api/trading/logout/")
    async def legacy_55(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"loggedOut":True}

    @router.post("/api/trading/mode", dependencies=[Depends(require_owner)])
    async def legacy_56(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/order/cancel", dependencies=[Depends(require_owner)])
    async def legacy_57(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/order/cancel-all", dependencies=[Depends(require_owner)])
    async def legacy_58(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/order/place", dependencies=[Depends(require_owner)])
    async def legacy_59(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/pair/{symbol}", dependencies=[Depends(require_owner)])
    async def legacy_60(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/pair/select", dependencies=[Depends(require_owner)])
    async def legacy_61(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/pairs", dependencies=[Depends(require_owner)])
    async def legacy_62(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/quant/edge-breakdown", dependencies=[Depends(require_owner)])
    async def legacy_63(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/readiness", dependencies=[Depends(require_owner)])
    async def legacy_64(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/reconciliation/audit", dependencies=[Depends(require_owner)])
    async def legacy_65(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/reconciliation/status", dependencies=[Depends(require_owner)])
    async def legacy_66(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/regime-transition", dependencies=[Depends(require_owner)])
    async def legacy_67(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/research", dependencies=[Depends(require_owner)])
    async def legacy_68(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/research/analyze", dependencies=[Depends(require_owner)])
    async def legacy_69(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/risk", dependencies=[Depends(require_owner)])
    async def legacy_70(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/risk/circuit-breaker/reset", dependencies=[Depends(require_owner)])
    async def legacy_71(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/risk/config", dependencies=[Depends(require_owner)])
    async def legacy_72(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/script/validate", dependencies=[Depends(require_owner)])
    async def legacy_73(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/setup-complete")
    @router.post("/api/trading/setup-complete")
    @router.put("/api/trading/setup-complete")
    @router.patch("/api/trading/setup-complete")
    @router.delete("/api/trading/setup-complete")
    async def legacy_74(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/setup-complete/")
    @router.post("/api/trading/setup-complete/")
    @router.put("/api/trading/setup-complete/")
    @router.patch("/api/trading/setup-complete/")
    @router.delete("/api/trading/setup-complete/")
    async def legacy_75(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return {"success":True,"configured":get_owner_auth().is_configured}

    @router.get("/api/trading/setup-init")
    @router.post("/api/trading/setup-init")
    @router.put("/api/trading/setup-init")
    @router.patch("/api/trading/setup-init")
    @router.delete("/api/trading/setup-init")
    async def legacy_76(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/setup-init/")
    @router.post("/api/trading/setup-init/")
    @router.put("/api/trading/setup-init/")
    @router.patch("/api/trading/setup-init/")
    @router.delete("/api/trading/setup-init/")
    async def legacy_77(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return JSONResponse(status_code=401,content={"success":False,"error":"break-glass PIN required"})

    @router.get("/api/trading/state", dependencies=[Depends(require_owner)])
    async def legacy_78(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/status")
    @router.post("/api/trading/status")
    @router.put("/api/trading/status")
    @router.patch("/api/trading/status")
    @router.delete("/api/trading/status")
    async def legacy_79(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/status/")
    @router.post("/api/trading/status/")
    @router.put("/api/trading/status/")
    @router.patch("/api/trading/status/")
    @router.delete("/api/trading/status/")
    async def legacy_80(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _auth_status(request)

    @router.get("/api/trading/strategies", dependencies=[Depends(require_owner)])
    async def legacy_81(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.get("/api/trading/strategy-allocator/current", dependencies=[Depends(require_owner)])
    async def legacy_82(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy-allocator/reallocate", dependencies=[Depends(require_owner)])
    async def legacy_83(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/strategy/compare/{challengerId}", dependencies=[Depends(require_owner)])
    async def legacy_84(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/create-variant", dependencies=[Depends(require_owner)])
    async def legacy_85(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/evaluate-evidence", dependencies=[Depends(require_owner)])
    async def legacy_86(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/promote", dependencies=[Depends(require_owner)])
    async def legacy_87(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/strategy/rollback", dependencies=[Depends(require_owner)])
    async def legacy_88(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/strategy/rollback/status", dependencies=[Depends(require_owner)])
    async def legacy_89(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/sweep/auto", dependencies=[Depends(require_owner)])
    async def legacy_90(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.post("/api/trading/sweep/execute", dependencies=[Depends(require_owner)])
    async def legacy_91(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/sweep/info", dependencies=[Depends(require_owner)])
    async def legacy_92(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    @router.post("/api/trading/sweep/wallet", dependencies=[Depends(require_owner)])
    async def legacy_93(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _mutate(request,symbol,id,challengerId)

    @router.get("/api/trading/updates", dependencies=[Depends(require_owner)])
    async def legacy_94(request: Request, symbol: str | None=None, id: str | None=None, challengerId: str | None=None): return await _read(request,symbol,id,challengerId)

    app.include_router(router)
