"""Exchange-verified accounting boundary."""
from gpkg.persistence.store import Store
class ProfitAccountingEngine:
 def __init__(self,*args,**kwargs): self.store=kwargs.get('store') or (args[0] if args else None)
