export interface KillSwitchState {
  isActive: boolean;
  triggeredAt?: string;
  triggeredBy: 'OWNER' | 'RISK_ENGINE' | 'ANOMALY_DETECTOR';
  reason?: string;
  ordersCancelledCount: number;
  positionsLiquidated: boolean;
}

export class EmergencyKillSwitch {
  private state: KillSwitchState = {
    isActive: false,
    triggeredBy: 'OWNER',
    ordersCancelledCount: 0,
    positionsLiquidated: false
  };

  public getState(): KillSwitchState {
    return { ...this.state };
  }

  public trigger(reason = 'Emergency kill switch triggered'): KillSwitchState {
    return this.activate('OWNER', reason);
  }

  public activate(
    triggeredBy: KillSwitchState['triggeredBy'],
    reason: string,
    ordersCancelledCount = 0,
    positionsLiquidated = false
  ): KillSwitchState {
    this.state = {
      isActive: true,
      triggeredAt: new Date().toISOString(),
      triggeredBy,
      reason,
      ordersCancelledCount,
      positionsLiquidated
    };
    return this.getState();
  }

  public deactivate(): KillSwitchState {
    this.state = {
      isActive: false,
      triggeredBy: 'OWNER',
      ordersCancelledCount: 0,
      positionsLiquidated: false
    };
    return this.getState();
  }
}
