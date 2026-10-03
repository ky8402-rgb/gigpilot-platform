async def assessTradingReadiness(gp):
    ok,reasons=await gp.arm_preflight(); return {'ready':ok,'reasons':reasons}
class TradingReadiness: pass
