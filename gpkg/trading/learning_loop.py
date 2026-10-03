"""Learning is observational only until independently verified evidence supports promotion."""
class LearningLoopEngine:
 def __init__(self,*args,**kwargs): self.enabled=False
 async def run(self,*args,**kwargs): return {'status':'observational','promotion_allowed':False}
