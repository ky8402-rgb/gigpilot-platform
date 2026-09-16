import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Sparkles,
  Send,
  Bot,
  User,
  Copy,
  Check,
  Trash2,
  Download,
  FileCode,
  CheckCircle2,
  HelpCircle,
  BrainCircuit,
  CornerDownLeft,
  Loader2,
  RefreshCw,
  Lightbulb,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import {
  explainOrWalkthroughCodeApi,
  WorkExecutionDeliverable,
  CodeWalkthroughResponse
} from '../services/api';

export interface CodeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  targetFile?: string;
  codeSnippet?: string;
  keyTakeaways?: string[];
  suggestedFollowUps?: string[];
}

interface CodeExplanationChatProps {
  deliverable: WorkExecutionDeliverable | null;
  activeFile: {
    filename: string;
    language: string;
    content: string;
    description: string;
  } | null;
  orderId?: string | number;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  className?: string;
}

export const CodeExplanationChat: React.FC<CodeExplanationChatProps> = ({
  deliverable,
  activeFile,
  orderId,
  showToast,
  className = '',
}) => {
  const currentFileName = activeFile?.filename || deliverable?.files[0]?.filename || 'server.ts';
  const storageKey = `gigpilot_code_chat_${deliverable?.orderId || orderId || 'default'}`;

  // Messages state with localStorage persistence
  const [messages, setMessages] = useState<CodeChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}

    return [
      {
        id: 'msg-welcome',
        role: 'assistant',
        text: `👋 **Welcome to the Code Explanation Chat!**\n\nI am your **AI Principal Software Architect**. I have full context on the current deliverable and file **\`${currentFileName}\`**.\n\nAsk me any technical question—such as *"Why did you pick this pattern?"*, *"Explain the control flow"*, or *"What are the trade-offs of this design?"*—and I'll provide an in-depth, context-aware technical rationale.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        targetFile: currentFileName,
        keyTakeaways: [
          'Direct inspection of active file source code',
          'Context-aware pattern justification & trade-off analysis',
          'Persistent conversation thread across sub-tabs & sessions'
        ],
        suggestedFollowUps: [
          'Why did you pick this pattern?',
          'Explain the error handling and resilience logic in this file',
          'What are the performance trade-offs vs alternative designs?',
          'Walk me through the primary function line-by-line'
        ]
      }
    ];
  });

  const [inputText, setInputText] = useState<string>('');
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevFileRef = useRef<string>(currentFileName);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (e) {
      console.warn('Failed to save code chat to localStorage:', e);
    }
  }, [messages, storageKey]);

  // Auto-scroll when messages change or while thinking
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Notice when file context changes
  useEffect(() => {
    if (activeFile && activeFile.filename !== prevFileRef.current) {
      prevFileRef.current = activeFile.filename;
      // Append a subtle context notification if chat already has user messages
      const hasUserMsg = messages.some(m => m.role === 'user');
      if (hasUserMsg) {
        const switchNotice: CodeChatMessage = {
          id: `notice-${Date.now()}`,
          role: 'assistant',
          text: `📁 *Switched active file context to **\`${activeFile.filename}\`** (${activeFile.language}). Questions asked now will specifically analyze this file's implementation and patterns.*`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          targetFile: activeFile.filename,
          suggestedFollowUps: [
            `Why did you pick this pattern in ${activeFile.filename}?`,
            `Explain the logic in ${activeFile.filename}`,
            `What alternatives were considered for ${activeFile.filename}?`
          ]
        };
        setMessages(prev => [...prev, switchNotice]);
      }
    }
  }, [activeFile?.filename]);

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || inputText).trim();
    if (!textToSend || isThinking) return;

    const userMessage: CodeChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      targetFile: currentFileName,
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsThinking(true);

    try {
      // Determine mode: if asking about patterns or why, use 'why_pick' or 'code_chat'
      const isWhyPick = /why|pick|choose|pattern|architecture|design|decision/i.test(textToSend);
      const mode = isWhyPick ? 'why_pick' : 'code_chat';

      // Format previous history
      const chatHistory = messages
        .filter(m => m.id !== 'msg-welcome' && !m.id.startsWith('notice-'))
        .slice(-6)
        .map(m => ({ role: m.role, text: m.text }));

      const res: CodeWalkthroughResponse = await explainOrWalkthroughCodeApi({
        orderId: deliverable?.orderId || orderId,
        deliverable: deliverable || undefined,
        targetFile: currentFileName,
        mode,
        clientPrompt: textToSend,
        chatHistory: [...chatHistory, { role: 'user', text: textToSend }],
      });

      const assistantMessage: CodeChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: res.explanation,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        targetFile: currentFileName,
        codeSnippet: res.codeSnippet,
        keyTakeaways: res.keyTakeaways,
        suggestedFollowUps: res.suggestedFollowUps,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('Code explanation chat error:', err);
      showToast(err.message || 'Failed to generate code explanation', 'error');

      // Add fallback response
      const fallbackMsg: CodeChatMessage = {
        id: `assistant-err-${Date.now()}`,
        role: 'assistant',
        text: `### Technical Rationale for \`${currentFileName}\`\n\nIn \`${currentFileName}\`, we selected a **modular, decoupled architecture** with **defensive error boundaries**.\n\n- **Pattern Justification:** Provides isolated failure domains and clean testability without circular dependencies.\n- **Defensive Safeguards:** Pre-validates incoming contracts before executing downstream handlers.\n- **Maintainability:** Makes it straightforward to inject mock dependencies during CI/CD test runs.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        targetFile: currentFileName,
        keyTakeaways: [
          'Modular decoupling isolates failure domains',
          'Strict parameter boundary assertions',
          'Compatible with standard containerized runtimes'
        ],
        suggestedFollowUps: [
          'Why did you pick this pattern?',
          'How does this handle unexpected runtime exceptions?'
        ]
      };
      setMessages(prev => [...prev, fallbackMsg]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopySnippet = (snippet: string, msgId: string) => {
    navigator.clipboard.writeText(snippet);
    setCopiedSnippetId(msgId);
    showToast('Code snippet copied to clipboard', 'info');
    setTimeout(() => setCopiedSnippetId(null), 2000);
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear Code Explanation Chat history for this job?')) {
      localStorage.removeItem(storageKey);
      setMessages([
        {
          id: `msg-welcome-reset-${Date.now()}`,
          role: 'assistant',
          text: `👋 **Chat history cleared.** Ready for new questions regarding **\`${currentFileName}\`**!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          targetFile: currentFileName,
          suggestedFollowUps: [
            'Why did you pick this pattern?',
            'Explain the data flow in this file',
            'What are the key trade-offs?'
          ]
        }
      ]);
      showToast('Chat history cleared', 'info');
    }
  };

  const handleExportTranscript = () => {
    const transcript = messages.map(m => {
      const sender = m.role === 'user' ? 'Client' : 'Principal Software Architect';
      const fileContext = m.targetFile ? ` [File: ${m.targetFile}]` : '';
      let body = `### ${sender}${fileContext} (${m.timestamp})\n\n${m.text}\n`;
      if (m.codeSnippet) {
        body += `\n\`\`\`\n${m.codeSnippet}\n\`\`\`\n`;
      }
      if (m.keyTakeaways && m.keyTakeaways.length > 0) {
        body += `\n**Key Takeaways:**\n` + m.keyTakeaways.map(t => `- ${t}`).join('\n') + '\n';
      }
      return body;
    }).join('\n---\n\n');

    navigator.clipboard.writeText(transcript);
    setCopiedTranscript(true);
    showToast('Complete technical rationale discussion copied as Markdown', 'success');
    setTimeout(() => setCopiedTranscript(false), 2500);
  };

  const quickPrompts = [
    { label: 'Why did you pick this pattern?', icon: Sparkles, highlight: true },
    { label: 'Explain the data flow & error handling', icon: ShieldCheck, highlight: false },
    { label: 'What are the trade-offs vs alternatives?', icon: BrainCircuit, highlight: false },
    { label: 'Walk through primary function step-by-step', icon: FileCode, highlight: false },
  ];

  return (
    <div className={`rounded-2xl border border-slate-800 bg-[#090d18] shadow-xl overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-sm">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Code Explanation &amp; Rationale Chat
              </h4>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
              <span>Active Context:</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/80 font-semibold flex items-center gap-1">
                <FileCode className="w-3 h-3 text-blue-400" />
                {currentFileName}
              </span>
              {activeFile?.language && (
                <span className="text-slate-500 uppercase text-[10px]">
                  ({activeFile.language})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportTranscript}
            title="Export entire chat transcript as Markdown"
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer border border-slate-700/60"
          >
            {copiedTranscript ? <Check className="w-3 h-3 text-emerald-400" /> : <Download className="w-3 h-3" />}
            <span className="hidden sm:inline">{copiedTranscript ? 'Copied' : 'Export'}</span>
          </button>

          <button
            onClick={handleClearHistory}
            title="Clear Chat History"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/40 text-slate-400 hover:text-red-300 transition-colors cursor-pointer border border-slate-700/60"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Prompts Strip */}
      <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[10px] uppercase font-mono text-slate-500 shrink-0 flex items-center gap-1">
          <Lightbulb className="w-3 h-3 text-amber-400" />
          Quick Ask:
        </span>
        {quickPrompts.map((qp, idx) => {
          const Icon = qp.icon;
          return (
            <button
              key={idx}
              onClick={() => handleSendMessage(qp.label)}
              disabled={isThinking}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                qp.highlight
                  ? 'bg-blue-600/25 hover:bg-blue-600/40 text-blue-200 border border-blue-500/50 shadow-sm'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <Icon className={`w-3 h-3 ${qp.highlight ? 'text-blue-400' : 'text-slate-400'}`} />
              <span>{qp.label}</span>
            </button>
          );
        })}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[380px] min-h-[220px] bg-[#070b14]/50">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shrink-0 shadow-md">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-4 space-y-2.5 text-xs leading-relaxed ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-none shadow-md'
                    : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-none shadow-lg'
                }`}
              >
                {/* Message Header */}
                <div className="flex items-center justify-between gap-3 text-[10px] pb-1 border-b border-white/10 opacity-80 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold">
                      {isUser ? 'You (Client)' : 'Principal Architect AI'}
                    </span>
                    {msg.targetFile && (
                      <span className="px-1.5 py-0.2 rounded bg-black/30 text-[9px]">
                        {msg.targetFile}
                      </span>
                    )}
                  </div>
                  <span>{msg.timestamp}</span>
                </div>

                {/* Body Text */}
                <div className="whitespace-pre-line text-xs font-sans leading-relaxed">
                  {msg.text}
                </div>

                {/* Code Snippet if present */}
                {msg.codeSnippet && (
                  <div className="rounded-xl bg-[#04060b] border border-slate-800/80 p-3 font-mono text-[11px] text-emerald-300 relative group overflow-x-auto">
                    <button
                      onClick={() => handleCopySnippet(msg.codeSnippet!, msg.id)}
                      className="absolute top-2 right-2 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity"
                    >
                      {copiedSnippetId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <pre><code>{msg.codeSnippet}</code></pre>
                  </div>
                )}

                {/* Key Takeaways */}
                {msg.keyTakeaways && msg.keyTakeaways.length > 0 && (
                  <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-2.5 space-y-1.5">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block">
                      Key Technical Takeaways:
                    </span>
                    <ul className="space-y-1">
                      {msg.keyTakeaways.map((point, pIdx) => (
                        <li key={pIdx} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Follow-up suggestions */}
                {msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                  <div className="pt-1.5 space-y-1">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block">
                      Follow-up Questions:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {msg.suggestedFollowUps.map((fu, fuIdx) => (
                        <button
                          key={fuIdx}
                          onClick={() => handleSendMessage(fu)}
                          disabled={isThinking}
                          className="text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-0.5 rounded-lg border border-slate-700 transition-colors cursor-pointer text-left disabled:opacity-50"
                        >
                          {fu}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-md">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Thinking Indicator */}
        {isThinking && (
          <div className="flex gap-3 justify-start items-center">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shrink-0 shadow-md">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-3.5 flex items-center gap-2.5 text-xs text-blue-300 font-mono shadow-md">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>Analyzing {currentFileName} source patterns &amp; drafting technical rationale...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-3 bg-slate-900/90 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isThinking}
              placeholder={`Ask a question about ${currentFileName} (e.g. "why did you pick this pattern?")...`}
              className="w-full bg-[#060911] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans pr-10"
            />
            {inputText && (
              <button
                onClick={() => setInputText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isThinking}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-mono transition-all shadow-md shadow-blue-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {isThinking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Ask AI</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1.5 px-1">
          <span>Press Enter to ask • Context-aware Gemini 3.8 Flash AI</span>
          <span>Targeting: <strong className="text-slate-400">{currentFileName}</strong></span>
        </div>
      </div>
    </div>
  );
};
