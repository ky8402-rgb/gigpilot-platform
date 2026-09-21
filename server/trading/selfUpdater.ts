import { SystemUpdate } from './types.js';
import crypto from 'crypto';

export class SelfUpdaterManager {
  private updatesHistory: SystemUpdate[] = [];

  constructor() {
    // Do not seed the production UI with synthetic deployment history.
    // Real updates are recorded only after an actual validation pipeline.
    this.updatesHistory = [];
  }

  public getUpdatesHistory(): SystemUpdate[] {
    return [...this.updatesHistory];
  }

  public triggerCanaryRollout(version: string, notes: string): SystemUpdate {
    if (!version || !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error('Invalid update version.');
    }

    const update: SystemUpdate = {
      version,
      discoveredAt: new Date().toISOString(),
      integrityVerified: false,
      sha256: '',
      automatedTestsPassed: false,
      securityTestsPassed: false,
      backtestPassed: false,
      canaryStatus: 'STAGING',
      rollbackPoint: this.updatesHistory[0]?.version || 'NONE',
      notes: `${notes} Validation required before any deployment promotion.`
    };
    this.updatesHistory.unshift(update);
    return update;
  }

  public promoteToFullDeployment(version: string): SystemUpdate | null {
    const target = this.updatesHistory.find(u => u.version === version);
    if (!target) return null;
    if (!target.integrityVerified || !target.automatedTestsPassed || !target.securityTestsPassed || !target.backtestPassed) {
      throw new Error('Update cannot be promoted: integrity, automated tests, security tests, and backtest must all be verified by the real validation pipeline.');
    }
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
