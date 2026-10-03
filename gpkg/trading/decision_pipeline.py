"""Decision boundary: verified edge first, hard risk second."""
from gpkg.strategy.edge import EdgeEngine
from gpkg.risk.gate import RiskGate
class DecisionPipelineEngine:
 def __init__(self,cfg): self.edge=EdgeEngine(cfg); self.risk=RiskGate(cfg)
