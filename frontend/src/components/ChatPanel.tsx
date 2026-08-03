import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Message { role: "user" | "ai"; text: string; }

const CHIPS = [
  "What furniture is in this room?",
  "How big is this room?",
  "What's closest to the door?",
  "Are there any safety hazards?",
  "Count all the objects",
  "What changed since my last scan?",
];

interface Props { scanId: string }

function storageKey(scanId: string) { return `chat_${scanId}`; }

function loadHistory(scanId: string): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(scanId));
    if (raw) return JSON.parse(raw) as Message[];
  } catch {}
  return [];
}

function saveHistory(scanId: string, messages: Message[]) {
  try {
    localStorage.setItem(storageKey(scanId), JSON.stringify(messages));
  } catch {}
}

export function ChatPanel({ scanId }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    const history = loadHistory(scanId);
    if (history.length > 0) return history;
    return [{ role: "ai", text: "Ask me anything about this room — objects, positions, distances." }];
  });
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reload history when scanId changes
  useEffect(() => {
    const history = loadHistory(scanId);
    if (history.length > 0) {
      setMessages(history);
    } else {
      setMessages([{ role: "ai", text: "Ask me anything about this room — objects, positions, distances." }]);
    }
  }, [scanId]);

  // Persist every message change
  useEffect(() => {
    saveHistory(scanId, messages);
  }, [scanId, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    const next: Message[] = [...messages, { role: "user", text: q }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await api.query(scanId, q);
      setMessages(m => [...m, { role: "ai", text: res.answer }]);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Error";
      const isKey = /api.?key|authentication|invalid.?key|401/i.test(raw);
      const msg = isKey
        ? "Q&A needs an Anthropic API key. Add ANTHROPIC_API_KEY=sk-... to your .env and restart the backend."
        : `Error: ${raw}`;
      setMessages(m => [...m, { role: "ai", text: msg }]);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    localStorage.removeItem(storageKey(scanId));
    setMessages([{ role: "ai", text: "Ask me anything about this room — objects, positions, distances." }]);
  }

  const isFirstMessage = messages.length <= 1 && !loading;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.headerDot} />
        Spatial Q&amp;A
        <span style={s.badge}>{scanId}</span>
        {messages.length > 1 && (
          <button style={s.clearBtn} onClick={clearHistory} title="Clear chat history">↺</button>
        )}
      </div>

      <div style={s.messages}>
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              style={{ ...s.bubble, ...(m.role === "user" ? s.userBubble : s.aiBubble) }}
            >
              {m.text}
            </motion.div>
          ))}
          {loading && (
            <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={s.aiBubble}>
              <span style={s.dots}>
                {[0,1,2].map(i => <span key={i} style={{ ...s.dot, animationDelay: `${i * 0.15}s` }} />)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {isFirstMessage && (
        <div style={s.chips}>
          {CHIPS.map(q => (
            <button key={q} style={s.chip} onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div style={s.inputRow}>
        <input
          style={s.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Where is the chair? How many doors?"
          disabled={loading}
        />
        <button style={s.btn} onClick={() => send()} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap:      { display:"flex", flexDirection:"column", height:"100%", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" },
  header:    { display:"flex", alignItems:"center", gap:8, padding:"12px 16px", borderBottom:"1px solid var(--border)", fontSize:13, fontWeight:600 },
  headerDot: { width:8, height:8, borderRadius:"50%", background:"var(--success)" },
  badge:     { marginLeft:"auto", fontSize:11, color:"var(--text-3)", fontFamily:"monospace" },
  clearBtn:  { background:"none", border:"none", color:"var(--text-3)", cursor:"pointer", fontSize:16, lineHeight:1, padding:"0 0 0 8px", marginLeft:4 },
  messages:  { flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10 },
  bubble:    { maxWidth:"85%", padding:"10px 14px", borderRadius:10, fontSize:13, lineHeight:1.5 },
  userBubble:{ alignSelf:"flex-end", background:"var(--accent)", color:"#fff", borderBottomRightRadius:2 },
  aiBubble:  { alignSelf:"flex-start", background:"var(--surface-2)", color:"var(--text)", borderBottomLeftRadius:2 },
  dots:      { display:"flex", gap:4, padding:"2px 0" },
  dot:       { width:6, height:6, borderRadius:"50%", background:"var(--text-3)", animation:"pulse 1s ease-in-out infinite" },
  chips:     { display:"flex", flexWrap:"wrap" as const, gap:6, padding:"0 16px 10px" },
  chip:      { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:20, padding:"5px 12px", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" as const, textAlign:"left" as const },
  inputRow:  { display:"flex", gap:8, padding:"12px 16px", borderTop:"1px solid var(--border)" },
  input:     { flex:1, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none" },
  btn:       { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer" },
};
