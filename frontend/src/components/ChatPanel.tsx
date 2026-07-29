import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Message { role: "user" | "ai"; text: string; }

interface Props { scanId: string }

export function ChatPanel({ scanId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "ai", text: "Ask me anything about this room — objects, positions, counts." }
  ]);
  const [input, setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const res = await api.query(scanId, q);
      setMessages(m => [...m, { role: "ai", text: res.answer }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error";
      setMessages(m => [...m, { role: "ai", text: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.headerDot} />
        Spatial Q&amp;A
        <span style={styles.badge}>{scanId}</span>
      </div>

      <div style={styles.messages}>
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              style={{ ...styles.bubble, ...(m.role === "user" ? styles.userBubble : styles.aiBubble) }}
            >
              {m.text}
            </motion.div>
          ))}
          {loading && (
            <motion.div
              key="typing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={styles.aiBubble}
            >
              <span style={styles.dots}>
                {[0,1,2].map(i => <span key={i} style={{ ...styles.dot, animationDelay: `${i*0.15}s` }} />)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Where is the chair? How many doors?"
          disabled={loading}
        />
        <button style={styles.btn} onClick={send} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display:"flex", flexDirection:"column", height:"100%", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" },
  header: { display:"flex", alignItems:"center", gap:8, padding:"12px 16px", borderBottom:"1px solid var(--border)", fontSize:13, fontWeight:600 },
  headerDot: { width:8, height:8, borderRadius:"50%", background:"var(--success)" },
  badge: { marginLeft:"auto", fontSize:11, color:"var(--text-3)", fontFamily:"monospace" },
  messages: { flex:1, overflowY:"auto", padding:"16px", display:"flex", flexDirection:"column", gap:10 },
  bubble: { maxWidth:"85%", padding:"10px 14px", borderRadius:10, fontSize:13, lineHeight:1.5 },
  userBubble: { alignSelf:"flex-end", background:"var(--accent)", color:"#fff", borderBottomRightRadius:2 },
  aiBubble: { alignSelf:"flex-start", background:"var(--surface-2)", color:"var(--text)", borderBottomLeftRadius:2 },
  dots: { display:"flex", gap:4, padding:"2px 0" },
  dot: { width:6, height:6, borderRadius:"50%", background:"var(--text-3)", animation:"pulse 1s ease-in-out infinite" },
  inputRow: { display:"flex", gap:8, padding:"12px 16px", borderTop:"1px solid var(--border)" },
  input: { flex:1, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"8px 12px", color:"var(--text)", fontSize:13, outline:"none" },
  btn: { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer" },
};
