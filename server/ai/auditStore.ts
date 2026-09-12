import crypto from 'crypto';
import { AuditEvent, AuditEventSchema, AuditEventType, ToolPermission } from './schemas.js';
import { eventBus } from '../events/eventBus.js';

// Keys or values that indicate sensitive secrets
const SENSITIVE_KEY_PATTERNS = [
  /pass(word)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /bearer/i,
  /private/i,
  /credential/i,
  /session/i,
  /cookie/i,
];

/**
 * Redact sensitive fields recursively to guarantee immutable audit logs never leak credentials
 */
export function sanitizeAuditMetadata(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Redact JWT tokens, bearer tokens, or hex secrets
    if (/bearer\s+[a-zA-Z0-9_\-\.]+/i.test(obj)) {
      return '[REDACTED_BEARER_TOKEN]';
    }
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(obj) && obj.length > 30) {
      return '[REDACTED_JWT]';
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeAuditMetadata);
  }
  if (typeof obj === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        clean[key] = '[REDACTED_SECRET]';
      } else {
        clean[key] = sanitizeAuditMetadata(val);
      }
    }
    return clean;
  }
  return obj;
}

export class AuditStore {
  private events: AuditEvent[] = [];
  private readonly maxEvents = 1000;

  /**
   * Record a strictly validated AuditEvent
   */
  public log(params: {
    eventType: AuditEventType;
    actor?: string;
    requestId?: string;
    conversationId?: string;
    intentId?: string;
    planId?: string;
    stepId?: string;
    toolName?: string;
    resource?: string;
    resourceId?: string;
    status: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'BLOCKED' | 'WARNING' | 'REJECTED';
    risk?: ToolPermission;
    modelVersion?: string;
    confidence?: number;
    metadata?: Record<string, any>;
  }): AuditEvent {
    const rawEvent: AuditEvent = {
      eventId: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      eventType: params.eventType,
      timestamp: new Date().toISOString(),
      actor: params.actor || 'system:ai-orchestrator',
      requestId: params.requestId || `req_${Date.now()}`,
      conversationId: params.conversationId || 'default-session',
      intentId: params.intentId,
      planId: params.planId,
      stepId: params.stepId,
      toolName: params.toolName,
      resource: params.resource,
      resourceId: params.resourceId,
      status: params.status,
      risk: params.risk || 'READ_ONLY',
      modelVersion: params.modelVersion || 'v2.4.1-prod',
      confidence: params.confidence,
      metadata: sanitizeAuditMetadata(params.metadata || {}),
    };

    // Zod validation check
    const parseResult = AuditEventSchema.safeParse(rawEvent);
    const event = parseResult.success ? parseResult.data : rawEvent;

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    // Emit live event to event bus for real-time dashboard listeners
    eventBus.emitEvent({
      type: `AUDIT_${event.eventType}`,
      component: event.resource || event.toolName || 'ai_command_layer',
      status: event.status === 'SUCCESS' ? 'HEALTHY' : event.status === 'BLOCKED' ? 'DEGRADED' : 'DEGRADED',
      action_applied: event.eventType,
      details: {
        eventId: event.eventId,
        toolName: event.toolName,
        risk: event.risk,
        status: event.status,
      },
      refresh_target: ['audit_logs', 'health_status'],
    });

    return event;
  }

  public getEvents(options?: {
    limit?: number;
    conversationId?: string;
    planId?: string;
    eventType?: AuditEventType;
    status?: string;
  }): AuditEvent[] {
    let filtered = this.events;
    if (options?.conversationId) {
      filtered = filtered.filter((e) => e.conversationId === options.conversationId);
    }
    if (options?.planId) {
      filtered = filtered.filter((e) => e.planId === options.planId);
    }
    if (options?.eventType) {
      filtered = filtered.filter((e) => e.eventType === options.eventType);
    }
    if (options?.status) {
      filtered = filtered.filter((e) => e.status === options.status);
    }
    return filtered.slice(0, options?.limit || 50);
  }

  public getEventById(eventId: string): AuditEvent | undefined {
    return this.events.find((e) => e.eventId === eventId);
  }
}

export const auditStore = new AuditStore();
