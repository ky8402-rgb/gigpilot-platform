import { ToolPermission } from '../ai/schemas.js';

/**
 * AI Tool Registry Definitions & Risk Policies
 */

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export interface ToolMetadata {
  name: string;
  description: string;
  version?: string;
  category: 'freelancer' | 'database' | 'queues' | 'work_orders' | 'paypal' | 'system' | 'mlops';
  riskLevel: RiskLevel;
  riskName: 'Read' | 'Safe remediation' | 'Important writes' | 'Dangerous' | 'Critical';
  permission?: ToolPermission;
  requiresConfirmation: boolean;
  timeout?: number; // ms
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    exponential?: boolean;
  };
  idempotency?: boolean;
  productionAvailability?: boolean;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    default?: any;
  }>;
  execute: (args: Record<string, any>, onProgress?: (msg: string) => void) => Promise<ToolExecutionResult>;
}

export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  summary: string;
  logs: string[];
  data?: any;
  stateMutated?: boolean;
  affectedComponent?: string;
  refreshTargets?: string[];
  executionDurationMs?: number;
}
