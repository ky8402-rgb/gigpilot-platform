import { generateContentResilient, getGeminiAI } from './gemini.js';
import { logActivityEvent } from './activityLogger.js';

export interface ClientMessage {
  id: string;
  sender: 'client' | 'freelancer' | 'ai_assistant';
  senderName: string;
  text: string;
  timestamp: string;
  actionPayload?: {
    type: 'payment_request' | 'deliverable_link' | 'proposal' | 'milestone_release';
    amount?: number;
    link?: string;
    label?: string;
  };
}

export interface ClientConversation {
  id: string;
  clientId: string;
  clientName: string;
  clientAvatar?: string;
  clientCompany?: string;
  platform: 'Freelancer' | 'RemoteOK' | 'Direct' | 'Upwork';
  projectTitle: string;
  projectBudget?: number;
  unreadCount: number;
  lastMessageAt: string;
  status: 'active' | 'in_negotiation' | 'work_in_progress' | 'completed';
  autoResponderActive: boolean;
  messages: ClientMessage[];
}

// In-memory conversation store with realistic initial client threads
const conversations = new Map<string, ClientConversation>();

function initializeDefaultConversations() {
  if (conversations.size > 0) return;

  const now = new Date();

  // 1. Alex Chen - Fintech Payment Integration
  conversations.set('conv_alex_chen', {
    id: 'conv_alex_chen',
    clientId: 'client_alex_chen',
    clientName: 'Alex Chen',
    clientAvatar: 'AC',
    clientCompany: 'Apex Fintech Global',
    platform: 'Freelancer',
    projectTitle: 'Automated Stripe & PayPal Webhook Handler with HMAC SHA-256',
    projectBudget: 450,
    unreadCount: 1,
    lastMessageAt: new Date(now.getTime() - 1000 * 60 * 12).toISOString(),
    status: 'work_in_progress',
    autoResponderActive: true,
    messages: [
      {
        id: 'msg_1',
        sender: 'client',
        senderName: 'Alex Chen',
        text: 'Hi Kundan! We reviewed your proposal for the payment webhook engine. Can you confirm if you will be handling replay-attack prevention and idempotency keys?',
        timestamp: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
      },
      {
        id: 'msg_2',
        sender: 'freelancer',
        senderName: 'Kundan (Autopilot)',
        text: 'Hi Alex, absolutely. The architecture includes Redis-based idempotency caching with a 24-hour TTL and cryptographic timestamp verification within a 5-minute tolerance window to prevent replay attacks.',
        timestamp: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
      },
      {
        id: 'msg_3',
        sender: 'client',
        senderName: 'Alex Chen',
        text: 'Awesome, that meets our compliance requirements. When can we see the initial test suite and how do we release the first milestone ($225)?',
        timestamp: new Date(now.getTime() - 1000 * 60 * 12).toISOString(),
      },
    ],
  });

  // 2. Sarah Miller - Shopify & React App
  conversations.set('conv_sarah_miller', {
    id: 'conv_sarah_miller',
    clientId: 'client_sarah_miller',
    clientName: 'Sarah Miller',
    clientAvatar: 'SM',
    clientCompany: 'Luxe Brands E-Commerce',
    platform: 'RemoteOK',
    projectTitle: 'Headless E-Commerce Storefront in Next.js & Tailwind',
    projectBudget: 600,
    unreadCount: 0,
    lastMessageAt: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
    status: 'in_negotiation',
    autoResponderActive: true,
    messages: [
      {
        id: 'msg_sm_1',
        sender: 'client',
        senderName: 'Sarah Miller',
        text: 'Hello Kundan, we need our product filtering and checkout page optimized for mobile performance before the weekend launch. Are you available for a 48-hour sprint?',
        timestamp: new Date(now.getTime() - 1000 * 60 * 180).toISOString(),
      },
      {
        id: 'msg_sm_2',
        sender: 'freelancer',
        senderName: 'Kundan',
        text: 'Hi Sarah, yes! I have availability for an expedited 48-hour delivery. I can implement server-side filtered facets and edge caching to get Lighthouse performance above 95.',
        timestamp: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
      },
    ],
  });

  // 3. David Zhang - Python AI & Scraper Pipeline
  conversations.set('conv_david_zhang', {
    id: 'conv_david_zhang',
    clientId: 'client_david_zhang',
    clientName: 'David Zhang',
    clientAvatar: 'DZ',
    clientCompany: 'Insight Analytics Labs',
    platform: 'Direct',
    projectTitle: 'Async Web Data Extraction & Gemini Summarizer',
    projectBudget: 350,
    unreadCount: 0,
    lastMessageAt: new Date(now.getTime() - 1000 * 60 * 360).toISOString(),
    status: 'completed',
    autoResponderActive: false,
    messages: [
      {
        id: 'msg_dz_1',
        sender: 'client',
        senderName: 'David Zhang',
        text: 'The deliverable package looks fantastic! All tests passed and the rate-limiter works like a charm. Just releasing the remaining balance now.',
        timestamp: new Date(now.getTime() - 1000 * 60 * 360).toISOString(),
      },
    ],
  });
}

// Initialize on module load
initializeDefaultConversations();

/**
 * Get all conversations
 */
export function getAllConversations(): ClientConversation[] {
  initializeDefaultConversations();
  return Array.from(conversations.values()).sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  );
}

/**
 * Get conversation by ID
 */
export function getConversationById(id: string): ClientConversation | null {
  initializeDefaultConversations();
  return conversations.get(id) || null;
}

/**
 * Add message to a conversation
 */
export function addMessageToConversation(
  convId: string,
  message: {
    sender: 'client' | 'freelancer' | 'ai_assistant';
    senderName: string;
    text: string;
    actionPayload?: ClientMessage['actionPayload'];
  }
): ClientMessage {
  initializeDefaultConversations();
  let conv = conversations.get(convId);
  if (!conv) {
    throw new Error(`Conversation ${convId} not found`);
  }

  const now = new Date().toISOString();
  const newMsg: ClientMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender: message.sender,
    senderName: message.senderName,
    text: message.text,
    timestamp: now,
    actionPayload: message.actionPayload,
  };

  conv.messages.push(newMsg);
  conv.lastMessageAt = now;
  if (message.sender === 'client') {
    conv.unreadCount += 1;
  } else {
    conv.unreadCount = 0;
  }

  logActivityEvent({
    source: 'ClientMessaging',
    type: 'CLIENT_MESSAGE_SENT',
    status: 'success',
    summary: `${message.senderName} (${message.sender}) sent message in "${conv.projectTitle}"`,
    tags: ['client_chat', conv.platform.toLowerCase()],
  });

  return newMsg;
}

/**
 * Create a new client conversation thread
 */
export function createConversation(params: {
  clientName: string;
  projectTitle: string;
  clientCompany?: string;
  platform?: 'Freelancer' | 'RemoteOK' | 'Direct' | 'Upwork';
  projectBudget?: number;
  initialMessage?: string;
}): ClientConversation {
  initializeDefaultConversations();
  const convId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const newConv: ClientConversation = {
    id: convId,
    clientId: `client_${Date.now()}`,
    clientName: params.clientName,
    clientAvatar: params.clientName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
    clientCompany: params.clientCompany || 'Direct Client',
    platform: params.platform || 'Direct',
    projectTitle: params.projectTitle,
    projectBudget: params.projectBudget || 300,
    unreadCount: 0,
    lastMessageAt: now,
    status: 'active',
    autoResponderActive: true,
    messages: params.initialMessage
      ? [
          {
            id: `msg_${Date.now()}`,
            sender: 'client',
            senderName: params.clientName,
            text: params.initialMessage,
            timestamp: now,
          },
        ]
      : [],
  };

  conversations.set(convId, newConv);
  return newConv;
}

/**
 * Generate an AI response to a client message using Gemini
 */
export async function generateClientReply(params: {
  convId: string;
  userPrompt?: string;
  tone?: 'professional' | 'persuasive' | 'concise' | 'technical';
  goal?: 'answer_questions' | 'request_payment' | 'deliver_work' | 'negotiate_rate' | 'close_deal';
}): Promise<{ replyText: string; suggestedAction?: ClientMessage['actionPayload'] }> {
  initializeDefaultConversations();
  const conv = conversations.get(params.convId);
  if (!conv) {
    throw new Error('Conversation not found');
  }

  const recentMessages = conv.messages.slice(-8).map(m => `${m.senderName} (${m.sender}): ${m.text}`).join('\n');
  const ai = getGeminiAI();

  if (ai) {
    try {
      const prompt = `You are Kundan, a Senior Full-Stack Engineer and Freelance Contractor talking to a client.
Client: ${conv.clientName} (${conv.clientCompany || 'Client'})
Project: "${conv.projectTitle}" (Budget: $${conv.projectBudget || 300} USD, Platform: ${conv.platform})

Recent conversation history:
${recentMessages}

Goal: ${params.goal || 'answer_questions and maintain enthusiastic, professional client rapport'}
Tone: ${params.tone || 'professional, confident, clear, and action-oriented'}
${params.userPrompt ? `Special instructions from freelancer: "${params.userPrompt}"` : ''}

Draft the reply. Be polite, technically competent, reassuring, and guide the client toward next steps (milestone approval, review, or payment release).
Keep the reply under 120 words. No robotic phrasing. Return ONLY the message text without quotes.`;

      const result = await generateContentResilient({
        model: 'gemini-3.8-flash',
        fallbackModels: ['gemini-3.1-flash-lite'],
        contents: prompt,
        config: {
          temperature: 0.3,
        },
      });

      const replyText = result.text.trim();
      return { replyText };
    } catch (err: any) {
      console.warn('[ClientMessaging] Gemini reply generation fallback:', err?.message || err);
    }
  }

  // Fallback intelligent response templates
  let fallbackReply = `Hi ${conv.clientName}, thank you for checking in! Everything is proceeding right on schedule for "${conv.projectTitle}". I am finalizing the implementation and test verification. I will share the deliverable bundle shortly for your review!`;

  if (params.goal === 'request_payment') {
    fallbackReply = `Hi ${conv.clientName}, the deliverables for "${conv.projectTitle}" are ready and fully verified. You can review the work and release the milestone payment directly here: https://paypal.me/kundanvision369/${conv.projectBudget || 250}USD. Thank you!`;
  } else if (params.goal === 'deliver_work') {
    fallbackReply = `Hi ${conv.clientName}, I am pleased to deliver the complete source code, automated test suite, and setup documentation for "${conv.projectTitle}". All requirements have been satisfied. Looking forward to your feedback!`;
  }

  return { replyText: fallbackReply };
}

/**
 * Toggle auto-responder for a conversation
 */
export function toggleAutoResponder(convId: string, enabled?: boolean): boolean {
  initializeDefaultConversations();
  const conv = conversations.get(convId);
  if (!conv) throw new Error('Conversation not found');

  conv.autoResponderActive = enabled !== undefined ? enabled : !conv.autoResponderActive;
  return conv.autoResponderActive;
}
