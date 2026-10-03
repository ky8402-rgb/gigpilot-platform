class StrategyEvaluator:
    def evaluate(self,*args,**kwargs): return {'promotable':False,'status':'fail_closed'}
globalStrategyEvaluator=StrategyEvaluator()
