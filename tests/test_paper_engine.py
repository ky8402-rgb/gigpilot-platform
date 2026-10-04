import inspect
from gpkg.market.state import MarketState
from gpkg.paper.engine import PaperTradingEngine
from gpkg.persistence.store import Store
class EmptyRegistry:
    def list(self): return []
def test_paper_engine_has_no_live_exchange_execution_dependency(tmp_path):
    import gpkg.paper.engine as mod
    src=inspect.getsource(mod)
    for token in ("BybitREST","BybitAdapter","Executor","place_order","open_protected","close_market","api.bybit.com"): assert token not in src
    store=Store(str(tmp_path/"paper.db")); m=MarketState("BTCUSDT"); m.apply_book_snapshot([["100","10"]],[["101","10"]])
    e=PaperTradingEngine(store,EmptyRegistry(),{"BTCUSDT":m},{"BTCUSDT":5.5}); e.warmup(); e.on_book("BTCUSDT",m)
    s=e.snapshot(); assert s["real_capital_execution"] is False; assert s["active_positions"]==[]
def test_paper_rejection_is_auditable(tmp_path):
    store=Store(str(tmp_path/"paper.db")); m=MarketState("BTCUSDT"); m.apply_book_snapshot([["100","10"]],[["101","10"]])
    e=PaperTradingEngine(store,EmptyRegistry(),{"BTCUSDT":m},{"BTCUSDT":5.5}); e.warmup(); e.on_book("BTCUSDT",m)
    assert e.snapshot()["rejections"][-1]["reason"]=="No verified PAPER model"
