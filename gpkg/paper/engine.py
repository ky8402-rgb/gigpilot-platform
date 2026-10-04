"""Real-time paper execution. This module intentionally has no exchange/executor dependency."""
from __future__ import annotations
import math
from collections import deque
from dataclasses import dataclass
from typing import Any
from statistics import pstdev
from gpkg.core.clock import now_iso, now_ms
from gpkg.ml.lifecycle import ModelState
from gpkg.persistence.store import Store

@dataclass
class PaperPosition:
    trade_id:int; symbol:str; side:str; qty:float; entry_px:float
    entry_fee_usd:float; entry_slippage_bps:float; opened_ms:int; model_id:str

class PaperTradingEngine:
    def __init__(self,store:Store,registry:Any,markets:dict[str,Any],fee_rate_bps:dict[str,float],
                 *,hurdle_bps:float=8.0,starting_equity:float=10000.0,stale_ms:int=500):
        self.store=store; self.registry=registry; self.markets=markets; self.fee_rate_bps=fee_rate_bps
        self.hurdle_bps=max(8.0,float(hurdle_bps)); self.stale_ms=max(100,int(stale_ms))
        self.starting_equity=max(100.0,float(starting_equity))
        self.bars={s:deque(maxlen=360) for s in markets}; self.positions={}
        self.rejections=deque(maxlen=100); self._last_book_persist_ms={}; self._last_eval_ms={}; self._last_reject={}
        self._model_cache=(0,None)

    def warmup(self):
        end=now_ms(); start=end-2*86400000
        for s in self.markets:
            for row in self.store.ml_market_range(s,"kline_1m",start,end)[-360:]: self.bars[s].append(row)
        for r in self.store.paper_open_trades():
            self.positions[r["symbol"]]=PaperPosition(r["id"],r["symbol"],r["side"],r["qty"],r["entry_px"],
                r["entry_fee_usd"],r["entry_slippage_bps"],r["open_ts_ms"],r["model_id"])
        v=self.store.kv_get("paper_starting_equity")
        if v is None: self.store.kv_set("paper_starting_equity",str(self.starting_equity))
        else:
            try:self.starting_equity=max(100.0,float(v))
            except ValueError:pass

    def _paper_model(self):
        ts=now_ms(); cached_at,cached=self._model_cache
        if ts-cached_at<10000:return cached
        xs=[e for e in self.registry.list() if e.verified and e.state is ModelState.PAPER]
        model=max(xs,key=lambda e:e.evaluated_at_ms,default=None); self._model_cache=(ts,model); return model

    @staticmethod
    def _book_payload(ms):
        if not ms.bids or not ms.asks:return None
        b=list(ms.bids[:50]); a=list(ms.asks[:50])
        return {"bid":float(b[0][0]),"ask":float(a[0][0]),"bid_depth":sum(float(p)*float(q) for p,q in b),
                "ask_depth":sum(float(p)*float(q) for p,q in a),"bid_levels":b,"ask_levels":a,"volume_1m":0.0}

    def on_book(self,symbol,ms):
        ts=now_ms(); payload=self._book_payload(ms)
        if payload is None:return
        if ts-self._last_book_persist_ms.get(symbol,0)>=1000:
            self.store.ml_market_upsert(symbol,"orderbook_l2",ts,payload); self._last_book_persist_ms[symbol]=ts
        if ts-self._last_eval_ms.get(symbol,0)>=500:
            self._last_eval_ms[symbol]=ts; self._evaluate(symbol,ms)

    def on_kline(self,symbol,row):
        try:
            ts=int(row.get("start") or row.get("ts_ms") or 0); close=float(row.get("close") or 0)
            if ts<=0 or close<=0:return
            bar={"ts_ms":ts,"open":float(row.get("open") or close),"high":float(row.get("high") or close),
                 "low":float(row.get("low") or close),"close":close,"volume":float(row.get("volume") or 0),
                 "turnover":float(row.get("turnover") or 0)}
        except (TypeError,ValueError):return
        if bool(row.get("confirm",True)):
            self.store.ml_market_upsert(symbol,"kline_1m",ts,bar); bars=self.bars.setdefault(symbol,deque(maxlen=360))
            if not bars or int(bars[-1]["ts_ms"])<ts:bars.append(bar)
            elif int(bars[-1]["ts_ms"])==ts:bars[-1]=bar
            self._maybe_exit(symbol)

    @staticmethod
    def _vw_vol_bps(bars,lookback=60):
        xs=bars[-(lookback+1):]
        if len(xs)<10:return 0.0
        num=den=0.0
        for a,b in zip(xs,xs[1:]):
            p0=float(a["close"]); p1=float(b["close"])
            if p0<=0:continue
            r=math.log(p1/p0); w=max(float(b.get("volume",0)),1e-9); num+=w*r*r; den+=w
        return math.sqrt(num/den)*1e4 if den else 0.0

    def _features(self,symbol,mid,model):
        bars=list(self.bars.get(symbol,()))
        if len(bars)<30 or mid<=0:return None
        vol=self._vw_vol_bps(bars)
        returns=[]
        for a,b in zip(bars[-61:-1],bars[-60:]):
            p0=float(a["close"]); p1=float(b["close"])
            if p0>0: returns.append(math.log(p1/p0)*1e4)
        vol_hist=[]
        for i in range(20,len(bars)):
            vol_hist.append(self._vw_vol_bps(bars[:i+1]))
        vol_pct=sum(v<=vol for v in vol_hist[-239:])/max(len(vol_hist[-239:]),1) if vol_hist else .5
        hist=bars[-121:-1]; hi=max(float(x["high"]) for x in hist); lo=min(float(x["low"]) for x in hist)
        breakout=0.0; breakout_side=None
        if mid>hi: breakout_side="Buy"; breakout=(mid/hi-1)*1e4
        elif mid<lo: breakout_side="Sell"; breakout=(lo/mid-1)*1e4
        latest_funding=self.store.ml_market_range(symbol,"funding_8h",0,now_ms())[-1:]
        latest_basis=self.store.ml_market_range(symbol,"basis_1m",0,now_ms())[-1:]
        funding=float(latest_funding[0].get("funding_bps",0.0)) if latest_funding else 0.0
        basis=float(latest_basis[0].get("basis_bps",0.0)) if latest_basis else 0.0
        side=breakout_side; score=0.0
        family=" ".join(model.model_types)
        if "funding_rate_carry_reversion" in family:
            f_hist=self.store.ml_market_range(symbol,"funding_8h",max(0,now_ms()-90*86400000),now_ms())
            b_hist=self.store.ml_market_range(symbol,"basis_1m",max(0,now_ms()-90*86400000),now_ms())[-5000:]
            f_scale=max(1.0,pstdev([float(x.get("funding_bps",0.0)) for x in f_hist]) if len(f_hist)>1 else 1.0)
            b_scale=max(1.0,pstdev([float(x.get("basis_bps",0.0)) for x in b_hist]) if len(b_hist)>1 else 1.0)
            score=-(0.65*funding/f_scale+0.35*basis/b_scale)
            side="Buy" if score>0 else "Sell" if score<0 else None
            gross=abs(score)*max(vol,1.0)
        elif "volatility_regime_conditioning" in family:
            low=vol_pct<.50
            recent=sum(returns[-5:])/max(len(returns[-5:]),1) if returns else 0.0
            score=(-recent/max(vol,1.0) if low else recent/max(vol,1.0))
            side=("Buy" if score>0 else "Sell" if score<0 else breakout_side)
            gross=abs(score)*max(vol,1.0)
            if breakout_side and vol_pct>=.75: gross=max(gross,breakout)
        else:
            strength=breakout/max(vol,1.0)
            side=breakout_side; score=strength if side=="Buy" else -strength if side=="Sell" else 0.0
            gross=breakout+vol*.20
        book=self.markets.get(symbol)
        obi=0.0; micro=0.0
        if book and book.bids and book.asks:
            bd=sum(float(p)*float(q) for p,q in list(book.bids[:50])); ad=sum(float(p)*float(q) for p,q in list(book.asks[:50]))
            obi=(bd-ad)/max(bd+ad,1e-12)
            bid=float(book.bids[0][0]); ask=float(book.asks[0][0]); book_mid=(bid+ask)/2
            micro=((ask*bd+bid*ad)/max(bd+ad,1e-12)-book_mid)/max(book_mid,1e-12)*1e4
            if side=="Buy": gross+=max(0.0,obi*vol*.25+micro*.05)
            elif side=="Sell": gross+=max(0.0,-obi*vol*.25-micro*.05)
        probability=min(.95,.50+min(.45,abs(score)*.20))
        return {"side":side,"vw_vol_bps":vol,"breakout_bps":breakout,"probability":probability,
                "gross_edge_bps":max(0.0,gross),"vol_percentile":vol_pct,"funding_bps":funding,"basis_bps":basis,
                "obi":obi,"microprice_bps":micro,"family":family}

    @staticmethod
    def _impact_bps(ms,side,notional):
        depth=float(ms.depth_notional(side,10)); p=min(1.0,notional/max(depth,1.0))
        return max(.25,6.0*math.sqrt(p)+2.0*p)

    def _reject(self,symbol,reason,details=None):
        key=(symbol,reason); ts=now_ms()
        if ts-self._last_reject.get(key,0)<5000:return
        self._last_reject[key]=ts; ev={"ts":now_iso(),"ts_ms":ts,"symbol":symbol,"reason":reason,**(details or {})}
        self.rejections.append(ev); self.store.journal("PAPER_REJECT",symbol,ev)

    def _evaluate(self,symbol,ms):
        if symbol in self.positions:return
        age=now_ms()-int(ms.ts_book_ms or 0)
        if age>self.stale_ms:self._reject(symbol,f"Stale feed {age}ms > {self.stale_ms}ms"); return
        model=self._paper_model()
        if model is None:self._reject(symbol,"No verified PAPER model"); return
        feat=self._features(symbol,float(ms.mid),model)
        if feat is None:self._reject(symbol,"Insufficient live 1m feature history"); return
        if feat["side"] is None:self._reject(symbol,"No high-water/low-water breakout signal"); return
        if feat["probability"]<.55:self._reject(symbol,f"Probability {feat['probability']:.3f} < 0.550"); return
        stats=self.store.paper_stats(); equity=self.starting_equity+float(stats["realized_pnl_usd"])
        notional=max(50.0,equity*.05); spread=float(ms.spread_bps); fee=float(self.fee_rate_bps.get(symbol,5.5))
        impact=self._impact_bps(ms,feat["side"],notional); costs=2*fee+spread+impact; net=float(feat["gross_edge_bps"])-costs
        if not math.isfinite(net) or net<self.hurdle_bps:
            self._reject(symbol,f"Net edge {net:.1f} bps < {self.hurdle_bps:.1f} bps hurdle",
                {"gross_edge_bps":feat["gross_edge_bps"],"spread_bps":spread,"impact_bps":impact,"round_trip_fee_bps":2*fee}); return
        ref=float(ms.asks[0][0] if feat["side"]=="Buy" else ms.bids[0][0]); adv=impact/1e4
        fill=ref*(1+adv if feat["side"]=="Buy" else 1-adv); qty=notional/max(fill,1e-9)
        entry_fee=abs(fill*qty)*fee/1e4; slip=abs(fill/ref-1)*1e4
        tid=self.store.paper_open_trade(symbol,feat["side"],qty,fill,entry_fee,slip,model.model_id)
        self.store.paper_record_fill(tid,symbol,feat["side"],qty,ref,fill,slip,entry_fee,"entry",model.model_id)
        self.positions[symbol]=PaperPosition(tid,symbol,feat["side"],qty,fill,entry_fee,slip,now_ms(),model.model_id)
        self.store.journal("PAPER_ENTER",symbol,{"trade_id":tid,"side":feat["side"],"qty":qty,"fill_px":fill,
            "probability":feat["probability"],"gross_edge_bps":feat["gross_edge_bps"],"net_edge_bps":net,
            "spread_bps":spread,"impact_bps":impact,"model_id":model.model_id})

    def _maybe_exit(self,symbol):
        pos=self.positions.get(symbol); ms=self.markets.get(symbol)
        if pos is None or ms is None or not ms.bids or not ms.asks or now_ms()-pos.opened_ms<300000:return
        fee=float(self.fee_rate_bps.get(symbol,5.5)); exit_side="Sell" if pos.side=="Buy" else "Buy"
        ref=float(ms.bids[0][0] if exit_side=="Sell" else ms.asks[0][0]); impact=self._impact_bps(ms,exit_side,pos.qty*ref)
        fill=ref*(1-impact/1e4 if exit_side=="Sell" else 1+impact/1e4); exit_fee=abs(fill*pos.qty)*fee/1e4
        direction=1.0 if pos.side=="Buy" else -1.0; realized=(fill-pos.entry_px)*direction*pos.qty-pos.entry_fee_usd-exit_fee
        slip=abs(fill/ref-1)*1e4
        self.store.paper_record_fill(pos.trade_id,symbol,exit_side,pos.qty,ref,fill,slip,exit_fee,"time_exit",pos.model_id)
        self.store.paper_close_trade(pos.trade_id,fill,exit_fee,slip,realized)
        self.store.journal("PAPER_EXIT",symbol,{"trade_id":pos.trade_id,"exit_px":fill,"realized_pnl_usd":realized,
            "exit_slippage_bps":slip,"model_id":pos.model_id}); self.positions.pop(symbol,None)

    def snapshot(self):
        stats=self.store.paper_stats(); unreal=0.0; positions=[]
        for symbol,pos in self.positions.items():
            ms=self.markets.get(symbol); mark=float(ms.mid) if ms and ms.mid>0 else pos.entry_px
            d=1.0 if pos.side=="Buy" else -1.0; upnl=(mark-pos.entry_px)*d*pos.qty; unreal+=upnl
            positions.append({"symbol":symbol,"side":pos.side,"qty":pos.qty,"entry":pos.entry_px,"mark":mark,"upnl":upnl,"model_id":pos.model_id})
        realized=float(stats["realized_pnl_usd"])
        return {"enabled":True,"real_capital_execution":False,"starting_equity":self.starting_equity,
            "synthetic_equity":self.starting_equity+realized+unreal,"realized_pnl":realized,"unrealized_pnl":unreal,
            "active_positions":positions,"closed_trades":stats["closed_trades"],"wins":stats["wins"],"win_rate":stats["win_rate"],
            "realized_slippage_bps":stats["avg_slippage_bps"],"fills":stats["fills"],"rejections":list(self.rejections)[-30:],
            "model":getattr(self._paper_model(),"model_id",None)}
