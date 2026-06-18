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
  toolResult?: any
  toolType?: ToolMode
}

type MapPoint = { name: string; lat: number; lng: number; value: number; plant?: string }

type ChartSpec = {
  type: "bar" | "line" | "pie" | "map"
  title: string
  data: Array<{ name: string; value: number }> | MapPoint[]
}

type ToolMode = "ask" | "forecast" | "anomaly" | "scenario" | "reconcile"

const TOOL_OPTIONS: { value: ToolMode; label: string; description: string }[] = [
  { value: "ask", label: "Ask a question", description: "Natural language Q&A powered by Cortex AI" },
  { value: "forecast", label: "Run forecast", description: "ML-powered cost forecast with confidence intervals" },
  { value: "anomaly", label: "Detect anomalies", description: "Find cost anomalies with z-scores and component attribution" },
  { value: "scenario", label: "What-if scenario", description: "Cost impact simulation with volume rebalancing" },
  { value: "reconcile", label: "Reconcile", description: "Full root-cause decomposition ranked by financial impact" },
]

const CHART_COLORS = ["var(--primary)", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1"]

const SUGGESTED = [
  "Why are Dunboyne PL03 costs escalating?",
  "Which plants have volume misalignment?",
  "Which therapeutic areas are seeing cost escalation?",
  "Which products have the highest cost variance?",
  "Compare COGM trajectory across all sites",
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

/* ─── Tool Result Renderers ─── */

function ForecastResult({ data }: { data: any }) {
  if (!data || data.error) return <div className="tool-error">{data?.error || "No data"}</div>
  const { forecast, summary } = data
  const chartData = (forecast || []).slice(0, 12).map((r: any) => ({
    name: r.MATERIAL_NUMBER,
    value: r.AVG_ACTUAL_COST,
  }))
  return (
    <div className="tool-result">
      <div className="tool-summary">
        <strong>Forecast Summary</strong>: {summary.materialsIncluded} materials, trend {summary.direction} ({summary.avgTrend3M}% 3M avg), volatility {summary.avgVolatility6M}%
      </div>
      {chartData.length > 0 && (
        <InlineChart chart={{ type: "bar", title: "Forecast: Avg Actual Cost by Product", data: chartData }} />
      )}
      {forecast && forecast.length > 0 && (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <thead><tr><th>Material</th><th>Cost</th><th>Lower</th><th>Upper</th><th>Trend 3M</th></tr></thead>
            <tbody>
              {forecast.slice(0, 8).map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.MATERIAL_NUMBER}</td>
                  <td>${r.AVG_ACTUAL_COST}</td>
                  <td>${r.LOWER_BOUND}</td>
                  <td>${r.UPPER_BOUND}</td>
                  <td style={{ color: r.COST_TREND_3M > 0 ? "#ef4444" : "#10b981" }}>{(r.COST_TREND_3M * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AnomalyResult({ data }: { data: any }) {
  if (!data || data.error) return <div className="tool-error">{data?.error || "No data"}</div>
  const { anomalies, summary } = data
  return (
    <div className="tool-result">
      <div className="tool-summary">
        <strong>{summary.totalFlagged} anomalies</strong> flagged (avg |z| = {summary.avgAbsZScore}, threshold = {summary.threshold}).
        Top drivers: {summary.topCostDrivers?.join(", ") || "N/A"}
      </div>
      {anomalies && anomalies.length > 0 && (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <thead><tr><th>Material</th><th>Plant</th><th>Period</th><th>Z-Score</th><th>Actual</th><th>Expected</th><th>Driver</th></tr></thead>
            <tbody>
              {anomalies.slice(0, 10).map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.MATERIAL_NUMBER}</td>
                  <td>{r.PLANT_NAME}</td>
                  <td>P{String(r.PERIOD).padStart(3, "0")}</td>
                  <td style={{ color: Math.abs(r.Z_SCORE) > 3 ? "#ef4444" : "#f59e0b" }}>{r.Z_SCORE}</td>
                  <td>${r.ACTUAL_COST}</td>
                  <td>${r.EXPECTED_COST}</td>
                  <td>{r.COST_DRIVER || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ScenarioResult({ data }: { data: any }) {
  if (!data || data.error) return <div className="tool-error">{data?.error || "No data"}</div>
  const { products, summary, volumeRebalancing } = data
  const chartData = (products || []).slice(0, 8).map((r: any) => ({
    name: r.MATERIAL_NUMBER,
    value: r.COST_IMPACT,
  }))
  return (
    <div className="tool-result">
      <div className="tool-summary">
        <strong>Scenario Impact</strong>: Variance shift {summary.varianceShift > 0 ? "+" : ""}{summary.varianceShift}%, total cost impact ${summary.totalCostImpact}/unit
      </div>
      {summary.recommendations?.map((r: string, i: number) => (
        <div key={i} className="tool-recommendation">{r}</div>
      ))}
      {chartData.length > 0 && (
        <InlineChart chart={{ type: "bar", title: "Cost Impact by Product ($/unit)", data: chartData }} />
      )}
      {volumeRebalancing && (
        <div className="tool-rebalance">
          <strong>Volume Rebalancing ({volumeRebalancing.fromPlant} → {volumeRebalancing.toPlant})</strong>: Avg savings ${volumeRebalancing.totalSavingsPerUnit}/unit ({volumeRebalancing.avgSavingsPct}%)
        </div>
      )}
    </div>
  )
}

function ReconcileResult({ data }: { data: any }) {
  if (!data || data.error) return <div className="tool-error">{data?.error || "No data"}</div>
  const { rootCauses, summary, cogmTrajectory } = data
  const chartData = (rootCauses || []).slice(0, 8).map((r: any) => ({
    name: r.driver.length > 20 ? r.driver.slice(0, 18) + "…" : r.driver,
    value: Math.abs(r.impact),
  }))
  return (
    <div className="tool-result">
      <div className="tool-summary">
        <strong>{summary.totalRootCauses} root causes</strong> identified. Top: {summary.topCategory} — {summary.topDriver} (${summary.topImpact} impact). COGM trend: {summary.cogmTrend}.
      </div>
      {chartData.length > 0 && (
        <InlineChart chart={{ type: "bar", title: "Root Causes by Financial Impact ($)", data: chartData }} />
      )}
      {rootCauses && rootCauses.length > 0 && (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <thead><tr><th>#</th><th>Category</th><th>Driver</th><th>Impact</th><th>Detail</th></tr></thead>
            <tbody>
              {rootCauses.slice(0, 10).map((r: any, i: number) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><span className={`tag tag-${r.category.toLowerCase().replace(/\s/g, "-")}`}>{r.category}</span></td>
                  <td>{r.driver}</td>
                  <td style={{ color: r.impact > 0 ? "#ef4444" : "#10b981" }}>${r.impact.toFixed(2)}</td>
                  <td className="td-detail">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ToolResultRenderer({ msg }: { msg: Message }) {
  if (!msg.toolResult) return null
  switch (msg.toolType) {
    case "forecast": return <ForecastResult data={msg.toolResult} />
    case "anomaly": return <AnomalyResult data={msg.toolResult} />
    case "scenario": return <ScenarioResult data={msg.toolResult} />
    case "reconcile": return <ReconcileResult data={msg.toolResult} />
    default: return null
  }
}

function MessageBubble({ msg }: { msg: Message }) {
  const { text, chart } = parseMessage(msg.content)
  const showCursor = msg.streaming && msg.role === "assistant"

  return (
    <div className={`chat-msg ${msg.role}`}>
      <div className="chat-bubble">
        {msg.role === "assistant" ? (
          <>
            {text && <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>}
            {showCursor && (
              <span style={{ display: "inline-block", width: 2, height: "1em", background: "var(--primary)", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
            )}
            {chart && !msg.streaming && <InlineChart chart={chart} />}
            {msg.toolResult && <ToolResultRenderer msg={msg} />}
          </>
        ) : (
          msg.content
        )}
      </div>
    </div>
  )
}

/* ─── Tool Parameter Panels ─── */

function ForecastParams({ onRun, disabled }: { onRun: (p: any) => void; disabled: boolean }) {
  const [material, setMaterial] = useState("")
  const [periods, setPeriods] = useState("6")
  return (
    <div className="tool-params">
      <label>Material (optional) <input value={material} onChange={e => setMaterial(e.target.value)} placeholder="e.g. RX-1234" /></label>
      <label>Periods ahead <input type="number" value={periods} onChange={e => setPeriods(e.target.value)} min="1" max="12" /></label>
      <button className="tool-run-btn" disabled={disabled} onClick={() => onRun({ material_number: material || undefined, periods_ahead: periods })}>Run Forecast</button>
    </div>
  )
}

function AnomalyParams({ onRun, disabled }: { onRun: (p: any) => void; disabled: boolean }) {
  const [material, setMaterial] = useState("")
  const [plant, setPlant] = useState("")
  const [threshold, setThreshold] = useState("2.0")
  return (
    <div className="tool-params">
      <label>Material <input value={material} onChange={e => setMaterial(e.target.value)} placeholder="optional" /></label>
      <label>Plant code <input value={plant} onChange={e => setPlant(e.target.value)} placeholder="e.g. PL03" /></label>
      <label>Z-score threshold <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} step="0.5" min="1" max="5" /></label>
      <button className="tool-run-btn" disabled={disabled} onClick={() => onRun({ material_number: material || undefined, plant_code: plant || undefined, threshold })}>Detect Anomalies</button>
    </div>
  )
}

function ScenarioParams({ onRun, disabled }: { onRun: (p: any) => void; disabled: boolean }) {
  const [apiPct, setApiPct] = useState("0")
  const [energyPct, setEnergyPct] = useState("0")
  const [labourPct, setLabourPct] = useState("0")
  const [fxPct, setFxPct] = useState("0")
  const [volumeMult, setVolumeMult] = useState("1.0")
  const [shiftFrom, setShiftFrom] = useState("")
  const [shiftTo, setShiftTo] = useState("")
  return (
    <div className="tool-params">
      <div className="tool-params-grid">
        <label>API % <input type="number" value={apiPct} onChange={e => setApiPct(e.target.value)} step="5" /></label>
        <label>Energy % <input type="number" value={energyPct} onChange={e => setEnergyPct(e.target.value)} step="5" /></label>
        <label>Labour % <input type="number" value={labourPct} onChange={e => setLabourPct(e.target.value)} step="5" /></label>
        <label>FX % <input type="number" value={fxPct} onChange={e => setFxPct(e.target.value)} step="2" /></label>
        <label>Volume mult <input type="number" value={volumeMult} onChange={e => setVolumeMult(e.target.value)} step="0.1" min="0.5" max="2" /></label>
      </div>
      <div className="tool-params-row">
        <label>Shift from <input value={shiftFrom} onChange={e => setShiftFrom(e.target.value)} placeholder="e.g. PL03" /></label>
        <label>Shift to <input value={shiftTo} onChange={e => setShiftTo(e.target.value)} placeholder="e.g. PL05" /></label>
      </div>
      <button className="tool-run-btn" disabled={disabled} onClick={() => onRun({
        api_pct: apiPct, energy_pct: energyPct, labour_pct: labourPct, fx_pct: fxPct,
        volume_mult: volumeMult, shift_plant_from: shiftFrom || undefined, shift_plant_to: shiftTo || undefined,
      })}>Run Scenario</button>
    </div>
  )
}

function ReconcileParams({ onRun, disabled }: { onRun: (p: any) => void; disabled: boolean }) {
  const [material, setMaterial] = useState("")
  const [plant, setPlant] = useState("")
  const [period, setPeriod] = useState("")
  return (
    <div className="tool-params">
      <label>Material <input value={material} onChange={e => setMaterial(e.target.value)} placeholder="optional" /></label>
      <label>Plant code <input value={plant} onChange={e => setPlant(e.target.value)} placeholder="optional" /></label>
      <label>Period <input type="number" value={period} onChange={e => setPeriod(e.target.value)} placeholder="1-6" min="1" max="6" /></label>
      <button className="tool-run-btn" disabled={disabled} onClick={() => onRun({ material_number: material || undefined, plant_code: plant || undefined, period: period || undefined })}>Reconcile</button>
    </div>
  )
}

/* ─── Main ChatPanel ─── */

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm your AI Product Costing reconciliation assistant, powered by Snowflake Cortex AI.\n\nI can answer questions about cost variances, run ML forecasts, detect anomalies, simulate what-if scenarios, and perform full reconciliation decompositions. Use the tool selector below to switch modes.",
    },
  ])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [activeTool, setActiveTool] = useState<ToolMode>("ask")
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
            const { token } = JSON.parse(payload)
            setMessages(m => {
              const updated = [...m]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = { ...last, content: last.content + token }
              return updated
            })
          } catch { /* skip */ }
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

  async function runTool(params: Record<string, any>) {
    if (streaming) return
    setStreaming(true)

    const toolLabel = TOOL_OPTIONS.find(t => t.value === activeTool)?.label || activeTool
    const paramStr = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(", ")
    setMessages(m => [...m, { role: "user", content: `[${toolLabel}] ${paramStr || "default parameters"}` }])
    setMessages(m => [...m, { role: "assistant", content: `Running ${toolLabel}...`, streaming: true, toolType: activeTool }])

    try {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") qs.set(k, String(v))
      }
      const res = await fetch(`/api/agent/${activeTool}?${qs.toString()}`)
      const data = await res.json()

      setMessages(m => {
        const updated = [...m]
        const summaryText = data.error
          ? `Error: ${data.error}`
          : `${toolLabel} completed successfully.`
        updated[updated.length - 1] = {
          role: "assistant",
          content: summaryText,
          streaming: false,
          toolResult: data,
          toolType: activeTool,
        }
        return updated
      })
    } catch (e: any) {
      setMessages(m => {
        const updated = [...m]
        updated[updated.length - 1] = { role: "assistant", content: `Tool execution failed: ${e?.message || "unknown error"}` }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        .tool-selector { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px }
        .tool-selector button { padding:6px 12px; border-radius:6px; border:1px solid var(--border); background:var(--surface); font-size:.78rem; cursor:pointer; transition:all .15s }
        .tool-selector button:hover { border-color:var(--primary) }
        .tool-selector button.active { background:var(--primary); color:white; border-color:var(--primary) }
        .tool-params { display:flex; flex-direction:column; gap:8px; padding:12px; background:var(--surface); border:1px solid var(--border); border-radius:8px; margin-bottom:12px }
        .tool-params label { display:flex; flex-direction:column; gap:3px; font-size:.75rem; color:var(--text-muted) }
        .tool-params input { padding:6px 10px; border:1px solid var(--border); border-radius:5px; font-size:.82rem; background:var(--bg); color:var(--text) }
        .tool-params-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:8px }
        .tool-params-row { display:flex; gap:8px }
        .tool-params-row label { flex:1 }
        .tool-run-btn { padding:8px 16px; background:var(--primary); color:white; border:none; border-radius:6px; font-size:.82rem; cursor:pointer; align-self:flex-start; margin-top:4px }
        .tool-run-btn:disabled { opacity:.5; cursor:not-allowed }
        .tool-result { margin-top:10px }
        .tool-summary { font-size:.82rem; padding:8px 12px; background:var(--surface); border-left:3px solid var(--primary); border-radius:4px; margin-bottom:8px }
        .tool-error { color:#ef4444; font-size:.82rem }
        .tool-recommendation { font-size:.78rem; padding:4px 10px; background:#10b98115; border-left:2px solid #10b981; border-radius:3px; margin:4px 0; color:#10b981 }
        .tool-rebalance { font-size:.8rem; padding:8px 12px; background:#8b5cf615; border-left:3px solid #8b5cf6; border-radius:4px; margin-top:8px }
        .tool-table-wrap { overflow-x:auto; margin-top:8px }
        .tool-table { width:100%; font-size:.75rem; border-collapse:collapse }
        .tool-table th { padding:6px 8px; text-align:left; border-bottom:1px solid var(--border); color:var(--text-muted); font-weight:600; white-space:nowrap }
        .tool-table td { padding:5px 8px; border-bottom:1px solid var(--border); white-space:nowrap }
        .td-detail { white-space:normal; max-width:200px; font-size:.72rem; color:var(--text-muted) }
        .tag { font-size:.68rem; padding:2px 6px; border-radius:3px; font-weight:600 }
        .tag-rate-stability { background:#f59e0b20; color:#f59e0b }
        .tag-volume-alignment { background:#8b5cf620; color:#8b5cf6 }
        .tag-component-driver { background:#29b5e820; color:#29b5e8 }
      `}</style>

      <p className="section-lead">
        Ask questions about your SAP product cost data or use specialized tools for forecasting, anomaly detection, scenarios, and reconciliation.
        Powered by <strong>Snowflake Cortex AI</strong> — grounded in the APC reconciliation semantic view.
      </p>

      {/* Tool Selector */}
      <div className="tool-selector">
        {TOOL_OPTIONS.map(t => (
          <button
            key={t.value}
            className={activeTool === t.value ? "active" : ""}
            onClick={() => setActiveTool(t.value)}
            title={t.description}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tool-specific parameter panels */}
      {activeTool === "forecast" && <ForecastParams onRun={runTool} disabled={streaming} />}
      {activeTool === "anomaly" && <AnomalyParams onRun={runTool} disabled={streaming} />}
      {activeTool === "scenario" && <ScenarioParams onRun={runTool} disabled={streaming} />}
      {activeTool === "reconcile" && <ReconcileParams onRun={runTool} disabled={streaming} />}

      {/* Suggested questions (only in ask mode) */}
      {activeTool === "ask" && (
        <div className="suggested-questions">
          {SUGGESTED.map(q => (
            <button key={q} className="sq-btn" onClick={() => sendChat(q)} disabled={streaming}>{q}</button>
          ))}
        </div>
      )}

      <div className="chat-wrap">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {streaming && !messages[messages.length - 1]?.content && (
            <div className="chat-msg assistant">
              <div className="chat-bubble" style={{ color: "var(--text-muted)" }}>
                Processing
                <span style={{ animation: "blink 1s step-end infinite" }}> ...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {activeTool === "ask" && (
          <div className="chat-footer">
            <input
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendChat()}
              placeholder="Ask about cost variances, rate stability, volume alignment, reconciliation…"
              disabled={streaming}
            />
            <button className="chat-send" onClick={() => sendChat()} disabled={streaming || !input.trim()}>
              {streaming ? "…" : "Send"}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
