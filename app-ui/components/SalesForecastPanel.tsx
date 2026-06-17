"use client"
import { useEffect, useState } from "react"
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, BarChart, Bar, Cell,
} from "recharts"

type Row = Record<string, any>

const PRODUCTS = [
  "RX-1234-FIN", "RX-2891-FIN", "RX-3312-FIN", "RX-4567-FIN", "RX-5521-FIN",
  "RX-6103-FIN", "RX-7890-FIN", "RX-8834-FIN", "RX-9901-FIN", "RX-1156-FIN",
]

const RISK_COLOR: Record<string, string> = {
  HIGH:   "var(--danger)",
  MEDIUM: "var(--warning)",
  LOW:    "var(--success)",
}

const fmtM = (v: any) => {
  if (v == null || isNaN(parseFloat(v))) return "—"
  const n = parseFloat(v)
  return `$${(n / 1_000_000).toFixed(1)}M`
}
const fmtPct = (v: any) => {
  if (v == null || isNaN(parseFloat(v))) return "—"
  const n = parseFloat(v)
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`
}
const fmtPts = (v: any) => {
  if (v == null || isNaN(parseFloat(v))) return "—"
  const n = parseFloat(v)
  return `${n > 0 ? "+" : ""}${n.toFixed(1)} pp`
}

export function SalesForecastPanel() {
  const [trend, setTrend]             = useState<Row[]>([])
  const [compression, setCompression] = useState<Row[]>([])
  const [kpis, setKpis]               = useState<Row>({})
  const [product, setProduct]         = useState("RX-1234-FIN")
  const [loading, setLoading]         = useState(true)
  const [scenarios, setScenarios]     = useState<Row[]>([])
  const [selectedScenario, setSelectedScenario] = useState("")
  const [scenarioTrend, setScenarioTrend]       = useState<Row[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch("/api/sales-forecast").then(r => r.json()),
      fetch("/api/scenarios").then(r => r.json()),
    ]).then(([forecastData, scenarioData]) => {
      setTrend(forecastData.trend ?? [])
      setCompression(forecastData.compression ?? [])
      setKpis(forecastData.kpis ?? {})
      setScenarios(scenarioData.scenarios?.filter((s: Row) => !s.IS_BASE) ?? [])
    }).finally(() => setLoading(false))
  }, [])

  // When scenario selection changes, fetch scenario-adjusted forecast
  useEffect(() => {
    if (!selectedScenario) { setScenarioTrend([]); return }
    const s = scenarios.find(sc => sc.SCENARIO_NAME === selectedScenario)
    if (!s) return
    fetch(`/api/sales-forecast/scenario?api_pct=${s.API_COST_CHANGE_PCT}&energy_pct=${s.ENERGY_COST_CHANGE_PCT}&volume_mult=${s.VOLUME_MULTIPLIER}&labour_pct=${s.LABOUR_COST_CHANGE_PCT}&fx_pct=${s.FX_ADJUSTMENT_PCT}`)
      .then(r => r.json())
      .then(d => setScenarioTrend(d.trend ?? []))
      .catch(() => setScenarioTrend([]))
  }, [selectedScenario, scenarios])

  // Filter trend to selected product and build chart series
  const productTrend = trend.filter(r => r.MATERIAL_NUMBER === product)

  // Find the last actual row — used to bridge the gap to the forecast line
  const lastActual = [...productTrend].filter(r => r.DATA_TYPE === "actual").at(-1)
  const bridgeTs = lastActual?.TS?.slice(0, 7)

  // Revenue chart: for the last actual point, also set forecast = actual so lines connect
  const scenarioProduct = scenarioTrend.filter(r => r.MATERIAL_NUMBER === product)
  const selectedScenarioObj = scenarios.find(s => s.SCENARIO_NAME === selectedScenario)
  const volumeMult = selectedScenarioObj?.VOLUME_MULTIPLIER ?? 1.0

  const revenueChartData = productTrend.map(r => {
    const ts = r.TS?.slice(0, 7)
    const isBridge = ts === bridgeTs
    const scenarioRow = scenarioProduct.find(s => s.TS?.slice(0, 7) === ts)
    return {
      ts,
      actual:   r.DATA_TYPE === "actual"   ? parseFloat(r.ACTUAL_REVENUE   ?? 0) / 1_000_000 : null,
      forecast: r.DATA_TYPE === "forecast" ? parseFloat(r.FORECAST_REVENUE ?? 0) / 1_000_000
                : isBridge                 ? parseFloat(r.ACTUAL_REVENUE   ?? 0) / 1_000_000 : null,
      scenarioRevenue: scenarioRow && scenarioRow.DATA_TYPE === "forecast"
                ? parseFloat(scenarioRow.SCENARIO_REVENUE ?? r.FORECAST_REVENUE ?? 0) / 1_000_000
                : isBridge && selectedScenario ? parseFloat(r.ACTUAL_REVENUE ?? 0) / 1_000_000 : null,
      lower: r.DATA_TYPE === "forecast" ? parseFloat(r.REVENUE_LOWER ?? 0) / 1_000_000 : null,
      upper: r.DATA_TYPE === "forecast" ? parseFloat(r.REVENUE_UPPER ?? 0) / 1_000_000 : null,
    }
  })

  // Margin chart: include bridge point so forecast line starts from last actual value
  const marginChartData = productTrend.map(r => {
    const ts = r.TS?.slice(0, 7)
    const isBridge = ts === bridgeTs
    const scenarioRow = scenarioProduct.find(s => s.TS?.slice(0, 7) === ts)
    return {
      ts,
      actualMargin:   r.DATA_TYPE === "actual"   ? parseFloat(r.ACTUAL_MARGIN_PCT   ?? 0) : null,
      forecastMargin: r.DATA_TYPE === "forecast" ? parseFloat(r.FORECAST_MARGIN_PCT ?? 0)
                      : isBridge                 ? parseFloat(r.ACTUAL_MARGIN_PCT   ?? 0) : null,
      scenarioMargin: scenarioRow && scenarioRow.DATA_TYPE === "forecast"
                      ? parseFloat(scenarioRow.SCENARIO_MARGIN_PCT ?? 0)
                      : isBridge && selectedScenario ? parseFloat(r.ACTUAL_MARGIN_PCT ?? 0) : null,
    }
  })

  // KPI derived
  const marginChange = parseFloat(kpis.AVG_H2_MARGIN_PCT ?? 0) - parseFloat(kpis.AVG_H1_MARGIN_PCT ?? 0)
  const highRisk = compression.filter(r => r.COMPRESSION_RISK === "HIGH").length

  if (loading) return <div className="card"><div className="card-body" style={{ color: "#64748b", fontSize: ".85rem" }}>Loading sales forecast…</div></div>

  return (
    <>
      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">H2 Forecast Revenue</div>
          <div className="kpi-value">{fmtM(kpis.TOTAL_H2_FORECAST_REVENUE)}</div>
          <div className="kpi-sub">Apr–Dec 2026 ML forecast</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">H1 Avg Gross Margin</div>
          <div className="kpi-value success">{fmtPct(kpis.AVG_H1_MARGIN_PCT)}</div>
          <div className="kpi-sub">Jan–Mar 2026 actuals</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">H2 Forecast Margin</div>
          <div className={`kpi-value ${parseFloat(kpis.AVG_H2_MARGIN_PCT ?? 0) < parseFloat(kpis.AVG_H1_MARGIN_PCT ?? 0) ? "danger" : "success"}`}>
            {fmtPct(kpis.AVG_H2_MARGIN_PCT)}
          </div>
          <div className="kpi-sub">{fmtPts(marginChange)} vs H1</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">High Margin Risk</div>
          <div className={`kpi-value ${highRisk > 0 ? "danger" : "success"}`}>{highRisk}</div>
          <div className="kpi-sub">Products with &gt;3pp compression</div>
        </div>
      </div>

      {/* Revenue Forecast chart */}
      <div className="card">
        <div className="card-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="card-title">Revenue Forecast — H1 Actuals vs H2 Forecast</span>
          <select className="filter-select" value={product} onChange={e => setProduct(e.target.value)}>
            {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={selectedScenario}
            onChange={e => setSelectedScenario(e.target.value)}
            style={{ fontSize: ".75rem", padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)" }}
          >
            <option value="">No scenario overlay</option>
            {scenarios.map(s => <option key={s.SCENARIO_NAME} value={s.SCENARIO_NAME}>{s.SCENARIO_NAME}</option>)}
          </select>
        </div>
        <div className="card-body">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={revenueChartData} margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${v.toFixed(1)}M`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => v != null ? `$${parseFloat(v).toFixed(2)}M` : "—"} />
              <Legend />
              <ReferenceLine x="2026-04" stroke="#ef4444" strokeDasharray="4 4" label={{ value: "API Shock", position: "top", fontSize: 10, fill: "#ef4444" }} />
              <Area type="monotone" dataKey="upper" stroke="none" fill="#bfdbfe" name="Confidence band" legendType="none" connectNulls />
              <Area type="monotone" dataKey="lower" stroke="none" fill="#ffffff" name="" legendType="none" connectNulls />
              <Line type="monotone" dataKey="actual"   stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} name="Actual revenue" />
              <Line type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Forecast revenue" connectNulls />
              {selectedScenario && <Line type="monotone" dataKey="scenarioRevenue" stroke="#8b5cf6" strokeWidth={2.5} strokeDasharray="4 2" dot={false} name={`${selectedScenario} revenue`} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
          <p style={{ fontSize: ".72rem", color: "#64748b", marginTop: 8 }}>
            Blue shading = 90% prediction interval. Dashed line = H2 ML forecast. April reference = FY2026 API price shock that escalated manufacturing costs.
          </p>
        </div>
      </div>

      {/* Margin compression chart */}
      <div className="card">
        <div className="card-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="card-title">Gross Margin Compression — How Cost Increases Erode H2 Margin</span>
          <select
            value={selectedScenario}
            onChange={e => setSelectedScenario(e.target.value)}
            style={{ marginLeft: "auto", fontSize: ".75rem", padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)" }}
          >
            <option value="">Base forecast only</option>
            {scenarios.map(s => <option key={s.SCENARIO_NAME} value={s.SCENARIO_NAME}>{s.SCENARIO_NAME}</option>)}
          </select>
        </div>
        <div className="card-body">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={marginChartData} margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}%`} domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => v != null ? `${parseFloat(v).toFixed(1)}%` : "—"} />
              <Legend />
              <ReferenceLine x="2026-04" stroke="#ef4444" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="actualMargin"   stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} name="Actual margin %" />
              <Line type="monotone" dataKey="forecastMargin" stroke="#ef4444"        strokeWidth={2}   strokeDasharray="6 3" dot={false} name="Forecast margin %" connectNulls />
              {selectedScenario && <Line type="monotone" dataKey="scenarioMargin" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="4 2" dot={false} name={`${selectedScenario} margin %`} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
          <p style={{ fontSize: ".72rem", color: "#64748b", marginTop: 8 }}>
            Rising cost variance (API shock, energy price) flows directly into lower forecast gross margin. The gap between actual (blue) and forecast (red) is margin compression driven by cost inflation.
          </p>
        </div>
      </div>

      {/* Product impact table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Product Margin Impact — H1 Actuals vs H2 Forecast</span>
        </div>
        <div className="card-body">
          {compression.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: ".85rem" }}>No compression data available.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>H1 Margin %</th>
                  <th style={{ textAlign: "right" }}>H2 Forecast %</th>
                  <th style={{ textAlign: "right" }}>Change</th>
                  <th style={{ textAlign: "right" }}>H2 Revenue</th>
                  <th style={{ textAlign: "right" }}>Revenue at Risk</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {compression.map((r: Row) => {
                  const change = parseFloat(r.MARGIN_CHANGE_PTS ?? 0)
                  return (
                    <tr key={r.MATERIAL_NUMBER}>
                      <td style={{ fontWeight: 600 }}>{r.MATERIAL_NUMBER}</td>
                      <td style={{ textAlign: "right" }}>{fmtPct(r.H1_MARGIN_PCT)}</td>
                      <td style={{ textAlign: "right", color: parseFloat(r.H2_MARGIN_PCT) < parseFloat(r.H1_MARGIN_PCT) ? "var(--danger)" : "var(--success)" }}>
                        {fmtPct(r.H2_MARGIN_PCT)}
                      </td>
                      <td style={{ textAlign: "right", color: change < 0 ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>
                        {fmtPts(r.MARGIN_CHANGE_PTS)}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtM(r.H2_REVENUE)}</td>
                      <td style={{ textAlign: "right", color: parseFloat(r.REVENUE_AT_RISK ?? 0) > 0 ? "var(--danger)" : "var(--success)" }}>
                        {fmtM(r.REVENUE_AT_RISK)}
                      </td>
                      <td>
                        <span style={{
                          fontSize: ".72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                          color: RISK_COLOR[r.COMPRESSION_RISK] ?? "#64748b",
                          background: r.COMPRESSION_RISK === "HIGH" ? "#fef2f2" : r.COMPRESSION_RISK === "MEDIUM" ? "#fffbeb" : "#f0fdf4",
                        }}>
                          {r.COMPRESSION_RISK}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: ".72rem", color: "#64748b", marginTop: 8 }}>
            Revenue at Risk = H2 forecast revenue × margin compression (pp). HIGH = &gt;3pp compression, MEDIUM = 1–3pp.
          </p>
        </div>
      </div>
    </>
  )
}
