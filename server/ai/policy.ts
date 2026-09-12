import { ToolMetadata, RiskLevel } from '../tools/toolDefinitions.js';
import { ToolPermission, RemediationPolicy } from './schemas.js';
import { auditStore } from './auditStore.js';

export interface PolicyCheckResult {
  allowed: boolean;
  maxRiskLevel: RiskLevel;
  maxRiskPermission: ToolPermission;
  requiresConfirmation: boolean;
  blockedReason?: string;
  evaluatedTools: Array<{
    toolName: string;
    riskLevel: RiskLevel;
    permission: ToolPermission;
    requiresConfirmation: boolean;
    allowed: boolean;
    reason?: string;
  }>;
}

// Banned adversarial or dangerous execution patterns
const BANNED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /drop\s+table/i, reason: 'Arbitrary table drops are strictly forbidden.' },
  { pattern: /drop\s+database/i, reason: 'Database deletion is strictly forbidden.' },
  { pattern: /delete\s+.*database/i, reason: 'Database deletion is strictly forbidden.' },
  { pattern: /truncate\s+table/i, reason: 'Table truncation is strictly forbidden.' },
  { pattern: /delete\s+from\s+users/i, reason: 'Mass deletion of users is strictly forbidden.' },
  { pattern: /delete\s+all\s+users/i, reason: 'Mass deletion of users is strictly forbidden.' },
  { pattern: /rm\s+-rf/i, reason: 'Destructive filesystem manipulation is forbidden.' },
  { pattern: /format\s+disk/i, reason: 'Disk formatting is forbidden.' },
  { pattern: /give\s+me\s+.*(token|key|secret|credential|password|api)/i, reason: 'Credential extraction is strictly blocked by security policy.' },
  { pattern: /show\s+.*(token|key|secret|credential|password|api)/i, reason: 'Credential extraction is strictly blocked by security policy.' },
  { pattern: /get\s+.*(token|key|secret|credential|password)/i, reason: 'Credential extraction is strictly blocked by security policy.' },
  { pattern: /ignore\s+(all\s+)?(your\s+)?(permissions|instructions|rules)/i, reason: 'Adversarial prompt injection attempting to bypass policy engine is blocked.' },
  { pattern: /bypass\s+(all\s+)?(permissions|policies|safety)/i, reason: 'Policy bypass attempt is strictly forbidden.' },
  { pattern: /run\s+arbitrary\s+sql/i, reason: 'Unrestricted arbitrary SQL execution is prohibited.' },
  { pattern: /exec(ute)?\s+arbitrary/i, reason: 'Arbitrary shell or query execution is prohibited.' },
  { pattern: /select\s+.*\s+from\s+users.*password/i, reason: 'Password table dump attempt blocked.' },
];

export class PolicyEngine {
  private defaultPolicy: RemediationPolicy = {
    id: 'default_remediation_policy',
    name: 'Standard Autonomous Remediation Guardrails',
    targetComponent: 'global',
    maxAutoRiskLevel: 'MEDIUM',
    requireConfirmationFor: ['HIGH', 'CRITICAL'],
    allowedTools: [],
    blockedTools: ['delete_all_users', 'drop_database', 'arbitrary_sql'],
    maxRetriesPerStep: 2,
    executionTimeoutMs: 60000,
  };

  /**
   * Evaluates ordered tools against permissions and risk policies
   */
  public evaluatePlan(
    tools: Array<{ name: string; riskLevel: RiskLevel; requiresConfirmation: boolean; permission?: ToolPermission }>,
    userConfirmed = false,
    actor = 'user'
  ): PolicyCheckResult {
    let maxRiskLevel: RiskLevel = 0;
    let needsConfirmation = false;
    const evaluated: PolicyCheckResult['evaluatedTools'] = [];

    for (const tool of tools) {
      if (tool.riskLevel > maxRiskLevel) {
        maxRiskLevel = tool.riskLevel;
      }

      const permission: ToolPermission =
        tool.permission ||
        (tool.riskLevel === 0
          ? 'READ_ONLY'
          : tool.riskLevel === 1
          ? 'LOW'
          : tool.riskLevel === 2
          ? 'MEDIUM'
          : tool.riskLevel === 3
          ? 'HIGH'
          : 'CRITICAL');

      // 1. Critical operations (Level 4): Always blocked for autonomous agent
      if (tool.riskLevel >= 4 || permission === 'CRITICAL') {
        evaluated.push({
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          permission,
          requiresConfirmation: true,
          allowed: false,
          reason: `Tool [${tool.name}] is classified as CRITICAL and is prohibited from automated execution.`,
        });
        continue;
      }

      // 2. High-Risk operations (Level 3 / HIGH): Require explicit user confirmation
      if (tool.riskLevel === 3 || permission === 'HIGH') {
        if (!userConfirmed) {
          needsConfirmation = true;
          evaluated.push({
            toolName: tool.name,
            riskLevel: 3,
            permission: 'HIGH',
            requiresConfirmation: true,
            allowed: false,
            reason: `Tool [${tool.name}] requires explicit Level 3 authorization before execution.`,
          });
          continue;
        }
      }

      // 3. Medium-Risk operations (Level 2 / MEDIUM): Require confirmation if explicitly configured
      if ((tool.riskLevel === 2 || permission === 'MEDIUM') && tool.requiresConfirmation && !userConfirmed) {
        needsConfirmation = true;
        evaluated.push({
          toolName: tool.name,
          riskLevel: 2,
          permission: 'MEDIUM',
          requiresConfirmation: true,
          allowed: false,
          reason: `Tool [${tool.name}] has confirmation flag set and requires approval.`,
        });
        continue;
      }

      // Allowed step
      evaluated.push({
        toolName: tool.name,
        riskLevel: tool.riskLevel,
        permission,
        requiresConfirmation: tool.requiresConfirmation,
        allowed: true,
      });
    }

    const hasBlockedTool = evaluated.some((e) => !e.allowed);
    const maxRiskPermission: ToolPermission =
      maxRiskLevel === 0 ? 'READ_ONLY' : maxRiskLevel === 1 ? 'LOW' : maxRiskLevel === 2 ? 'MEDIUM' : maxRiskLevel === 3 ? 'HIGH' : 'CRITICAL';

    const blockedItems = evaluated.filter((e) => !e.allowed);
    const blockedReason = blockedItems.length > 0
      ? blockedItems.map((b) => b.reason || `Tool [${b.toolName}] authorization required`).join('; ')
      : undefined;

    return {
      allowed: !hasBlockedTool,
      maxRiskLevel,
      maxRiskPermission,
      requiresConfirmation: needsConfirmation,
      blockedReason,
      evaluatedTools: evaluated,
    };
  }

  /**
   * Validates raw user requests against prompt injections and destructive attacks
   */
  public checkRawCommandSafety(commandText: string, actor = 'user'): { safe: boolean; reason?: string } {
    for (const item of BANNED_PATTERNS) {
      if (item.pattern.test(commandText)) {
        auditStore.log({
          eventType: 'SECURITY_VIOLATION_BLOCKED',
          actor,
          status: 'BLOCKED',
          risk: 'CRITICAL',
          resource: 'policy_engine',
          metadata: {
            command: commandText.slice(0, 120),
            reason: item.reason,
            violationPattern: item.pattern.toString(),
          },
        });

        return {
          safe: false,
          reason: item.reason,
        };
      }
    }

    return { safe: true };
  }
}

export const policyEngine = new PolicyEngine();
