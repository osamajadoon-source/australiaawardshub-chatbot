// components/ChatWidget.jsx
// Floating chat widget — renders on all pages

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

// ── CONFIG (edit here to customise) ─────────────────────────────────
const CONFIG = {
  apiEndpoint: '/api/chat',
  botName: 'Australia Awards Hub AI',
  botSubtitle: 'Scholarships & Visa Guide',
  accentColor: '#006B35',       // dark green (Australia Awards)
  accentLight: '#E8F5EE',
  goldColor: '#E8B14F',
  greeting: "Hi! I'm your Australia Awards Hub AI assistant 👋\n\nI can help you with **scholarships**, **student visas**, **university selection**, and more.\n\nWhat would you like to know?",
  faqButtons: [
    { label: '🎓 Australia Awards', text: 'How do I apply for the Australia Awards Scholarship 2027?' },
    { label: '📄 DILP help', text: 'What is the DILP and how do I write it?' },
    { label: '🏛️ Best university?', text: 'How do I choose the right Australian university for my field?' },
    { label: '✈️ Student visa', text: 'How do I apply for an Australian student visa (Subclass 500)?' },
    { label: '💰 PhD funding', text: 'What fully funded PhD scholarships are available for international students?' },
    { label: '🗓️ Deadlines 2026', text: 'What are the key scholarship deadlines for 2026?' },
  ],
  disclaimer: '⚠️ General educational information only. Not a registered migration agent.',
};
// ────────────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2 px-1">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function Message({ role, content, isStreaming }) {
  const isBot = role === 'assistant';
  return (
    <div className={`flex gap-2 mb-4 ${isBot ? 'justify-start' : 'justify-end'}`}>
      {isBot && (
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold mt-1"
          style={{ background: CONFIG.accentColor }}>
          AI
        </div>
      )}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
        ${isBot
          ? 'bg-white text-gray-800 rounded-tl-sm border border-gray-100'
          : 'text-white rounded-tr-sm'
        }`}
        style={!isBot ? { background: CONFIG.accentColor } : {}}>
        {isStreaming && !content ? (
          <TypingDots />
        ) : (
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  className="underline font-medium"
                  style={{ color: CONFIG.accentColor }}>
                  {children}
                </a>
              ),
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              h3: ({ children }) => <h3 className="font-bold text-sm mb-1 mt-2">{children}</h3>,
            }}>
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: CONFIG.greeting }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);
  useEffect(() => {
    if (open) { setUnread(0); inputRef.current?.focus(); }
  }, [open]);

  async function sendMessage(text) {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);

    // Add streaming assistant message placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);

    // Build messages for API (exclude greeting from context if too long)
    const apiMessages = newMessages
      .slice(-10)  // last 10 messages for context
      .map(m => ({ role: m.role, content: m.content }));

    try {
      abortRef.current = new AbortController();
      const res = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              accumulated += parsed.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: accumulated,
                  isStreaming: true,
                };
                return updated;
              });
            }
            if (parsed.error) throw new Error(parsed.error);
          } catch (e) { /* skip malformed chunks */ }
        }
      }

      // Finalise message
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: accumulated, isStreaming: false };
        return updated;
      });

      if (!open) setUnread(u => u + 1);

    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Sorry, something went wrong. Please try again.\n\n_Error: ${err.message}_`,
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([{ role: 'assistant', content: CONFIG.greeting }]);
    abortRef.current?.abort();
    setLoading(false);
  }

  return (
    <>
      {/* Chat window */}
      <div className={`fixed bottom-20 right-4 z-50 transition-all duration-300 ease-in-out
        ${open ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}
        ${darkMode ? 'dark' : ''}`}
        style={{ width: 'min(380px, calc(100vw - 32px))', maxHeight: 'min(600px, calc(100vh - 100px))' }}>

        <div className={`flex flex-col rounded-2xl shadow-2xl overflow-hidden h-full
          ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}
          style={{ height: 'min(600px, calc(100vh - 100px))' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${CONFIG.accentColor}, #004D26)` }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <span className="text-white text-sm font-bold">AI</span>
              </div>
              <div>
                <div className="text-white font-semibold text-sm">{CONFIG.botName}</div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                  <span className="text-white/75 text-xs">{CONFIG.botSubtitle}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setDarkMode(d => !d)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                title="Toggle dark mode">
                <span className="text-white text-xs">{darkMode ? '☀️' : '🌙'}</span>
              </button>
              <button onClick={clearChat}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                title="Clear chat">
                <span className="text-white text-xs">🗑</span>
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <span className="text-white text-sm">✕</span>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className={`flex-1 overflow-y-auto px-4 py-3 space-y-1
            ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>

            {messages.map((msg, i) => (
              <Message key={i} role={msg.role} content={msg.content} isStreaming={msg.isStreaming} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* FAQ quick buttons — show after greeting */}
          {messages.length <= 2 && (
            <div className={`px-4 pb-2 flex-shrink-0 ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
              <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Quick questions:</p>
              <div className="flex flex-wrap gap-1.5">
                {CONFIG.faqButtons.map((btn, i) => (
                  <button key={i} onClick={() => sendMessage(btn.text)}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:text-white"
                    style={{ borderColor: CONFIG.accentColor, color: CONFIG.accentColor }}
                    onMouseEnter={e => { e.target.style.background = CONFIG.accentColor; e.target.style.color = 'white'; }}
                    onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = CONFIG.accentColor; }}>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className={`px-3 py-3 flex-shrink-0 border-t
            ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className={`flex items-end gap-2 rounded-xl border px-3 py-2
              ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about scholarships, visas, universities…"
                rows={1}
                disabled={loading}
                className={`flex-1 resize-none text-sm outline-none bg-transparent leading-relaxed max-h-28
                  ${darkMode ? 'text-gray-100 placeholder-gray-400' : 'text-gray-800 placeholder-gray-400'}`}
                style={{ minHeight: '24px' }}
                onInput={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-white transition-all disabled:opacity-40"
                style={{ background: CONFIG.accentColor }}>
                {loading
                  ? <span className="text-xs animate-spin">◌</span>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                }
              </button>
            </div>
            <p className={`text-xs mt-1.5 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {CONFIG.disclaimer}
            </p>
          </div>
        </div>
      </div>

      {/* Floating bubble */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95"
        style={{ background: `linear-gradient(135deg, ${CONFIG.accentColor}, #004D26)` }}
        aria-label="Open chat assistant">
        {open
          ? <span className="text-white text-xl">✕</span>
          : <span className="text-2xl">💬</span>
        }
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
            {unread}
          </span>
        )}
      </button>
    </>
  );
}
