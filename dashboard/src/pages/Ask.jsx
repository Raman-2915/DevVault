import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const EXAMPLES = [
  "What authentication approaches have I used across my projects?",
  "Which databases have I used across my projects?",
  "Which projects use MongoDB and how?",
  "What deployment problems have I solved before?"
];

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, busy]);

  async function send(text) {
    const q = text.trim();
    if (!q || busy) return;

    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setBusy(true);

    try {
      const result = await api("POST", "/api/ask", { question: q });
      setMessages((prev) => [...prev, { role: "ai", text: result.answer, sources: result.sources, grounded: result.grounded, notice: result.notice }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "error", text: err.message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <h1>Ask your knowledge base</h1>
      <p className="muted">Answers come only from entries you have synced, with sources. If it isn’t in your vault, it says so.</p>

      <div className="chat-log">
        {messages.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} className="chip" onClick={() => send(example)}>{example}</button>
            ))}
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={`msg ${message.role}`}>
            <div className="bubble">{message.text}</div>
            {message.role === "ai" && !message.grounded && <div className="muted small">No supporting entries were found.</div>}
            {message.notice && <div className="muted small">{message.notice}</div>}
            {message.sources?.length > 0 && (
              <div className="sources">
                {message.sources.map((source, i) => (
                  <div className="source" key={source.id || i}>
                    <span className="source-n">[{source.ref ?? i + 1}]</span>
                    <span className="source-main">
                      <strong>{source.title}</strong>
                      <span className="muted">
                        {" "}· {source.project || "no project"} · {source.type}
                        {source.sourceFile ? ` · ${source.sourceFile}${source.sourceLine ? `:${source.sourceLine}` : ""}` : ""}
                      </span>
                    </span>
                    <span className={`pill ${source.matchedBy}`}>{source.matchedBy}</span>
                    <span className="score">{Math.round(source.score * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && <div className="msg ai"><div className="bubble typing">Searching your vault…</div></div>}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={(event) => { event.preventDefault(); send(question); }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your projects…" maxLength={1000} />
        <button className="btn primary" disabled={busy || !question.trim()}>Ask</button>
      </form>
    </div>
  );
}
