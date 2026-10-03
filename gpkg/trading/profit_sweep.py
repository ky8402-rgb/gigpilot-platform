"""Withdrawal/profit sweep is fail-closed until owner-approved Python parity is independently verified."""
class ProfitSweepEngine:
 def __init__(self,*args,**kwargs): self.enabled=False
 async def execute(self,*args,**kwargs): return {'success':False,'reason':'disabled_fail_closed'}
