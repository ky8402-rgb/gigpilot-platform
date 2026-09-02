import { getGeminiAI } from './gemini.js';
import { logActivityEvent } from './activityLogger.js';

export interface SupportTicket {
  id: string;
  category: 'PAYPAL_PAYOUT_ERROR' | 'STUCK_WORK_ORDER' | 'DATABASE_ANOMALY' | 'GENERAL_SUPPORT';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  context: any;
  aiAnalysis: string;
  recommendedActions: string[];
  autoHealed: boolean;
  timestamp: string;
}

export const activeSupportTickets: SupportTicket[] = [];

/**
 * Triggers AI Support Chat / Diagnostic analysis via Gemini
 */
export async function triggerAISupportIncident(params: {
  category: 'PAYPAL_PAYOUT_ERROR' | 'STUCK_WORK_ORDER' | 'DATABASE_ANOMALY' | 'GENERAL_SUPPORT';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  errorMessage?: string;
  context?: any;
}): Promise<SupportTicket> {
  const ticketId = `TICK-${Date.now().toString().slice(-6)}`;
  const severity = params.severity || 'medium';
  const gemini = getGeminiAI();

  let aiAnalysis = 'Automated system diagnostic initiated. Evaluating PayPal webhook/payout retry queue and worker status.';
  let recommendedActions = [
    'Verify PayPal Sandbox/Live credentials and business account payout balance',
    'Confirm recipient worker PayPal email address validity',
    'Review exponential backoff retry logs in system activity stream',
  ];

  if (gemini) {
    try {
      const prompt = `You are an Autonomous AI DevOps & Payment Gateway Support Assistant for an automated freelancer dispatch and PayPal revenue withdrawal platform.

Incident Details:
- Category: ${params.category}
- Severity: ${severity}
- Title: ${params.title}
- Error: ${params.errorMessage || 'Unknown failure'}
- Context: ${JSON.stringify(params.context || {})}

Provide a concise response in valid JSON with two fields:
{
  "analysis": "1-2 sentence root cause diagnostic and risk assessment",
  "recommendedActions": ["step 1", "step 2", "step 3"]
}`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text);
        if (parsed.analysis) aiAnalysis = parsed.analysis;
        if (Array.isArray(parsed.recommendedActions)) recommendedActions = parsed.recommendedActions;
      }
    } catch (err: any) {
      console.warn('⚠️ [AISupport] Gemini AI incident analysis notice, using deterministic diagnostics:', err.message);
    }
  }

  const ticket: SupportTicket = {
    id: ticketId,
    category: params.category,
    severity,
    title: params.title,
    context: params.context || {},
    aiAnalysis,
    recommendedActions,
    autoHealed: false,
    timestamp: new Date().toISOString(),
  };

  activeSupportTickets.unshift(ticket);
  if (activeSupportTickets.length > 50) {
    activeSupportTickets.pop();
  }

  logActivityEvent({
    source: 'Gemini',
    type: 'AI_SUPPORT_ESCALATION',
    status: severity === 'critical' || severity === 'high' ? 'warning' : 'info',
    summary: `[AI Support Ticket ${ticketId}] ${params.title} - Severity: ${severity.toUpperCase()}`,
    tags: ['ai_support', params.category.toLowerCase(), severity],
  });

  return ticket;
}

/**
 * Interactive AI Chat endpoint helper for users asking questions about bids, work orders, payouts, and self-healing
 */
export async function queryAISupportChat(userMessage: string, history: Array<{ role: string; content: string }> = []): Promise<{
  reply: string;
  suggestedActions: string[];
  timestamp: string;
}> {
  const gemini = getGeminiAI();

  if (!gemini) {
    return {
      reply: `AI Support Engine: Your query "${userMessage}" has been received. PayPal self-healing retry engine is operating normally. If a worker payout is pending, the system executes up to 3 automatic retries with exponential backoff before notification escalation.`,
      suggestedActions: [
        'Check /api/health/self-healing for system status',
        'Review active work orders at /api/work-orders',
        'Inspect transactions at /api/transactions',
      ],
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const prompt = `You are the AI Support Specialist for GigPilot (an autonomous Freelancer Job Dispatch, Work Order Auto-Completion, and PayPal Payouts Platform).
User question: "${userMessage}"
Conversation history: ${JSON.stringify(history)}

Explain clearly how auto-dispatch, auto-completion, PayPal Payouts, and the self-healing retry mechanism work. Provide actionable next steps.`;

    const response = await gemini.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
    });

    return {
      reply: response.text || 'I am monitoring your autonomous dispatch and PayPal payouts pipeline. All services are active.',
      suggestedActions: [
        'View /api/work-orders for real-time progress',
        'Check /api/health/self-healing for diagnostics',
        'Trigger instant retry via /api/retry/trigger',
      ],
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      reply: `AI Support: ${err.message}. The system is running self-healing background checks every 30 seconds.`,
      suggestedActions: ['Inspect activity logs', 'Verify PayPal API token'],
      timestamp: new Date().toISOString(),
    };
  }
}
