"""Indicator boundary uses live MarketState calculations."""
def calculateATR(state,*args,**kwargs): return state.atr_bps(*args,**kwargs)
def calculateOrderBookImbalance(state,*args,**kwargs): return state.imbalance(*args,**kwargs)
def computeAllIndicators(state,*args,**kwargs): return {'atr_bps':calculateATR(
    state,*args,**kwargs),'imbalance':calculateOrderBookImbalance(state,*args,**kwargs)}
