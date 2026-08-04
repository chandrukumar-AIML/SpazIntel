import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Message { role: "user" | "ai"; text: string; streaming?: boolean; }

const CHIPS = [
  "What objects are in this space?",
  "How big is this area?",
  "Are there any safety hazards?",
  "What's closest to the machine?",
  "Count all the objects",
  "How far is the workbench from the exit?",
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
    // Don't persist streaming flag
    const clean = messages.map(({ streaming: _, ...m }) => m);
    localStorage.setItem(storageKey(scanId), JSON.stringify(clean));
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
  const [keyOk,    setKeyOk]    = useState<boolean | null>(null);
  const [llmLabel, setLlmLabel] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.keyStatus().then(s => {
      const ok = s.anthropic || s.groq || s.ollama;
      setKeyOk(ok);
      setLlmLabel(s.anthropic ? "claude" : s.groq ? "groq" : s.ollama ? "ollama" : "");
    }).catch(() => { setKeyOk(false); setLlmLabel(""); });
  }, []);

  useEffect(() => {
    const history = loadHistory(scanId);
    if (history.length > 0) {
      setMessages(history);
    } else {
      setMessages([{ role: "ai", text: "Ask me anything about this room — objects, positions, distances." }]);
    }
  }, [scanId]);

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
    setLoading(true);
    // Append user message + empty streaming AI bubble
    setMessages(m => [...m, { role: "user", text: q }, { role: "ai", text: "", streaming: true }]);

    await api.queryStream(
      scanId,
      q,
      (chunk) => {
        setMessages(m => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, text: last.text + chunk };
          return copy;
        });
      },
      () => {
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], streaming: false };
          return copy;
        });
        setLoading(false);
      },
      (err) => {
        const isKey = /no llm available|your_key_here/i.test(err);
        const msg = isKey
          ? "No LLM available. Add ANTHROPIC_API_KEY, GROQ_API_KEY, or run Ollama locally."
          : `Error: ${err}`;
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "ai", text: msg, streaming: false };
          return copy;
        });
        setLoading(false);
      },
    );
  }

  function clearHistory() {
    localStorage.removeItem(storageKey(scanId));
    setMessages([{ role: "ai", text: "Ask me anything about this room — objects, positions, distances." }]);
  }

  const isFirstMessage = messages.length <= 1 && !loading;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={{ ...s.headerDot, background: keyOk === true ? "var(--success)" : keyOk === false ? "var(--error, #ef4444)" : "var(--text-3)" }} />
        Spatial Q&amp;A
        {keyOk === false && (
          <span style={s.keyWarning} title="Set ANTHROPIC_API_KEY, GROQ_API_KEY, or run Ollama">no key</span>
        )}
        {keyOk === true && llmLabel && (
          <span style={{ ...s.keyWarning, background: "var(--success, #22c55e)", color: "#fff" }}>{llmLabel}</span>
        )}
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
              {m.text || (m.streaming ? null : "")}
              {m.streaming && (
                <span style={s.cursor} />
              )}
            </motion.div>
          ))}
          {loading && messages[messages.length - 1]?.streaming === false && (
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
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap:       { display:"flex", flexDirection:"column", height:"100%", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" },
  header:     { display:"flex", alignItems:"center", gap:8, padding:"12px 16px", borderBottom:"1px solid var(--border)", fontSize:13, fontWeight:600 },
  headerDot:  { width:8, height:8, borderRadius:"50%", background:"var(--success)", flexShrink:0 },
  keyWarning: { fontSize:10, background:"rgba(239,68,68,.15)", color:"#ef4444", borderRadius:4, padding:"2px 6px", border:"1px solid rgba(239,68,68,.3)" },
  badge:      { marginLeft:"auto", fontSize:11, color:"var(--text-3)", fontFamily:"monospace" },
  clearBtn:   { background:"none", border:"none", color:"var(--text-3)", cursor:"pointer", fontSize:16, lineHeight:1, padding:"0 0 0 8px", marginLeft:4 },
  messages:   { flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10 },
  bubble:     { maxWidth:"85%", padding:"10px 14px", borderRadius:10, fontSize:13, lineHeight:1.5, wordBreak:"break-word" as const },
  userBubble: { alignSelf:"flex-end", background:"var(--accent)", color:"#fff", borderBottomRightRadius:2 },
  aiBubble:   { alignSelf:"flex-start", background:"var(--surface-2)", color:"var(--text)", borderBottomLeftRadius:2 },
  cursor:     { display:"inline-block", width:2, height:"1em", background:"var(--accent)", marginLeft:2, verticalAlign:"text-bottom", animation:"blink 1s step-end infinite" },
  dots:       { display:"flex", gap:4, padding:"2px 0" },
  dot:        { width:6, height:6, borderRadius:"50%", background:"var(--text-3)", animation:"pulse 1s ease-in-out infinite" },
  chips:      { display:"flex", flexWrap:"wrap" as const, gap:6, padding:"0 16px 10px" },
  chip:       { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:20, padding:"5px 12px", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" as const, textAlign:"left" as const },
  inputRow:   { display:"flex", gap:8, padding:"12px 16px", borderTop:"1px solid var(--border)" },
  input:      { flex:1, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none" },
  btn:        { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer", minWidth:56 },
};
