"use client"
import { useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts"
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps"

const WORLD_TOPO = "/countries-110m.json"

type Message = {
  role: "user" | "assistant"
  content: string
  streaming?: boolean
}

type MapPoint = { name: string; lat: number; lng: number; value: number; plant?: string }

type ChartSpec = {
  type: "bar" | "line" | "pie" | "map"
  title: string
  data: Array<{ name: string; value: number }> | MapPoint[]
}

const CHART_COLORS = ["var(--primary)", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1"]

const SUGGESTED = [
  "Which products have the highest cost variance this quarter?",
  "Show me the variance trend across all three periods",
  "What is the cost breakdown for RX-1234 by component?",
  "Which product has the highest gross margin?",
  "Compare budget vs actual costs across all manufacturing sites",
]

function varColor(v: number) {
  if (v > 8) return "#ef4444"
  if (v > 5) return "#f59e0b"
  if (v < -1) return "#10b981"
  return "#29b5e8"
}

function MapChart({ chart }: { chart: ChartSpec }) {
  const points = chart.data as MapPoint[]
  const maxAbs = Math.max(...points.map(p => Math.abs(p.value)), 1)
  return (
    <div style={{ marginTop: 14, background: "#0d2b45", borderRadius: 8, padding: "14px 16px", overflow: "hidden" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#29b5e8", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".6px" }}>
        {chart.title}
      </div>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 110, center: [15, 25] }}
        style={{ width: "100%", height: 300 }}
      >
        <ZoomableGroup zoom={1}>
          <Geographies geography={WORLD_TOPO}>
            {({ geographies }: any) =>
              geographies.map((geo: any) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#1a3f5c"
                  stroke="#0d2b45"
                  strokeWidth={0.4}
                  style={{
                    default: { outline: "none" },
                    hover:   { fill: "#1e5070", outline: "none" },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>
          {points.map((p, i) => {
            const r = 7 + (Math.abs(p.value) / maxAbs) * 11
            const color = varColor(p.value)
            return (
              <Marker key={i} coordinates={[p.lng, p.lat]}>
                <circle r={r + 3} fill={color} opacity={0.2} />
                <circle r={r} fill={color} stroke="white" strokeWidth={1.5} opacity={0.9} />
                <text textAnchor="middle" y={-r - 5}
                  style={{ fontFamily: "system-ui", fontSize: 10, fontWeight: 700, fill: "white", pointerEvents: "none" }}>
                  {p.plant ?? p.name.split(" ")[0]}
                </text>
                <text textAnchor="middle" y={r + 14}
                  style={{ fontFamily: "system-ui", fontSize: 9, fill: color, pointerEvents: "none" }}>
                  {p.value > 0 ? "+" : ""}{p.value}%
                </text>
              </Marker>
            )
          })}
        </ZoomableGroup>
      </ComposableMap>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {points.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: varColor(p.value), display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: ".72rem", color: "#94a3b8" }}>
              {p.name}: <strong style={{ color: varColor(p.value) }}>{p.value > 0 ? "+" : ""}{p.value}%</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Parse a <chart> block from the AI response. Returns text and optional chart spec. */
function parseMessage(content: string): { text: string; chart: ChartSpec | null } {
  const match = content.match(/<chart\s+type="(\w+)"\s+title="([^"]+)">\s*([\s\S]*?)\s*<\/chart>/)
  if (!match) return { text: content, chart: null }
  const [full, type, title, jsonStr] = match
  try {
    const data = JSON.parse(jsonStr)
    if (!Array.isArray(data)) return { text: content, chart: null }
    return {
      text: content.replace(full, "").trim(),
      chart: { type: type as ChartSpec["type"], title, data },
    }
  } catch {
    return { text: content.replace(full, "").trim(), chart: null }
  }
}

function InlineChart({ chart }: { chart: ChartSpec }) {
  if (chart.type === "map") return <MapChart chart={chart} />
  return (
    <div style={{
      marginTop: 14, background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "14px 16px",
    }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--primary-dark)", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".6px" }}>
        {chart.title}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        {chart.type === "pie" ? (
          <PieChart>
            <Pie data={chart.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name}: ${value}`}>
              {chart.data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : chart.type === "line" ? (
          <LineChart data={chart.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        ) : (
          <BarChart data={chart.data} margin={{ top: 4, right: 16, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chart.data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const { text, chart } = parseMessage(msg.content)
  const showCursor = msg.streaming && msg.role === "assistant"

  return (
    <div className={`chat-msg ${msg.role}`}>
      <div className="chat-bubble">
        {msg.role === "assistant" ? (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            {showCursor && (
              <span style={{ display: "inline-block", width: 2, height: "1em", background: "var(--primary)", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
            )}
            {chart && !msg.streaming && <InlineChart chart={chart} />}
          </>
        ) : (
          msg.content
        )}
      </div>
    </div>
  )
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm your AI Product Costing assistant, powered by Snowflake Cortex AI.\n\nI have access to your SAP BDC cost data — standard prices (MBEW.STPRS), actual costs (CKMLCR.PVPRS), cost components, and gross margin from SD billing. Ask me anything about cost variances, manufacturing site performance, or product profitability.",
    },
  ])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || streaming) return
    setInput("")

    // Add user message
    setMessages(m => [...m, { role: "user", content: q }])
    // Add empty assistant message to stream into
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

      // Handle non-streaming fallback (error case returns JSON)
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

      // Read SSE stream
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
            // Mark streaming complete (reveals chart if present)
            setMessages(m => {
              const updated = [...m]
              updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false }
              return updated
            })
            return
          }
          try {
            const { token } = JSON.parse(payload)
            setMessages(m => {
              const updated = [...m]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = { ...last, content: last.content + token }
              return updated
            })
          } catch { /* malformed chunk, skip */ }
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
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      <p className="section-lead">
        Ask questions about your SAP product cost and profitability data in plain English.
        Powered by <strong>Snowflake Cortex AI (Claude)</strong> — answers are grounded in SAP BDC cost data and SD billing margins.
      </p>

      <div className="suggested-questions">
        {SUGGESTED.map(q => (
          <button key={q} className="sq-btn" onClick={() => send(q)} disabled={streaming}>{q}</button>
        ))}
      </div>

      <div className="chat-wrap">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {streaming && !messages[messages.length - 1]?.content && (
            <div className="chat-msg assistant">
              <div className="chat-bubble" style={{ color: "var(--text-muted)" }}>
                Querying SAP cost data
                <span style={{ animation: "blink 1s step-end infinite" }}> ▋</span>
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
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask about cost variances, site performance, gross margins…"
            disabled={streaming}
          />
          <button className="chat-send" onClick={() => send()} disabled={streaming || !input.trim()}>
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </>
  )
}
