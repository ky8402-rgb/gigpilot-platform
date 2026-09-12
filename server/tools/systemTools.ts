import { ToolMetadata, ToolExecutionResult } from './toolDefinitions.js';
import { invalidateCache } from '../redisCache.js';
import { eventBus } from '../events/eventBus.js';

export const clearCacheTool: ToolMetadata = {
  name: 'clearCache',
  description: 'Flush in-memory and Redis caches and trigger V8 garbage collection',
  category: 'system',
  riskLevel: 1,
  riskName: 'Safe remediation',
  requiresConfirmation: false,
  parameters: {},
  execute: async (_args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('🧹 Flushing Redis cache keys and in-memory caches...');
    await invalidateCache('all');
    if (global.gc) {
      log('🧹 Triggering explicit V8 garbage collection...');
      global.gc();
    }
    log('✓ System memory cache cleared.');

    eventBus.emitEvent({
      type: 'CACHE_CLEARED',
      component: 'automated_self_healing',
      status: 'HEALTHY',
      action_applied: 'clear_cache',
      refresh_target: ['health_status'],
    });

    return {
      success: true,
      toolName: 'clearCache',
      summary: 'System cache cleared and garbage collection executed',
      logs,
      stateMutated: true,
      affectedComponent: 'automated_self_healing',
      refreshTargets: ['health_status'],
    };
  },
};
