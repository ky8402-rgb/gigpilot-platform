import { SystemUpdate } from './types.js';
import crypto from 'crypto';

export class SelfUpdaterManager {
  private updatesHistory: SystemUpdate[] = [];

  public getUpdatesHistory(): SystemUpdate[] {
    return [...this.updatesHistory];
  }

  public triggerCanaryRollout(version: string, notes: string): SystemUpdate {
    const sha256 = crypto.createHash('sha256').update(version + Date.now()).digest('hex');
    const update: SystemUpdate = {
      version,
      discoveredAt: new Date().toISOString(),
      integrityVerified: true,
      sha256,
      automatedTestsPassed: false,
      securityTestsPassed: false,
      validationPassed: false,
      canaryStatus: 'CANARY_10PCT',
      rollbackPoint: this.updatesHistory[0]?.version || 'NONE',
      notes
    };
    this.updatesHistory.unshift(update);
    return update;
  }

  public promoteToFullDeployment(version: string): SystemUpdate | null {
    const target = this.updatesHistory.find(u => u.version === version);
    if (!target || !target.integrityVerified || !target.automatedTestsPassed || !target.securityTestsPassed || !target.validationPassed) return null;
    target.canaryStatus = 'FULL_DEPLOYMENT';
    target.deployedAt = new Date().toISOString();
    return target;
  }

  public triggerRollback(version: string, reason: string): SystemUpdate | null {
    const target = this.updatesHistory.find(u => u.version === version);
    if (!target) return null;
    target.canaryStatus = 'ROLLED_BACK';
    target.notes += ` [ROLLED BACK: ${reason}]`;
    return target;
  }
}
