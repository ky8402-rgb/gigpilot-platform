import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Sparkles,
  Bot,
  User,
  Clock,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Zap,
  Globe,
  Briefcase,
  Layers,
  ArrowRight
} from 'lucide-react';
import {
  ClientConversation,
  ClientMessage,
  fetchClientConversations,
  sendClientMessage,
  generateClientAutoReply,
  createClientConversation,
  toggleClientAutoResponder
} from '../services/api';

interface ClientCommunicationsHubProps {
  onOpenPaymentCollection?: (orderId: string | number, amount: number, clientName?: string, title?: string) => void;
  onNavigateToTab?: (tab: string) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const ClientCommunicationsHub: React.FC<ClientCommunicationsHubProps> = ({
  onOpenPaymentCollection,
  onNavigateToTab,
  showToast,
}) => {
  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isGeneratingReply, setIsGeneratingReply] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isNewConvModalOpen, setIsNewConvModalOpen] = useState<boolean>(false);

  // Form for new conversation
  const [newClientName, setNewClientName] = useState<string>('');
  const [newProjectTitle, setNewProjectTitle] = useState<string>('');
  const [newCompany, setNewCompany] = useState<string>('');
  const [newBudget, setNewBudget] = useState<string>('350');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations on load
  const sanitizeLoadedConversation = (c: ClientConversation): ClientConversation => ({
    ...c,
    messages: (c.messages || []).map(m => ({
      ...m,
      text: m.text ? m.text.replace(/paypal\.me\/kundanvision369/gi, 'paypal.me/ky8402') : m.text,
      actionPayload: m.actionPayload ? {
        ...m.actionPayload,
        link: m.actionPayload.link ? m.actionPayload.link.replace(/paypal\.me\/kundanvision369/gi, 'paypal.me/ky8402') : m.actionPayload.link
      } : undefined,
    }))
  });

  const loadConversations = async () => {
    try {
      const res = await fetchClientConversations();
      if (res.success && res.conversations.length > 0) {
        const sanitized = res.conversations.map(sanitizeLoadedConversation);
        setConversations(sanitized);
        if (!selectedConvId) {
          setSelectedConvId(sanitized[0].id);
        }
      }
    } catch (err: any) {
      console.warn('Failed to load client conversations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 12000);
    return () => clearInterval(interval);
  }, []);

  const selectedConv = conversations.find(c => c.id === selectedConvId) || conversations[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConv?.messages]);

  const handleSendMessage = async (textToSend?: string, actionPayload?: ClientMessage['actionPayload']) => {
    const text = textToSend || inputText;
    if (!text.trim() || !selectedConv) return;

    setIsSending(true);
    try {
      const res = await sendClientMessage({
        convId: selectedConv.id,
        text: text.trim(),
        sender: 'freelancer',
        senderName: 'Kundan (Freelancer)',
        actionPayload,
      });

      if (res.success) {
        setInputText('');
        // Update local state
        setConversations(prev =>
          prev.map(c =>
            c.id === selectedConv.id
              ? {
                  ...c,
                  messages: [...c.messages, res.message],
                  lastMessageAt: res.message.timestamp,
                  unreadCount: 0,
                }
              : c
          )
        );
      }
    } catch (err: any) {
      showToast(`Failed to send message: ${err.message}`, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleAIDraftReply = async (goal: 'answer_questions' | 'request_payment' | 'deliver_work' | 'negotiate_rate') => {
    if (!selectedConv) return;
    setIsGeneratingReply(true);
    try {
      const res = await generateClientAutoReply({
        convId: selectedConv.id,
        goal,
        tone: 'professional',
      });
      if (res.success && res.replyText) {
        setInputText(res.replyText);
        showToast('AI reply drafted! Review or click send.', 'info');
      }
    } catch (err: any) {
      showToast(`AI Reply error: ${err.message}`, 'error');
    } finally {
      setIsGeneratingReply(false);
    }
  };

  const handleToggleAutoResponder = async () => {
    if (!selectedConv) return;
    try {
      const res = await toggleClientAutoResponder(selectedConv.id);
      if (res.success) {
        setConversations(prev =>
          prev.map(c => (c.id === selectedConv.id ? { ...c, autoResponderActive: res.autoResponderActive } : c))
        );
        showToast(
          `Autonomous AI Client Rep ${res.autoResponderActive ? 'ACTIVATED' : 'PAUSED'} for ${selectedConv.clientName}`,
          res.autoResponderActive ? 'success' : 'info'
        );
      }
    } catch (err: any) {
      showToast(`Failed to toggle auto responder: ${err.message}`, 'error');
    }
  };

  const handleSimulateClientQuestion = async () => {
    if (!selectedConv) return;
    const sampleQuestions = [
      'Hi Kundan, what is the estimated ETA for the final deliverables?',
      'Can you share the payment link so we can fund the next milestone deposit?',
      'We tested the API endpoint and it works great. What are the next deployment steps?',
      'Could we also add an export-to-CSV button for the client dashboard?',
    ];
    const randomQ = sampleQuestions[Math.floor(Math.random() * sampleQuestions.length)];

    try {
      const res = await sendClientMessage({
        convId: selectedConv.id,
        text: randomQ,
        sender: 'client',
        senderName: selectedConv.clientName,
      });

      if (res.success) {
        setConversations(prev =>
          prev.map(c =>
            c.id === selectedConv.id
              ? {
                  ...c,
                  messages: [...c.messages, res.message],
                  lastMessageAt: res.message.timestamp,
                }
              : c
          )
        );
        showToast(`New client message from ${selectedConv.clientName}!`, 'info');

        // If auto-responder is active, trigger automated reply after 1.5 seconds
        if (selectedConv.autoResponderActive) {
          setTimeout(async () => {
            try {
              const aiRes = await generateClientAutoReply({
                convId: selectedConv.id,
                sendDirectly: true,
                goal: 'answer_questions',
              });
              if (aiRes.success && aiRes.sentMessage) {
                setConversations(p =>
                  p.map(c =>
                    c.id === selectedConv.id
                      ? {
                          ...c,
                          messages: [...c.messages, aiRes.sentMessage!],
                          lastMessageAt: aiRes.sentMessage!.timestamp,
                        }
                      : c
                  )
                );
                showToast(`AI Autopilot Rep automatically answered ${selectedConv.clientName}!`, 'success');
              }
            } catch (_) {}
          }, 1500);
        }
      }
    } catch (err: any) {
      showToast(`Simulation error: ${err.message}`, 'error');
    }
  };

  const handleCreateNewConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim() || !newProjectTitle.trim()) return;

    try {
      const res = await createClientConversation({
        clientName: newClientName.trim(),
        projectTitle: newProjectTitle.trim(),
        clientCompany: newCompany.trim() || undefined,
        projectBudget: Number(newBudget) || 350,
        initialMessage: `Hi Kundan, excited to kick off "${newProjectTitle.trim()}". Please let us know once you review the specifications.`,
      });

      if (res.success && res.conversation) {
        setConversations(prev => [res.conversation, ...prev]);
        setSelectedConvId(res.conversation.id);
        setIsNewConvModalOpen(false);
        setNewClientName('');
        setNewProjectTitle('');
        setNewCompany('');
        showToast(`Created client thread for ${res.conversation.clientName}!`, 'success');
      }
    } catch (err: any) {
      showToast(`Failed to create conversation: ${err.message}`, 'error');
    }
  };

  const filteredConversations = conversations.filter(
    c =>
      c.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.projectTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.clientCompany && c.clientCompany.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-8">
      
      {/* Top Banner */}
      <div className="rounded-3xl border border-blue-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-400">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Autonomous Client Communications Hub</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            Client Messaging &amp; AI Auto-Responder
          </h2>
          <p className="text-xs text-slate-300 max-w-2xl">
            Talk to clients directly across Freelancer, RemoteOK, and direct contracts. Use Gemini to draft replies, negotiate milestones, send work deliverables, and collect instant payments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsNewConvModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-blue-500/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Client Thread</span>
          </button>
          <button
            onClick={loadConversations}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700"
            title="Refresh conversations"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main 2-Column Chat Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[750px] max-h-[82vh]">
        
        {/* Left Column: Conversations List (4 cols) */}
        <div className="lg:col-span-4 bg-[#0d111d] border border-slate-800 rounded-3xl p-4 flex flex-col overflow-hidden">
          
          {/* Search Box */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clients or projects..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Conversations Scrollable List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <div className="text-center py-10 text-xs text-slate-500">Loading client threads...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500">No client conversations found.</div>
            ) : (
              filteredConversations.map(conv => {
                const isSelected = selectedConv?.id === conv.id;
                const lastMsg = conv.messages[conv.messages.length - 1];

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500/40 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 text-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold font-mono text-xs shrink-0">
                          {conv.clientAvatar || conv.clientName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-xs truncate text-white">{conv.clientName}</h4>
                          <span className="text-[10px] text-slate-400 truncate block">
                            {conv.clientCompany || conv.platform}
                          </span>
                        </div>
                      </div>

                      {conv.projectBudget && (
                        <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-500/20 shrink-0">
                          ${conv.projectBudget}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] font-mono text-slate-400 truncate mt-1">
                      {conv.projectTitle}
                    </div>

                    {lastMsg && (
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-1 leading-normal">
                        <strong className="text-slate-300">{lastMsg.sender === 'client' ? conv.clientName.split(' ')[0] : 'You'}:</strong> {lastMsg.text}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
                      <span className="uppercase font-mono font-bold text-blue-400">{conv.platform}</span>
                      <span className="flex items-center gap-1">
                        {conv.autoResponderActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Auto-responder ON"></span>
                        )}
                        {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Active Conversation (8 cols) */}
        <div className="lg:col-span-8 bg-[#0d111d] border border-slate-800 rounded-3xl flex flex-col overflow-hidden">
          
          {selectedConv ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold font-mono text-sm">
                    {selectedConv.clientAvatar || selectedConv.clientName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-white">{selectedConv.clientName}</h3>
                      <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 uppercase font-bold">
                        {selectedConv.platform}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate max-w-md">
                      Project: <strong className="text-slate-200">{selectedConv.projectTitle}</strong>
                    </p>
                  </div>
                </div>

                {/* Header Action Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  
                  {/* Auto-Responder Toggle */}
                  <button
                    onClick={handleToggleAutoResponder}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      selectedConv.autoResponderActive
                        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                    title="Toggle autonomous Gemini auto-replies for this client"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Auto-Rep: {selectedConv.autoResponderActive ? 'ON' : 'OFF'}</span>
                  </button>

                  {/* Simulate Incoming Message Button */}
                  <button
                    onClick={handleSimulateClientQuestion}
                    className="px-2.5 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600 border border-purple-500/30 text-purple-300 hover:text-white text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                    title="Simulate incoming client message to test dialogue"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Test Message</span>
                  </button>

                  {/* Direct Payment Collection Action */}
                  <button
                    onClick={() => {
                      onOpenPaymentCollection?.(
                        selectedConv.id,
                        selectedConv.projectBudget || 350,
                        selectedConv.clientName,
                        selectedConv.projectTitle
                      );
                    }}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Collect Money</span>
                  </button>
                </div>
              </div>

              {/* Chat Message Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#090d16]/70">
                {selectedConv.messages.map((msg, idx) => {
                  const isClient = msg.sender === 'client';
                  const isAi = msg.sender === 'ai_assistant';

                  return (
                    <div
                      key={msg.id || idx}
                      className={`flex flex-col ${isClient ? 'items-start' : 'items-end'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1 px-1">
                        <span className="font-semibold text-slate-300">{msg.senderName}</span>
                        {isAi && (
                          <span className="bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded font-mono text-[9px] border border-purple-500/30">
                            AI Autopilot
                          </span>
                        )}
                        <span>•</span>
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                          isClient
                            ? 'bg-[#182032] border border-slate-700/80 text-slate-200 rounded-tl-sm'
                            : isAi
                            ? 'bg-purple-950/40 border border-purple-500/30 text-purple-100 rounded-tr-sm'
                            : 'bg-blue-600 text-white rounded-tr-sm shadow-md'
                        }`}
                      >
                        {/* Sanitized message text */}
                        <p className="whitespace-pre-wrap">
                          {msg.text ? msg.text.replace(/paypal\.me\/kundanvision369/gi, 'paypal.me/ky8402') : ''}
                        </p>

                        {/* Interactive Action Payload if attached */}
                        {msg.actionPayload && (
                          <div className="mt-2 pt-2 border-t border-white/20 flex flex-wrap items-center gap-2">
                            {msg.actionPayload.link && (
                              <a
                                href={msg.actionPayload.link.replace(/paypal\.me\/kundanvision369/gi, 'paypal.me/ky8402')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white font-bold text-[11px] px-2.5 py-1 rounded-lg transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>{msg.actionPayload.label || 'Open Link'}</span>
                              </a>
                            )}
                            {msg.actionPayload.amount && (
                              <button
                                onClick={() => {
                                  onOpenPaymentCollection?.(
                                    selectedConv.id,
                                    msg.actionPayload?.amount || 250,
                                    selectedConv.clientName,
                                    selectedConv.projectTitle
                                  );
                                }}
                                className="inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                              >
                                <DollarSign className="w-3 h-3" />
                                <span>Collect ${msg.actionPayload.amount} USD</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Negotiation & Action Chips */}
              <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/60 flex flex-wrap items-center gap-1.5 overflow-x-auto">
                <span className="text-[10px] text-slate-500 font-mono uppercase font-bold mr-1">
                  AI Quick Actions:
                </span>
                
                <button
                  onClick={() => handleAIDraftReply('answer_questions')}
                  disabled={isGeneratingReply}
                  className="px-2.5 py-1 rounded-lg bg-blue-600/15 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Draft Progress Update</span>
                </button>

                <button
                  onClick={() => handleAIDraftReply('request_payment')}
                  disabled={isGeneratingReply}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <DollarSign className="w-3 h-3" />
                  <span>Request Milestone Payment</span>
                </button>

                <button
                  onClick={() => handleAIDraftReply('deliver_work')}
                  disabled={isGeneratingReply}
                  className="px-2.5 py-1 rounded-lg bg-purple-600/15 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Briefcase className="w-3 h-3" />
                  <span>Submit Deliverables Notice</span>
                </button>

                <button
                  onClick={() => {
                    const payUrl = `https://paypal.me/ky8402/${selectedConv.projectBudget || 250}USD`;
                    handleSendMessage(
                      `Here is the verified PayPal milestone checkout link for "${selectedConv.projectTitle}": ${payUrl}`,
                      {
                        type: 'payment_request',
                        amount: selectedConv.projectBudget || 250,
                        link: payUrl,
                        label: `Pay $${selectedConv.projectBudget || 250} via PayPal`,
                      }
                    );
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3 text-blue-400" />
                  <span>Insert PayPal Pay Link</span>
                </button>
              </div>

              {/* Input Bar */}
              <div className="p-3 border-t border-slate-800 bg-slate-900/90 flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder={`Reply to ${selectedConv.clientName}...`}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                />

                <button
                  onClick={() => handleSendMessage()}
                  disabled={isSending || !inputText.trim()}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-blue-600/20 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-2">
              <MessageSquare className="w-12 h-12 text-slate-600" />
              <p className="text-sm font-semibold">Select a client thread to start communicating</p>
            </div>
          )}

        </div>

      </div>

      {/* Modal: New Client Thread */}
      {isNewConvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-[#0f1422] border border-blue-500/30 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span>Start New Client Thread</span>
            </h3>

            <form onSubmit={handleCreateNewConversation} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Client Name *</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g. Michael Thorne"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Company / Organization</label>
                <input
                  type="text"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="e.g. Thorne Capital Partners"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Project Title *</label>
                <input
                  type="text"
                  required
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  placeholder="e.g. PostgreSQL Database Sharding & Failover Setup"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Project Budget (USD)</label>
                <input
                  type="number"
                  value={newBudget}
                  onChange={(e) => setNewBudget(e.target.value)}
                  placeholder="350"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewConvModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Create Thread
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
