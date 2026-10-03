"""Legacy grid subsystem is disabled; autonomous futures edge execution is authoritative."""
class GridEngine:
 def __init__(self,*args,**kwargs): self.enabled=False
 def configure(self,*args,**kwargs): return {'enabled':False,'reason':'autonomous futures-only mode'}
