import { EventEmitter } from 'events';

export interface SystemEvent {
  id: string;
  type: string;
  timestamp: string;
  component: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'RECOVERING' | 'INFO';
  action_applied?: string;
  details?: Record<string, any>;
  refresh_target?: string[];
}

class SystemEventBus extends EventEmitter {
  private recentEvents: SystemEvent[] = [];
  private readonly maxRecent = 100;
  private sseClients: Set<(event: SystemEvent) => void> = new Set();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Emit a deterministic state-mutation or system event to all subscribers and SSE clients
   */
  public emitEvent(event: Omit<SystemEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): SystemEvent {
    const fullEvent: SystemEvent = {
      id: event.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: event.timestamp || new Date().toISOString(),
      type: event.type,
      component: event.component,
      status: event.status,
      action_applied: event.action_applied,
      details: event.details,
      refresh_target: event.refresh_target || ['health_status', 'dashboard_metrics']
    };

    this.recentEvents.unshift(fullEvent);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.pop();
    }

    // Emit on internal EventEmitter
    this.emit('system_event', fullEvent);
    this.emit(`component:${fullEvent.component}`, fullEvent);

    // Broadcast to SSE clients
    for (const client of this.sseClients) {
      try {
        client(fullEvent);
      } catch (err) {
        this.sseClients.delete(client);
      }
    }

    return fullEvent;
  }

  public registerSseClient(callback: (event: SystemEvent) => void): () => void {
    this.sseClients.add(callback);
    return () => {
      this.sseClients.delete(callback);
    };
  }

  public getRecentEvents(limit = 30): SystemEvent[] {
    return this.recentEvents.slice(0, limit);
  }
}

export const eventBus = new SystemEventBus();
