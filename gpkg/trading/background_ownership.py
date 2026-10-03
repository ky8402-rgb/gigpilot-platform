"""Single Python process owns all background loops."""
BACKGROUND_LOOPS_ENV_FLAG='GIGPILOT_DISABLE_BACKGROUND_LOOPS'
def ownsBackgroundLoops(): return True
def backgroundLoopsDisabledReason(): return None
globalTradingStore=None
