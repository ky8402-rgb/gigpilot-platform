import { ToolMetadata, ToolExecutionResult, RiskLevel } from './toolDefinitions.js';
import {
  diagnoseFreelancerTool,
  restartScraperTool,
  syncFreelancerJobsTool,
  verifySyncTool,
} from './freelancerTools.js';
import {
  verifyPostgresTool,
  reconnectDatabaseTool,
  reseedDataTool,
  createDatabaseSnapshotTool,
} from './databaseTools.js';
import {
  inspectQueueTool,
  retryFailedJobsTool,
  restartWorkersTool,
} from './queueTools.js';
import {
  findOverdueOrdersTool,
  updateWorkOrderPriorityTool,
  healWorkOrdersTool,
  verifyWorkOrdersTool,
} from './workOrderTools.js';
import {
  verifyPayPalGatewayTool,
  reconcileBalancesTool,
  retryPendingPayoutsTool,
} from './paypalTools.js';
import { clearCacheTool } from './systemTools.js';
import {
  retrainModelTool,
  evaluateModelTool,
  rollbackModelTool,
  runHealthCheckTool,
  createIncidentTool,
} from './mlopsTools.js';

export * from './toolDefinitions.js';

const TOOLS: ToolMetadata[] = [
  diagnoseFreelancerTool,
  restartScraperTool,
  syncFreelancerJobsTool,
  verifySyncTool,
  verifyPostgresTool,
  reconnectDatabaseTool,
  reseedDataTool,
  createDatabaseSnapshotTool,
  inspectQueueTool,
  retryFailedJobsTool,
  restartWorkersTool,
  findOverdueOrdersTool,
  updateWorkOrderPriorityTool,
  healWorkOrdersTool,
  verifyWorkOrdersTool,
  verifyPayPalGatewayTool,
  reconcileBalancesTool,
  retryPendingPayoutsTool,
  clearCacheTool,
  retrainModelTool,
  evaluateModelTool,
  rollbackModelTool,
  runHealthCheckTool,
  createIncidentTool,
];

// Alias mapping for flexible snake_case and common aliases
const TOOL_ALIASES: Record<string, string> = {
  // Database
  verify_postgres: 'verifypostgres',
  verifypostgres: 'verifypostgres',
  reconnect_database: 'reconnectdatabase',
  reseed_data: 'reseeddata',
  create_database_snapshot: 'createdatabasesnapshot',

  // Queues & Redis
  verify_redis: 'inspectqueue',
  inspect_queue: 'inspectqueue',
  retry_failed_jobs: 'retryfailedjobs',
  restart_workers: 'restartworkers',

  // Freelancer & Scraper
  verify_freelancer_api: 'diagnosefreelancer',
  diagnose_freelancer: 'diagnosefreelancer',
  restart_scraper: 'restartscraper',
  sync_freelancer_jobs: 'syncfreelancerjobs',
  sync_jobs: 'syncfreelancerjobs',
  verify_sync: 'verifysync',

  // Work orders
  find_overdue_orders: 'findoverdueorders',
  update_work_order: 'updateworkorderpriority',
  update_work_order_priority: 'updateworkorderpriority',
  heal_work_orders: 'healworkorders',
  verify_work_order: 'verifyworkorders',
  verify_work_orders: 'verifyworkorders',

  // PayPal
  verify_paypal_api: 'verifypaypalgateway',
  verify_paypal_gateway: 'verifypaypalgateway',
  reconcile_balances: 'reconcilebalances',
  retry_pending_payouts: 'retrypendingpayouts',
  get_transaction_status: 'verifypaypalgateway',

  // System & Cache
  clear_cache: 'clearcache',
  flush_cache: 'clearcache',

  // MLOps & Telemetry
  retrain_model: 'retrain_model',
  evaluate_model: 'evaluate_model',
  rollback_model: 'rollback_model',
  run_health_check: 'run_health_check',
  get_telemetry: 'run_health_check',
  create_incident: 'create_incident',
  resolve_incident: 'create_incident',
};

export const toolRegistryMap: Map<string, ToolMetadata> = new Map();

for (const t of TOOLS) {
  // register primary lowercase name
  toolRegistryMap.set(t.name.toLowerCase(), t);
  // register stripped alphanumeric name (e.g. "retrain_model" -> "retrainmodel")
  toolRegistryMap.set(t.name.toLowerCase().replace(/_/g, ''), t);
}

export function getRegisteredTool(name: string): ToolMetadata | undefined {
  if (!name) return undefined;
  const normalized = name.toLowerCase().trim();

  // Check alias lookup
  if (TOOL_ALIASES[normalized]) {
    const aliasTarget = TOOL_ALIASES[normalized];
    const tool = toolRegistryMap.get(aliasTarget);
    if (tool) return tool;
  }

  // Check direct lookup
  let tool = toolRegistryMap.get(normalized);
  if (tool) return tool;

  // Check stripped lookup
  tool = toolRegistryMap.get(normalized.replace(/_/g, ''));
  if (tool) return tool;

  return undefined;
}

export const getToolByName = getRegisteredTool;

export function getAllRegisteredTools(): ToolMetadata[] {
  return [...TOOLS];
}

export function getToolsSummaryForAI(): Array<{
  name: string;
  description: string;
  category: string;
  riskLevel: RiskLevel;
  riskName: string;
  parameters: any;
}> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    riskLevel: t.riskLevel,
    riskName: t.riskName,
    parameters: t.parameters,
  }));
}
