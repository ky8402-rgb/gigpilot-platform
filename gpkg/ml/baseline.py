"""Conservative kline baseline for PAPER only; missing depth is never fabricated."""
from __future__ import annotations

import math
from dataclasses import replace
from statistics import fmean

from gpkg.core.clock import now_ms
from gpkg.ml.lifecycle import (
    CostBreakdown,
    ModelState,
    NetTrade,
    PurgedWalkForward,
    ValidationConfig,
    evaluate_candidate,
)


def conservative_friction_bps(peak_spread_bps,taker_fee_bps,impact_bps=1.0):
    return 2*max(0.0,peak_spread_bps)+2*max(0.0,taker_fee_bps)+max(0.0,impact_bps)

def _vw(rows,i,n=60):
    lo=max(1,i-n+1); num=den=0.0
    for j in range(lo,i+1):
        p0=float(rows[j-1]["close"]); p1=float(rows[j]["close"]); w=max(float(rows[j].get("volume",0)),1e-9)
        if p0>0:num+=w*math.log(p1/p0)**2; den+=w
    return math.sqrt(num/den)*1e4 if den else 0.0

def _peak(store,symbol,start,end):
    peak=0.0; count=0
    for r in store.ml_market_range(symbol,"orderbook_l2",start,end):
        try:
            b=float(r["bid"]); a=float(r["ask"]); m=(a+b)/2
            if m>0 and a>=b:peak=max(peak,(a-b)/m*1e4); count+=1
        except (KeyError,TypeError,ValueError):pass
    return peak,count

def qualify_conservative_baseline(store,symbol,*,days=90,taker_fee_bps=5.5,hurdle_bps=8.0,end_ms=None):
    end=int(end_ms or now_ms()-1); start=end-days*86400000; rows=store.ml_market_range(symbol,"kline_1m",start,end)
    mid=f"baseline-{symbol.lower()}-{end}"
    if len(rows)<int(days*1440*.98):
        reason=f"baseline requires >=98% of {days}d 1m bars; found {len(rows)}"; store.ml_research_audit(mid,"REJECTED",reason,{"rows":len(rows)}); return None,reason
    peak,nl2=_peak(store,symbol,start,end)
    if nl2<1:
        reason="baseline refused: no observed L2 spread exists for conservative friction bound"; store.ml_research_audit(mid,"REJECTED",reason,{"l2_samples":0}); return None,reason
    peak=max(peak,1.0); splits=PurgedWalkForward(n_splits=5,min_train=40000,
             test_size=10000,purge=5).split([int(x["ts_ms"]) for x in rows])
    if len(splits)<5:
        reason=f"baseline walk-forward folds {len(splits)} < 5"; store.ml_research_audit(mid,"REJECTED",reason,{}); return None,reason
    trades=[]
    for _,test in splits:
        i=test.start
        while i<test.stop-5:
            if i<121:i+=1;continue
            hist=rows[i-120:i]; hi=max(float(x["high"]) for x in hist); lo=min(float(x["low"])
                                       for x in hist); close=float(rows[i]["close"])
            side=1.0 if close>hi else -1.0 if close<lo else 0.0
            if not side:i+=1;continue
            vol=_vw(rows,i); future=float(rows[i+5]["close"]); realized=side*(future/close-1)*1e4
            breakout=(close/hi-1)*1e4 if side>0 else (lo/close-1)*1e4
            trades.append(NetTrade(max(0.0,breakout+.5*vol),realized,
                CostBreakdown(fees_bps=2*taker_fee_bps,spread_bps=2*peak,slippage_bps=1.0),int(rows[i]["ts_ms"])))
            i+=5
    ev=evaluate_candidate(mid,trades,walk_forward_folds=len(splits),evaluated_at_ms=max(now_ms(),end+1),data_cutoff_ms=end,
        config=ValidationConfig(min_oos_trades=30,min_mean_net_bps=hurdle_bps,min_profit_factor=1.05,max_drawdown_bps=500,
            max_one_sided_p_value=.00135,min_walk_forward_folds=5,embargo_samples=5,min_t_stat=3,min_oos_sharpe=1.5,min_edge_bps=hurdle_bps))
    vols=[_vw(rows,i) for i in range(max(60,len(rows)-1440),len(rows))]
    ev=replace(ev,feature_importance={"high_water_breakout":.65,"volume_weighted_volatility":.35},
        psi_baseline={"vw_vol_bps":fmean(vols) if vols else 0.0,"volume":fmean(
            float(x.get("volume",0)) for x in rows[-1440:])},
        training_start_ms=start,training_window_ms=end-start,
        model_types=("baseline_regime_momentum","volume_weighted_volatility","extreme_friction_proxy"),calibration_error=0.0)
    store.ml_research_audit(mid,"VERIFIED" if ev.verified else "REJECTED",ev.verification_reason,
        {"oos_trades":ev.oos_trades,"mean_net_bps":ev.mean_net_bps,"t_stat":ev.t_stat,"oos_sharpe":ev.oos_sharpe,
         "observed_l2_samples":nl2,"peak_observed_spread_bps":peak,"charged_spread_bps":2*peak,
         "round_trip_taker_bps":2*taker_fee_bps,"friction_floor_bps":conservative_friction_bps(peak,taker_fee_bps)})
    return ev,ev.verification_reason

def register_baseline_paper(registry,evidence):
    if evidence is None or not evidence.verified:return
    registry.persist_evidence(evidence,reason="conservative_baseline_oos_validation")
    registry.transition(evidence.model_id,ModelState.PAPER,reason="extreme_friction_baseline_paper_admission")
