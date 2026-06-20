"use client"
import { useEffect, useState, useCallback } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts"

type Scenario = {
  SCENARIO_ID: number
  SCENARIO_NAME: string
  DESCRIPTION: string
  API_COST_CHANGE_PCT: number
  LABOUR_COST_CHANGE_PCT: number
  VOLUME_MULTIPLIER: number
  FX_ADJUSTMENT_PCT: number
  ENERGY_COST_CHANGE_PCT: number
  IS_BASE: boolean
}

type ResultRow = {
  SCENARIO_ID: number
  SCENARIO_NAME: string
  IS_BASE: boolean
  MATERIAL_NUMBER: string
  MATERIAL_DESCRIPTION: string
  BASE_COST: number
  SCENARIO_COST: number
  COST_DELTA: number
  COST_DELTA_PCT: number
}

const SCENARIO_COLORS: Record<string, string> = {
  "Base": "var(--primary)",
  "API Cost Shock": "#f59e0b",
  "Volume Drop": "#8b5cf6",
  "Energy Spike": "#00857c",
}

// Original seeded presets (sql/04_scenarios.sql) used by "Reset to default".
type Params = Pick<Scenario, "API_COST_CHANGE_PCT" | "LABOUR_COST_CHANGE_PCT" | "VOLUME_MULTIPLIER" | "FX_ADJUSTMENT_PCT" | "ENERGY_COST_CHANGE_PCT">
const SCENARIO_DEFAULTS: Record<string, Params> = {
  "API Cost Shock": { API_COST_CHANGE_PCT: 20, LABOUR_COST_CHANGE_PCT: 0, VOLUME_MULTIPLIER: 1.0, FX_ADJUSTMENT_PCT: 0, ENERGY_COST_CHANGE_PCT: 0 },
  "Volume Drop":    { API_COST_CHANGE_PCT: 0,  LABOUR_COST_CHANGE_PCT: 0, VOLUME_MULTIPLIER: 0.7, FX_ADJUSTMENT_PCT: 0, ENERGY_COST_CHANGE_PCT: 0 },
  "Energy Spike":   { API_COST_CHANGE_PCT: 0,  LABOUR_COST_CHANGE_PCT: 0, VOLUME_MULTIPLIER: 1.0, FX_ADJUSTMENT_PCT: 0, ENERGY_COST_CHANGE_PCT: 40 },
}
const PARAM_KEYS: (keyof Params)[] = ["API_COST_CHANGE_PCT", "LABOUR_COST_CHANGE_PCT", "VOLUME_MULTIPLIER", "FX_ADJUSTMENT_PCT", "ENERGY_COST_CHANGE_PCT"]

const PERIOD_OPTIONS = [
  { value: "all", label: "All Periods" },
  { value: "001", label: "Period 001 — Jan" },
  { value: "002", label: "Period 002 — Feb" },
  { value: "003", label: "Period 003 — Mar" },
]

function Slider({
  label, value, min, max, step, unit, onChange, disabled,
}: {
  label: string; value: number; min: number; max: number; step: number
  unit: string; onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: ".72rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: ".78rem", fontWeight: 700, color: disabled ? "var(--text-muted)" : "var(--primary-dark)" }}>
          {unit === "x" ? `${value.toFixed(1)}x` : `${value > 0 ? "+" : ""}${value}%`}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "var(--primary)", cursor: disabled ? "default" : "pointer" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65rem", color: "var(--text-muted)" }}>
        <span>{unit === "x" ? `${min}x` : `${min}%`}</span>
        <span>{unit === "x" ? `${max}x` : `${max}%`}</span>
      </div>
    </div>
  )
}

function ScenarioCard({
  scenario, dirty, canReset, onParamChange, onApply, onRevert, onReset, applying,
}: {
  scenario: Scenario
  dirty: boolean
  canReset: boolean
  onParamChange: (field: keyof Scenario, value: number) => void
  onApply: () => void
  onRevert: () => void
  onReset: () => void
  applying: boolean
}) {
  const color = SCENARIO_COLORS[scenario.SCENARIO_NAME] ?? "var(--primary)"
  return (
    <div style={{
      background: "var(--surface)", border: `2px solid ${color}22`,
      borderRadius: "var(--radius)", padding: "16px 18px",
      borderTopColor: color, borderTopWidth: 3,
      boxShadow: "var(--shadow)", flex: "1 1 260px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
        <span style={{ fontWeight: 700, fontSize: ".88rem", color: "var(--primary-dark)" }}>{scenario.SCENARIO_NAME}</span>
        {scenario.IS_BASE && (
          <span style={{ fontSize: ".62rem", background: "#d1fae5", color: "#065f46", padding: "2px 7px", borderRadius: 10, fontWeight: 700 }}>
            BASE
          </span>
        )}
      </div>
      <p style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.4 }}>
        {scenario.DESCRIPTION}
      </p>
      <Slider label="API / Drug Substance cost" value={scenario.API_COST_CHANGE_PCT}
        min={-30} max={50} step={5} unit="%" disabled={scenario.IS_BASE}
        onChange={v => onParamChange("API_COST_CHANGE_PCT", v)} />
      <Slider label="Labour rate change" value={scenario.LABOUR_COST_CHANGE_PCT}
        min={-10} max={30} step={5} unit="%" disabled={scenario.IS_BASE}
        onChange={v => onParamChange("LABOUR_COST_CHANGE_PCT", v)} />
      <Slider label="Volume multiplier" value={scenario.VOLUME_MULTIPLIER}
        min={0.3} max={2.0} step={0.1} unit="x" disabled={scenario.IS_BASE}
        onChange={v => onParamChange("VOLUME_MULTIPLIER", v)} />
      <Slider label="FX / other cost change" value={scenario.FX_ADJUSTMENT_PCT}
        min={-20} max={20} step={5} unit="%" disabled={scenario.IS_BASE}
        onChange={v => onParamChange("FX_ADJUSTMENT_PCT", v)} />
      <Slider label="Energy price change" value={scenario.ENERGY_COST_CHANGE_PCT}
        min={-30} max={80} step={5} unit="%" disabled={scenario.IS_BASE}
        onChange={v => onParamChange("ENERGY_COST_CHANGE_PCT", v)} />
      {!scenario.IS_BASE && (
        <>
          <button
            onClick={onApply}
            disabled={applying || !dirty}
            style={{
              marginTop: 8, width: "100%", padding: "8px 0",
              background: dirty ? color : "var(--border)",
              color: dirty ? "white" : "var(--text-muted)",
              border: "none", borderRadius: 8, fontWeight: 700,
              fontSize: ".78rem", cursor: dirty ? "pointer" : "default",
              transition: "all .15s",
            }}
          >
            {applying ? "Applying…" : dirty ? "▶  Run Scenario" : "Up to date"}
          </button>
          <div style={{ display: "flex", gap: 14, marginTop: 7, justifyContent: "center" }}>
            {dirty && (
              <button onClick={onRevert} disabled={applying} style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: ".7rem", fontWeight: 600, color: "var(--text-muted)",
              }}>↩ Revert</button>
            )}
            {canReset && (
              <button onClick={onReset} disabled={applying} style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: ".7rem", fontWeight: 600, color: "var(--text-muted)",
              }}>⟲ Reset to default</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Build chart data: one entry per product, with a key per scenario
function buildChartData(results: ResultRow[]): Record<string, any>[] {
  const products = Array.from(new Set(results.map(r => r.MATERIAL_NUMBER)))
  return products.map(mat => {
    const entry: Record<string, any> = { material: mat.replace("-FIN", "") }
    results.filter(r => r.MATERIAL_NUMBER === mat).forEach(r => {
      entry[r.SCENARIO_NAME] = r.SCENARIO_COST
    })
    return entry
  })
}

export function ScenarioPanel() {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [localScenarios, setLocalScenarios] = useState<Scenario[]>([])
  const [results, setResults] = useState<ResultRow[]>([])
  const [period, setPeriod] = useState("all")
  const [loadingScenarios, setLoadingScenarios] = useState(true)
  const [loadingResults, setLoadingResults] = useState(true)
  const [applyingId, setApplyingId] = useState<number | null>(null)

  // Load scenarios
  useEffect(() => {
    fetch("/api/scenarios")
      .then(r => r.json())
      .then(d => {
        setScenarios(d.scenarios ?? [])
        setLocalScenarios(d.scenarios ?? [])
      })
      .finally(() => setLoadingScenarios(false))
  }, [])

  const fetchResults = useCallback(() => {
    setLoadingResults(true)
    fetch(`/api/scenarios/results?period=${period}`)
      .then(r => r.json())
      .then(d => setResults(d.rows ?? []))
      .finally(() => setLoadingResults(false))
  }, [period])

  useEffect(() => { fetchResults() }, [fetchResults])

  const handleParamChange = (id: number, field: keyof Scenario, value: number) => {
    setLocalScenarios(prev => prev.map(s => s.SCENARIO_ID === id ? { ...s, [field]: value } : s))
  }

  const persist = useCallback(async (id: number, p: Params) => {
    await fetch("/api/scenarios/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        api_cost_change_pct:    p.API_COST_CHANGE_PCT,
        labour_cost_change_pct: p.LABOUR_COST_CHANGE_PCT,
        volume_multiplier:      p.VOLUME_MULTIPLIER,
        fx_adjustment_pct:      p.FX_ADJUSTMENT_PCT,
        energy_cost_change_pct: p.ENERGY_COST_CHANGE_PCT,
      }),
    })
  }, [])

  const handleApply = async (scenario: Scenario) => {
    setApplyingId(scenario.SCENARIO_ID)
    try {
      await persist(scenario.SCENARIO_ID, scenario)
      setScenarios(prev => prev.map(s => s.SCENARIO_ID === scenario.SCENARIO_ID ? { ...scenario } : s))
      fetchResults()
    } finally {
      setApplyingId(null)
    }
  }

  // Revert unsaved slider edits back to the last-applied (saved) values.
  const handleRevert = (scenario: Scenario) => {
    const saved = scenarios.find(x => x.SCENARIO_ID === scenario.SCENARIO_ID)
    if (saved) setLocalScenarios(prev => prev.map(s => s.SCENARIO_ID === scenario.SCENARIO_ID ? { ...saved } : s))
  }

  // Reset to the original seeded preset and persist.
  const handleReset = async (scenario: Scenario) => {
    const def = SCENARIO_DEFAULTS[scenario.SCENARIO_NAME]
    if (!def) return
    const reset = { ...scenario, ...def }
    setLocalScenarios(prev => prev.map(s => s.SCENARIO_ID === scenario.SCENARIO_ID ? reset : s))
    setApplyingId(scenario.SCENARIO_ID)
    try {
      await persist(scenario.SCENARIO_ID, def)
      setScenarios(prev => prev.map(s => s.SCENARIO_ID === scenario.SCENARIO_ID ? reset : s))
      fetchResults()
    } finally {
      setApplyingId(null)
    }
  }

  const scenarioNames = Array.from(new Set(results.map(r => r.SCENARIO_NAME)))
  const chartData = buildChartData(results)

  // Summary KPIs for worst-case scenario
  const shockResults = results.filter(r => !r.IS_BASE && r.SCENARIO_NAME !== "Base")
  const maxDelta = shockResults.reduce((m, r) => Math.abs(r.COST_DELTA_PCT) > Math.abs(m) ? r.COST_DELTA_PCT : m, 0)
  const avgDelta = shockResults.length
    ? shockResults.reduce((s, r) => s + r.COST_DELTA_PCT, 0) / shockResults.length
    : 0

  if (loadingScenarios) return <div className="loading">Loading scenarios…</div>

  return (
    <>
      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">Active Scenarios</div>
          <div className="kpi-value">{scenarios.length}</div>
          <div className="kpi-sub">Base + {scenarios.length - 1} what-if</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Max Portfolio Impact</div>
          <div className={`kpi-value ${Math.abs(maxDelta) > 5 ? "danger" : "warning"}`}>
            {maxDelta > 0 ? "+" : ""}{maxDelta.toFixed(1)}%
          </div>
          <div className="kpi-sub">Worst product vs base</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Scenario Delta</div>
          <div className={`kpi-value ${avgDelta > 3 ? "danger" : avgDelta > 1 ? "warning" : "success"}`}>
            {avgDelta > 0 ? "+" : ""}{avgDelta.toFixed(1)}%
          </div>
          <div className="kpi-sub">Across all what-if scenarios</div>
        </div>
      </div>

      {/* Scenario cards */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        {localScenarios.map(s => {
          const saved = scenarios.find(x => x.SCENARIO_ID === s.SCENARIO_ID)
          const dirty = saved ? (
            s.API_COST_CHANGE_PCT    !== saved.API_COST_CHANGE_PCT ||
            s.LABOUR_COST_CHANGE_PCT !== saved.LABOUR_COST_CHANGE_PCT ||
            s.VOLUME_MULTIPLIER      !== saved.VOLUME_MULTIPLIER ||
            s.FX_ADJUSTMENT_PCT      !== saved.FX_ADJUSTMENT_PCT ||
            s.ENERGY_COST_CHANGE_PCT !== saved.ENERGY_COST_CHANGE_PCT
          ) : false
          const def = SCENARIO_DEFAULTS[s.SCENARIO_NAME]
          const canReset = !s.IS_BASE && !!def && (saved
            ? PARAM_KEYS.some(k => saved[k] !== def[k])
            : PARAM_KEYS.some(k => s[k] !== def[k]))
          return (
            <ScenarioCard
              key={s.SCENARIO_ID}
              scenario={s}
              dirty={dirty}
              canReset={canReset}
              applying={applyingId === s.SCENARIO_ID}
              onParamChange={(field, value) => handleParamChange(s.SCENARIO_ID, field, value)}
              onApply={() => handleApply(s)}
              onRevert={() => handleRevert(s)}
              onReset={() => handleReset(s)}
            />
          )
        })}
      </div>

      {/* Period filter */}
      <div className="filter-row">
        <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ fontSize: ".75rem", color: "var(--text-muted)", alignSelf: "center" }}>
          Showing finished goods (FIN) averaged across all manufacturing sites
        </span>
      </div>

      {/* Grouped bar chart */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Cost per Unit by Scenario — Portfolio Comparison</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
            Adjust sliders above and click Run Scenario to update
          </span>
        </div>
        <div className="card-body">
          {loadingResults ? <div className="loading">Calculating scenario costs…</div> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="material" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip formatter={(v: any, name: string) => [`$${parseFloat(v).toFixed(2)}/unit`, name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {scenarioNames.map(name => (
                  <Bar key={name} dataKey={name} fill={SCENARIO_COLORS[name] ?? "#94a3b8"}
                    radius={[3, 3, 0, 0]} opacity={0.85} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Impact table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Scenario Impact Summary — Cost Delta vs Base</span>
        </div>
        <div className="card-body" style={{ overflowX: "auto" }}>
          {loadingResults ? <div className="loading">Loading…</div> : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Description</th>
                  <th>Base Cost/unit</th>
                  {scenarioNames.filter(n => n !== "Base").map(n => (
                    <th key={n}>{n} — Cost/unit</th>
                  ))}
                  {scenarioNames.filter(n => n !== "Base").map(n => (
                    <th key={n + "_d"} style={{ color: SCENARIO_COLORS[n] }}>Δ {n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(results.filter(r => r.IS_BASE).map(r => r.MATERIAL_NUMBER))).map(mat => {
                  const base = results.find(r => r.MATERIAL_NUMBER === mat && r.IS_BASE)
                  if (!base) return null
                  const nonBase = scenarioNames.filter(n => n !== "Base")
                  return (
                    <tr key={mat}>
                      <td style={{ fontFamily: "monospace", fontSize: ".78rem" }}>{mat.replace("-FIN", "")}</td>
                      <td>{base.MATERIAL_DESCRIPTION}</td>
                      <td>${base.BASE_COST.toFixed(2)}</td>
                      {nonBase.map(name => {
                        const row = results.find(r => r.MATERIAL_NUMBER === mat && r.SCENARIO_NAME === name)
                        return <td key={name}>${row ? row.SCENARIO_COST.toFixed(2) : "—"}</td>
                      })}
                      {nonBase.map(name => {
                        const row = results.find(r => r.MATERIAL_NUMBER === mat && r.SCENARIO_NAME === name)
                        if (!row) return <td key={name + "_d"}>—</td>
                        const pct = row.COST_DELTA_PCT
                        const cls = pct > 2 ? "var-positive" : pct < -2 ? "var-negative" : "var-neutral"
                        return (
                          <td key={name + "_d"} className={cls}>
                            {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ML Scenario Forecast */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <span className="card-title">ML Scenario Forecast</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
            Registered models predict cost impact under each scenario
          </span>
        </div>
        <div className="card-body">
          <ScenarioForecastSection scenarios={scenarios} />
        </div>
      </div>
    </>
  )
}

// ── ML Scenario Forecast sub-component ──
type ForecastResult = {
  scenarioName: string
  baseVariance: number
  scenarioVariance: number
  varianceShift: number
  totalCostImpact: number
}

function ScenarioForecastSection({ scenarios }: { scenarios: Scenario[] }) {
  const [forecasts, setForecasts] = useState<ForecastResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (scenarios.length === 0) return
    setLoading(true)
    const nonBase = scenarios.filter(s => !s.IS_BASE)
    Promise.all(
      nonBase.map(s =>
        fetch(`/api/scenarios/forecast?api_pct=${s.API_COST_CHANGE_PCT}&energy_pct=${s.ENERGY_COST_CHANGE_PCT}&volume_mult=${s.VOLUME_MULTIPLIER}&labour_pct=${s.LABOUR_COST_CHANGE_PCT}&fx_pct=${s.FX_ADJUSTMENT_PCT}`)
          .then(r => r.json())
          .then(d => ({ scenarioName: s.SCENARIO_NAME, baseVariance: d.summary?.baseVariance ?? 0, scenarioVariance: d.summary?.scenarioVariance ?? 0, varianceShift: d.summary?.varianceShift ?? 0, totalCostImpact: d.summary?.totalCostImpact ?? 0 }))
      )
    ).then(r => { setForecasts(r); setLoading(false) }).catch(() => setLoading(false))
  }, [scenarios])

  if (loading) return <p style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>Running ML forecast models...</p>
  if (forecasts.length === 0) return null

  return (
    <div>
      <p style={{ fontSize: ".75rem", color: "var(--text-muted)", marginBottom: 12 }}>
        The registered <strong>COST_VARIANCE_FORECAST_MODEL</strong> predicts how each scenario shifts the portfolio cost variance.
        Unlike the rule-based table above, these predictions account for non-linear relationships between cost drivers.
      </p>
      <table className="data-table" style={{ width: "100%" }}>
        <thead><tr><th>Scenario</th><th>Base Variance %</th><th>Scenario Variance %</th><th>Shift (pp)</th><th>Cost Impact ($/unit)</th></tr></thead>
        <tbody>
          {forecasts.map(f => (
            <tr key={f.scenarioName}>
              <td style={{ fontWeight: 700, color: SCENARIO_COLORS[f.scenarioName] || "var(--text)" }}>{f.scenarioName}</td>
              <td>{f.baseVariance.toFixed(2)}%</td>
              <td style={{ fontWeight: 700 }}>{f.scenarioVariance.toFixed(2)}%</td>
              <td className={f.varianceShift > 0 ? "var-positive" : "var-negative"}>{f.varianceShift > 0 ? "+" : ""}{f.varianceShift.toFixed(2)} pp</td>
              <td className={f.totalCostImpact > 0 ? "var-positive" : "var-negative"}>{f.totalCostImpact > 0 ? "+" : ""}${f.totalCostImpact.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 8 }}>
        Model: APC_DEPLOY_DB.ML_FEATURE_STORE.COST_VARIANCE_FORECAST_MODEL V1 (XGBoost)
      </p>
    </div>
  )
}
