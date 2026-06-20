"use client"
import { useEffect, useState, useRef, useCallback } from "react"
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, BarChart, Bar, Cell,
} from "recharts"
import ReactMarkdown from "react-markdown"

type Row = Record<string, any>

const RISK_COLOR: Record<string, string> = {
  HIGH:   "var(--danger)",
  MEDIUM: "var(--warning)",
  LOW:    "var(--success)",
}

const RISK_BG: Record<string, string> = {
  HIGH:   "#fef2f2",
  MEDIUM: "#fffbeb",
  LOW:    "#f0fdf4",
}

export function SmartInsightsPanel() {
  const [forecastData, setForecastData] = useState<Row[]>([])
  const [riskScores, setRiskScores]     = useState<Row[]>([])
  const [anomalies, setAnomalies]       = useState<Row[]>([])
  const [kpis, setKpis]                 = useState<any>({})
  const [loading, setLoading]           = useState(true)
  const [reco, setReco]                 = useState("")
  const [recoStreaming, setRecoStreaming] = useState(false)
  const [recoLoaded, setRecoLoaded]     = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [scenarios, setScenarios]       = useState<Row[]>([])
  const [selectedScenario, setSelectedScenario] = useState("")
  const [scenarioForecast, setScenarioForecast] = useState<any>(null)

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch("/api/insights/forecast").then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() }),
      fetch("/api/insights/anomalies").then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() }),
      fetch("/api/scenarios").then(r => r.json()),
    ]).then(([f, a, s]) => {
      const trend = (f.trend ?? []).map((r: any, idx: number, arr: any[]) => {
        const actual   = r.ACTUAL_VARIANCE   !== null ? parseFloat(r.ACTUAL_VARIANCE)   : null
        const forecast = r.FORECAST_VARIANCE !== null ? parseFloat(r.FORECAST_VARIANCE) : null
        // Bridge: last actual point also becomes the starting value for the forecast line
        const isLastActual = actual !== null && (idx === arr.length - 1 || (arr[idx + 1] as any)?.DATA_TYPE === 'forecast')
        return ({
          period:   r.PERIOD_LABEL,
          actual,
          forecast: forecast ?? (isLastActual ? actual : null),
          lower:    r.FORECAST_LOWER  !== null ? parseFloat(r.FORECAST_LOWER)  : (isLastActual ? actual : null),
          upper:    r.FORECAST_UPPER  !== null ? parseFloat(r.FORECAST_UPPER)  : (isLastActual ? actual : null),
          type:     r.DATA_TYPE,
        })
      })
      setForecastData(trend)
      setRiskScores(f.riskScores ?? [])
      setKpis(f.kpis ?? {})
      setAnomalies(a.rows ?? [])
      setScenarios(s.scenarios?.filter((sc: Row) => !sc.IS_BASE) ?? [])
    }).catch(e => {
      setError("Session expired. Please refresh the page to reconnect.")
    }).finally(() => setLoading(false))
  }, [])

  // Fetch scenario forecast when scenario changes
  useEffect(() => {
    if (!selectedScenario) { setScenarioForecast(null); return }
    const s = scenarios.find(sc => sc.SCENARIO_NAME === selectedScenario)
    if (!s) return
    fetch(`/api/scenarios/forecast?api_pct=${s.API_COST_CHANGE_PCT}&energy_pct=${s.ENERGY_COST_CHANGE_PCT}&volume_mult=${s.VOLUME_MULTIPLIER}&labour_pct=${s.LABOUR_COST_CHANGE_PCT}&fx_pct=${s.FX_ADJUSTMENT_PCT}`)
      .then(r => r.json())
      .then(d => setScenarioForecast(d.summary ?? null))
      .catch(() => setScenarioForecast(null))
  }, [selectedScenario, scenarios])

  const loadRecommendations = useCallback(async () => {
    if (recoStreaming || recoLoaded) return
    setRecoStreaming(true)
    setReco("")
    try {
      const res = await fetch("/api/insights/recommendations")
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
          if (payload === "[DONE]") { setRecoLoaded(true); setRecoStreaming(false); return }
          try { const { token } = JSON.parse(payload); setReco(r => r + token) } catch {}
        }
      }
    } finally {
      setRecoStreaming(false)
    }
  }, [recoStreaming, recoLoaded])

  if (loading) return <div className="loading">Loading Snowflake ML insights…</div>
  if (error) return (
    <div className="error-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span>{error}</span>
      <button onClick={() => window.location.reload()} style={{ marginLeft: 16, padding: "6px 14px", background: "var(--danger)", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: ".8rem" }}>
        Refresh Page
      </button>
    </div>
  )

  const p004 = kpis.p004Forecast ?? 0
  const p004Upper = kpis.p004Upper ?? 0
  const highRisk  = kpis.highRisk  ?? 0
  const medRisk   = kpis.medRisk   ?? 0

  // Chart data: actual line + forecast line + confidence band + scenario line
  const varianceShift = scenarioForecast?.varianceShift ?? 0
  const bandData = forecastData.map(r => ({
    ...r,
    band: r.lower != null && r.upper != null ? [r.lower, r.upper] : null,
    scenarioForecast: r.type === "forecast" && selectedScenario && r.forecast != null
      ? r.forecast + varianceShift
      : (r.type === "actual" && r.forecast != null && selectedScenario ? r.forecast : null),
  }))

  return (
    <>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      <p className="section-lead">
            Powered by <strong>Snowflake Model Registry</strong> — COST_VARIANCE_FORECAST_MODEL trained on Feature Store data (30 periods).
        Anomaly detection uses z-score statistical analysis across all cost components.
        Recommendations generated by <strong>Snowflake Cortex AI</strong>.
      </p>

      {/* KPI row */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">ML Forecast — next period (P007)</div>
          <div className={`kpi-value ${p004 > 5 ? "danger" : p004 > 3 ? "warning" : "success"}`}>
            +{p004.toFixed(1)}%
          </div>
          <div className="kpi-sub">Portfolio avg variance (upper: +{p004Upper.toFixed(1)}%)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">High Risk Products</div>
          <div className={`kpi-value ${highRisk > 3 ? "danger" : "warning"}`}>{highRisk}</div>
          <div className="kpi-sub">Predicted to exceed 5% next period</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Medium Risk Products</div>
          <div className="kpi-value warning">{medRisk}</div>
          <div className="kpi-sub">Variance trending upward</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Anomalies Flagged</div>
          <div className={`kpi-value ${anomalies.length > 5 ? "danger" : "warning"}`}>{anomalies.length}</div>
          <div className="kpi-sub">Cost components z-score &gt; 1.5</div>
        </div>
      </div>

      {/* Forecast chart */}
      <div className="card">
        <div className="card-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="card-title">Cost Variance Forecast — P001 to P006</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
            Model Registry (XGBoost) · Shaded = 95% confidence band
          </span>
          <select
            value={selectedScenario}
            onChange={e => setSelectedScenario(e.target.value)}
            style={{ marginLeft: "auto", fontSize: ".75rem", padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)" }}
          >
            <option value="">No scenario</option>
            {scenarios.map(s => <option key={s.SCENARIO_NAME} value={s.SCENARIO_NAME}>{s.SCENARIO_NAME}</option>)}
          </select>
        </div>
        {scenarioForecast && (
          <div style={{ padding: "8px 16px", background: "#fffbeb", borderBottom: "1px solid var(--border)", display: "flex", gap: 24, fontSize: ".78rem" }}>
            <span><strong>{selectedScenario}:</strong> Variance shifts from <strong>{scenarioForecast.baseVariance}%</strong> → <strong>{scenarioForecast.scenarioVariance}%</strong></span>
            <span style={{ color: "var(--danger)" }}>+{scenarioForecast.varianceShift} pp</span>
            <span>Cost impact: <strong>${scenarioForecast.totalCostImpact.toFixed(2)}/unit</strong></span>
          </div>
        )}
        <div className="card-body">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={bandData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v: any, name: string) => {
                if (v == null) return [null, name]
                return [`${parseFloat(v).toFixed(2)}%`, name]
              }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine x="P003" stroke="var(--text-muted)" strokeDasharray="4 4"
                label={{ value: "← Actual | Forecast →", position: "insideTopRight", fontSize: 10, fill: "var(--text-muted)" }} />
              {/* Confidence band */}
              <Area type="monotone" dataKey="upper" stroke="none" fill="var(--primary)" fillOpacity={0.12}
                name="Upper bound" legendType="none" connectNulls />
              <Area type="monotone" dataKey="lower" stroke="none" fill="white" fillOpacity={1}
                name="Lower bound" legendType="none" connectNulls />
              {/* Actual line */}
              <Line type="monotone" dataKey="actual" stroke="var(--primary)" strokeWidth={2.5}
                dot={{ r: 5 }} name="Actual variance" connectNulls />
              {/* Forecast line (dashed) */}
              <Line type="monotone" dataKey="forecast" stroke="var(--warning)" strokeWidth={2.5}
                strokeDasharray="5 4" dot={{ r: 5 }} name="ML forecast" connectNulls />
              {selectedScenario && <Line type="monotone" dataKey="scenarioForecast" stroke="#ef4444" strokeWidth={2.5}
                strokeDasharray="4 2" dot={false} name={`${selectedScenario}`} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Risk scores + Anomalies side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Product risk scores */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Product Risk Scores — next-period estimate</span>
            <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Linear extrapolation from trend slope</span>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={riskScores.slice(0, 8).map((r: any) => ({
                product: r.MATERIAL_NUMBER.replace("-FIN", ""),
                p004:    parseFloat(r.ESTIMATED_P004),
                risk:    r.RISK_LEVEL,
              }))} layout="vertical" margin={{ left: 55 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="product" tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v: any) => [`${parseFloat(v).toFixed(1)}%`, "Est. next-period variance"]} />
                <ReferenceLine x={5} stroke="var(--danger)" strokeDasharray="4 4"
                  label={{ value: "5% threshold", position: "top", fontSize: 9, fill: "var(--danger)" }} />
                <Bar dataKey="p004" name="Est. next-period variance" radius={[0, 4, 4, 0]}>
                  {riskScores.slice(0, 8).map((r: any, i: number) => (
                    <Cell key={i} fill={RISK_COLOR[r.RISK_LEVEL] ?? "var(--primary)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Anomaly flags */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Statistical Anomalies — Cost Components</span>
            <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Z-score &gt; 1.5 flagged</span>
          </div>
          <div className="card-body" style={{ maxHeight: 260, overflowY: "auto" }}>
            {anomalies.slice(0, 8).map((r: any, i: number) => {
              const zscore = parseFloat(r.Z_SCORE)
              const severity = Math.abs(zscore) > 2 ? "HIGH" : "MEDIUM"
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 0", borderBottom: i < 7 ? "1px solid var(--border)" : "none",
                }}>
                  <span style={{
                    fontSize: ".62rem", fontWeight: 700, padding: "2px 7px",
                    borderRadius: 10, background: RISK_BG[severity], color: RISK_COLOR[severity],
                    whiteSpace: "nowrap", marginTop: 2,
                  }}>
                    {severity}
                  </span>
                  <div>
                    <div style={{ fontSize: ".8rem", fontWeight: 600, color: "var(--primary-dark)" }}>
                      {r.MATERIAL_NUMBER.replace("-FIN","").replace("-API","")} — {r.COST_COMPONENT}
                    </div>
                    <div style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
                      P{r.PERIOD}: {r.VARIANCE_PCT > 0 ? "+" : ""}{r.VARIANCE_PCT}% variance · z-score {r.Z_SCORE}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* AI Recommendations — streams in on demand */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">AI Recommendations — Snowflake Cortex</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
              Based on ML forecast + anomaly detection outputs
            </span>
            {!recoLoaded && !recoStreaming && (
              <button
                onClick={loadRecommendations}
                style={{
                  padding: "5px 14px", background: "var(--primary)", color: "white",
                  border: "none", borderRadius: 8, fontSize: ".75rem", fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Generate Recommendations ▶
              </button>
            )}
            {recoStreaming && (
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Analysing ML outputs…</span>
            )}
          </div>
        </div>
        <div className="card-body">
          {!reco && !recoStreaming && (
            <div className="loading" style={{ textAlign: "left", padding: "12px 0" }}>
              Click "Generate Recommendations" to let Cortex AI analyse the forecast and anomaly data and produce actionable Finance recommendations.
            </div>
          )}
          {(reco || recoStreaming) && (
            <div style={{ fontSize: ".88rem", lineHeight: 1.7, color: "var(--text)" }}>
              <ReactMarkdown>{reco}</ReactMarkdown>
              {recoStreaming && (
                <span style={{ display: "inline-block", width: 2, height: "1.1em", background: "var(--primary)", marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </>
  )
}
