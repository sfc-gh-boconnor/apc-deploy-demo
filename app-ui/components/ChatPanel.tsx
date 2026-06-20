"use client"
import { useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type Message = {
  role: "user" | "assistant"
  content: string
  streaming?: boolean
  thinking?: string
  sql?: string
  tableData?: { columns: string[]; rows: Record<string, any>[] }
  suggestedQueries?: string[]
}

const SUGGESTED = [
  "Which products have the highest cost variance in FY2026?",
  "Why are Dunboyne PL03 costs escalating?",
  "What are the biggest cost anomalies this year?",
  "What does the forecast look like for high-variance products?",
  "Which plants have volume misalignment?",
  "Compare cost savings if we shift production from PL03 to PL05",
  "Show the confidence intervals for RX-1234 forecast",
  "Which therapeutic areas have the most anomalies?",
]

/* ─── Thinking Block (collapsible) ─── */

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <span className="thinking-icon">{open ? "▾" : "▸"}</span>
        <span className="thinking-label">Thinking</span>
        <span className="thinking-preview">{!open && text.length > 60 ? text.slice(0, 60) + "…" : ""}</span>
      </button>
      {open && (
        <div className="thinking-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

/* ─── SQL Block ─── */

function SqlBlock({ statement }: { statement: string }) {
  const [copied, setCopied] = useState(false)
  if (!statement) return null

  function handleCopy() {
    navigator.clipboard.writeText(statement)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="sql-block">
      <div className="sql-header">
        <span className="sql-label">Generated SQL</span>
        <button className="sql-copy" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="sql-code"><code>{statement}</code></pre>
    </div>
  )
}

/* ─── Table Result ─── */

function TableResult({ columns, rows }: { columns: string[]; rows: Record<string, any>[] }) {
  if (!rows || rows.length === 0) return null
  const cols = columns.length > 0 ? columns : Object.keys(rows[0] || {})
  const displayRows = rows.slice(0, 50)
  return (
    <div className="agent-table-wrap">
      <div className="agent-table-meta">{rows.length} row{rows.length !== 1 ? "s" : ""} returned</div>
      <div className="tool-table-wrap">
        <table className="tool-table">
          <thead>
            <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i}>
                {cols.map(c => <td key={c}>{formatCell(row[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && <div className="agent-table-meta">Showing first 50 of {rows.length} rows</div>}
    </div>
  )
}

function formatCell(val: any): string {
  if (val === null || val === undefined) return "—"
  if (typeof val === "number") return val.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return String(val)
}

/* ─── Message Bubble ─── */

function MessageBubble({ msg, onSuggestionClick }: { msg: Message; onSuggestionClick?: (q: string) => void }) {
  const showCursor = msg.streaming && msg.role === "assistant"

  return (
    <div className={`chat-msg ${msg.role}`}>
      <div className="chat-bubble">
        {msg.role === "assistant" ? (
          <>
            {msg.thinking && <ThinkingBlock text={msg.thinking} />}
            {msg.sql && <SqlBlock statement={msg.sql} />}
            {msg.tableData && <TableResult columns={msg.tableData.columns} rows={msg.tableData.rows} />}
            {msg.content && <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>}
            {showCursor && (
              <span style={{ display: "inline-block", width: 2, height: "1em", background: "var(--primary)", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
            )}
            {msg.suggestedQueries && msg.suggestedQueries.length > 0 && !msg.streaming && (
              <div className="suggested-follow-ups">
                {msg.suggestedQueries.map((q, i) => (
                  <button key={i} className="sq-btn sq-btn-inline" onClick={() => onSuggestionClick?.(q)}>{q}</button>
                ))}
              </div>
            )}
          </>
        ) : (
          msg.content
        )}
      </div>
    </div>
  )
}

/* ─── Main ChatPanel ─── */

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm your AI Product Costing assistant, powered by **Snowflake Cortex Agent** with real-time streaming and text-to-SQL.\n\nI can answer questions about cost variances, rate stability, volume alignment, anomalies, forecasts, and production rebalancing — all through natural language. Ask me anything about your SAP product cost data.",
    },
  ])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function sendChat(text?: string) {
    const q = (text ?? input).trim()
    if (!q || streaming) return
    setInput("")

    setMessages(m => [...m, { role: "user", content: q }])
    setMessages(m => [...m, { role: "assistant", content: "", streaming: true }])
    setStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: abort.signal,
      })

      const contentType = res.headers.get("Content-Type") ?? ""
      if (contentType.includes("application/json")) {
        const data = await res.json()
        setMessages(m => {
          const updated = [...m]
          updated[updated.length - 1] = { role: "assistant", content: data.answer ?? "Sorry, something went wrong." }
          return updated
        })
        return
      }

      // Real SSE stream from the Cortex Agent
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (payload === "[DONE]") {
            setMessages(m => {
              const updated = [...m]
              updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false }
              return updated
            })
            return
          }
          try {
            const event = JSON.parse(payload)
            setMessages(m => {
              const updated = [...m]
              const last = updated[updated.length - 1]

              switch (event.type) {
                case "thinking":
                  updated[updated.length - 1] = { ...last, thinking: (last.thinking || "") + event.text }
                  break
                case "text":
                  updated[updated.length - 1] = { ...last, content: last.content + event.text }
                  break
                case "sql":
                  updated[updated.length - 1] = { ...last, sql: (last.sql || "") + (last.sql ? "\n" : "") + event.statement }
                  break
                case "table":
                  updated[updated.length - 1] = { ...last, tableData: { columns: event.columns, rows: event.rows } }
                  break
                case "suggested_queries":
                  updated[updated.length - 1] = { ...last, suggestedQueries: event.queries }
                  break
                default:
                  if (event.token) {
                    updated[updated.length - 1] = { ...last, content: last.content + event.token }
                  }
              }
              return updated
            })
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return
      setMessages(m => {
        const updated = [...m]
        updated[updated.length - 1] = { role: "assistant", content: "Request failed. Please try again." }
        return updated
      })
    } finally {
      setStreaming(false)
      setMessages(m => {
        const updated = [...m]
        if (updated[updated.length - 1]?.streaming) {
          updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false }
        }
        return updated
      })
    }
  }

  return (
    <>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

        /* Thinking block */
        .thinking-block { margin-bottom:10px; border:1px solid var(--border); border-radius:6px; overflow:hidden; background:var(--surface) }
        .thinking-toggle { display:flex; align-items:center; gap:6px; width:100%; padding:8px 12px; border:none; background:none; cursor:pointer; text-align:left; font-size:.78rem; color:var(--text-muted) }
        .thinking-toggle:hover { background:var(--border) }
        .thinking-icon { font-size:.7rem; width:12px }
        .thinking-label { font-weight:600; color:var(--primary-dark) }
        .thinking-preview { font-style:italic; opacity:.7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 }
        .thinking-content { padding:8px 12px; border-top:1px solid var(--border); font-size:.78rem; color:var(--text-muted); max-height:300px; overflow-y:auto }
        .thinking-content p { margin:4px 0 }

        /* SQL block */
        .sql-block { margin-bottom:10px; border:1px solid var(--border); border-radius:6px; overflow:hidden }
        .sql-header { display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:var(--surface); border-bottom:1px solid var(--border) }
        .sql-label { font-size:.7rem; font-weight:700; color:#8b5cf6; text-transform:uppercase; letter-spacing:.5px }
        .sql-copy { font-size:.7rem; padding:2px 8px; border:1px solid var(--border); border-radius:4px; background:none; cursor:pointer; color:var(--text-muted) }
        .sql-copy:hover { border-color:var(--primary); color:var(--primary) }
        .sql-code { margin:0; padding:10px 12px; background:#0f172a; overflow-x:auto; font-size:.75rem; line-height:1.5; color:#e2e8f0 }
        .sql-code code { font-family:'JetBrains Mono',monospace }

        /* Table */
        .agent-table-wrap { margin-bottom:10px }
        .agent-table-meta { font-size:.7rem; color:var(--text-muted); padding:4px 0 }
        .tool-table-wrap { overflow-x:auto; margin-top:4px }
        .tool-table { width:100%; font-size:.75rem; border-collapse:collapse }
        .tool-table th { padding:6px 8px; text-align:left; border-bottom:1px solid var(--border); color:var(--text-muted); font-weight:600; white-space:nowrap }
        .tool-table td { padding:5px 8px; border-bottom:1px solid var(--border); white-space:nowrap }

        /* Suggested follow-ups */
        .suggested-follow-ups { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px }
        .sq-btn-inline { font-size:.72rem; padding:4px 10px; border:1px solid var(--border); border-radius:12px; background:var(--surface); cursor:pointer; color:var(--text); transition:all .15s }
        .sq-btn-inline:hover { border-color:var(--primary); color:var(--primary) }
      `}</style>

      <p className="section-lead">
        Ask questions about your SAP product cost data using natural language.
        Powered by <strong>Snowflake Cortex Agent</strong> with real-time streaming, text-to-SQL, and thinking transparency.
      </p>

      {/* Suggested questions */}
      <div className="suggested-questions">
        {SUGGESTED.map(q => (
          <button key={q} className="sq-btn" onClick={() => sendChat(q)} disabled={streaming}>{q}</button>
        ))}
      </div>

      <div className="chat-wrap">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} onSuggestionClick={sendChat} />
          ))}
          {streaming && !messages[messages.length - 1]?.content && !messages[messages.length - 1]?.thinking && (
            <div className="chat-msg assistant">
              <div className="chat-bubble" style={{ color: "var(--text-muted)" }}>
                Processing<span style={{ animation: "blink 1s step-end infinite" }}> ...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-footer">
          <input
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendChat()}
            placeholder="Ask about cost variances, anomalies, forecasts, rate stability, volume alignment…"
            disabled={streaming}
          />
          <button className="chat-send" onClick={() => sendChat()} disabled={streaming || !input.trim()}>
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </>
  )
}
