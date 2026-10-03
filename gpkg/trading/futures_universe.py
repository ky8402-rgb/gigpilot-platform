"""Linear futures universe boundary."""
async def discoverFuturesUniverse(rest,*args,**kwargs):
 return [{'symbol':s} for s in getattr(rest.cfg,'symbols',[])]
async def futuresUniverseHandler(*args,**kwargs): return await discoverFuturesUniverse(*args,**kwargs)
