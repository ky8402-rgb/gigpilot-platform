"""Exchange-verified accounting boundary."""
from gpkg.persistence.store import Store

# Re-export shim: `Store` is part of this module's public surface, not a local dependency.
__all__ = ["ProfitAccountingEngine", "Store"]
class ProfitAccountingEngine:
 def __init__(self,*args,**kwargs): self.store=kwargs.get('store') or (args[0] if args else None)
