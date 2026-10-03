"""Market-regime classifier boundary; unknown is fail-closed."""
def detectMarketRegime(*args,**kwargs): return {'regime':'unknown','tradable':False}
