"""Fail-closed optimizer boundary. No unverified optimizer can alter live risk."""
class AutonomousProfitOptimizer:
 def __init__(self,*args,**kwargs): self.enabled=False
 async def run(self,*args,**kwargs): return {'status':'fail_closed','enabled':False}
