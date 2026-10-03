"""Persistent kill-switch boundary delegated to the engine."""
class EmergencyKillSwitch:
 def __init__(self,gp): self.gp=gp
 def trigger(self): self.gp.kill(); return True
