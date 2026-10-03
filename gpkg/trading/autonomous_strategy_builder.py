"""Strategy builder boundary; promotion is intentionally fail-closed until evidence is verified."""
class AutonomousStrategyBuilder:
 def __init__(self,*args,**kwargs): pass
 async def build(self,*args,**kwargs): return {'status':'fail_closed','promotable':False}
