class AutonomousResearchAgent:
    def __init__(self,*args,**kwargs): self.enabled=False
    async def analyze(self,*args,**kwargs): return {'status':'fail_closed','advisory_only':True}
