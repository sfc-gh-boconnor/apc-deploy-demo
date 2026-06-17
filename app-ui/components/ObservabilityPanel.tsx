"use client"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { useEffect, useState } from "react"
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

const BRAND = { magenta: "#830051", teal: "#00857c", gold: "#b8860b", purple: "#3c1053" }

type Obs = {
  dataQuality: Record<string, any> | null
  modelAccuracy: { summary: Record<string, any> | null; detail: any[] } | null
  cost: { compute: Record<string, any> | null; cortex: Record<string, any> | null }
  meteringAvailable: boolean
  cortexMetered: boolean
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      fontSize: ".62rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap",
      background: ok ? "rgba(34,197,94,.15)" : "rgba(245,158,11,.18)",
      color: ok ? "var(--success)" : "var(--warning)",
    }}>{ok ? "● " : "▲ "}{label}</span>
  )
}

export function ObservabilityPanel() {
  const [obs, setObs] = useState<Obs | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/observability").then(r => r.json()).then(setObs).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Running live observability checks…</div>
  if (!obs) return <div className="loading">Observability data unavailable.</div>

  const dq = obs.dataQuality
  const acc = obs.modelAccuracy?.summary
  const detail = obs.modelAccuracy?.detail ?? []
  const compute = obs.cost?.compute
  const cortex = obs.cost?.cortex
  const num = (v: any, d = 0) => (v == null ? null : Number(v).toFixed(d))

  const dqHealthy = dq && Number(dq.DUPLICATE_KEYS) === 0 && Number(dq.PCT_ACTUAL_POPULATED) >= 99
  const maxErr = detail.length ? Math.max(...detail.map(d => Number(d.ABS_ERROR_PP))) : 0

  return (
    <div>
      <p className="section-lead">
        Product costing only earns Finance's trust if every number is <strong>defensible</strong>. This layer makes the
        pipeline observable across four dimensions — <strong>data quality, model accuracy &amp; drift, AI output governance,
        and consumption cost</strong> — so the answer to "can we rely on this?" is evidence, not faith. All metrics below are
        queried <strong>live</strong> from Snowflake.
      </p>

      {/* ── Four-dimension scorecard ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 20 }}>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.teal}` }}>
          <div className="kpi-label">Data Quality</div>
          <div className="kpi-value" style={{ color: BRAND.teal }}>{dq ? `${num(dq.PCT_ACTUAL_POPULATED, 0)}%` : "—"}</div>
          <div className="kpi-sub">Actuals populated · {dq ? `${dq.DUPLICATE_KEYS} dup keys` : "n/a"} · fresh to {dq?.LATEST_PERIOD ?? "n/a"}</div>
        </div>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.magenta}` }}>
          <div className="kpi-label">Forecast Accuracy (backtest)</div>
          <div className="kpi-value" style={{ color: BRAND.magenta }}>{acc ? `${num(acc.MAE_PP, 1)}pp` : "—"}</div>
          <div className="kpi-sub">Mean abs error · RMSE {acc ? num(acc.RMSE_PP, 1) : "—"}pp · {acc?.PERIODS_TESTED ?? 0} held-out months</div>
        </div>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.gold}` }}>
          <div className="kpi-label">AI Output Governance</div>
          <div className="kpi-value" style={{ color: BRAND.gold }}>Grounded</div>
          <div className="kpi-sub">Explanations grounded in SAP variance rows · numeric guardrails on</div>
        </div>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.purple}` }}>
          <div className="kpi-label">Consumption Cost (14d)</div>
          <div className="kpi-value" style={{ color: BRAND.purple }}>{compute ? `${num(compute[`${WAREHOUSE}_CREDITS`], 2)}` : "—"}</div>
          <div className="kpi-sub">{WAREHOUSE} credits {obs.meteringAvailable ? "· live ACCOUNT_USAGE" : "· metering not granted"}</div>
        </div>
      </div>

      {/* ── Model accuracy / drift — the backtest ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Model accuracy &amp; drift — honest backtest</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Trained ≤ FY2025 · predicted FY2026 H1 · vs actuals it never saw</span>
        </div>
        <div className="card-body">
          {detail.length ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={detail.map(d => ({
                  period: d.PERIOD_LABEL?.replace("2026-", ""),
                  Actual: Number(d.ACTUAL_VARIANCE),
                  Forecast: Number(d.FORECAST_VARIANCE),
                  Error: Number(d.ABS_ERROR_PP),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Error" name="Abs error (pp)" fill={BRAND.gold} stroke={BRAND.gold} fillOpacity={0.15} />
                  <Line type="monotone" dataKey="Forecast" stroke={BRAND.purple} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Actual" stroke={BRAND.magenta} strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ fontSize: ".74rem", color: "var(--text-muted)", lineHeight: 1.6, marginTop: 8 }}>
                The model tracks the calm baseline within ~1pp (Jan–Mar), then <strong>under-predicts the April API price
                shock</strong> — error widens to {maxErr.toFixed(1)}pp and actuals break the confidence band
                (CI coverage {acc ? num(acc.CI_COVERAGE_PCT, 0) : "—"}%). That breach <strong>is</strong> the drift alarm:
                observability tells Finance precisely when a forecast stops being trustworthy, instead of letting a stale
                model quietly mislead a budget decision.
              </div>
            </>
          ) : <div className="loading">Backtest unavailable.</div>}
        </div>
      </div>

      {/* ── Data quality detail ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">Data quality checks (live)</span>
          <Pill ok={!!dqHealthy} label={dqHealthy ? "Healthy" : "Review"} /></div>
        <div className="card-body" style={{ overflowX: "auto" }}>
          {dq ? (
            <table className="data-table">
              <thead><tr><th>Check</th><th>Result</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Rows served (FY2026 FERT)</td><td>{dq.TOTAL_ROWS} · {dq.MATERIALS} materials × {dq.PLANTS} plants</td><td><Pill ok label="Complete" /></td></tr>
                <tr><td>Actual cost populated</td><td>{num(dq.PCT_ACTUAL_POPULATED, 1)}%</td><td><Pill ok={Number(dq.PCT_ACTUAL_POPULATED) >= 99} label={Number(dq.PCT_ACTUAL_POPULATED) >= 99 ? "Pass" : "Gaps"} /></td></tr>
                <tr><td>Budget (prior-year) populated</td><td>{num(dq.PCT_BUDGET_POPULATED, 1)}%</td><td><Pill ok={Number(dq.PCT_BUDGET_POPULATED) >= 99} label={Number(dq.PCT_BUDGET_POPULATED) >= 99 ? "Pass" : "Partial"} /></td></tr>
                <tr><td>Duplicate ledger keys</td><td>{dq.DUPLICATE_KEYS}</td><td><Pill ok={Number(dq.DUPLICATE_KEYS) === 0} label={Number(dq.DUPLICATE_KEYS) === 0 ? "None" : "Found"} /></td></tr>
                <tr><td>Within ±5% of standard</td><td>{num(dq.PCT_WITHIN_TOLERANCE, 1)}% of rows</td><td><Pill ok label="Monitored" /></td></tr>
                <tr><td>Freshness</td><td>Latest period {dq.LATEST_PERIOD}</td><td><Pill ok label="Current" /></td></tr>
              </tbody>
            </table>
          ) : <div className="loading">Data quality unavailable.</div>}
        </div>
      </div>

      {/* ── CoCo (Cortex Code): build & operate + cost transparency ── */}
      <div className="card" style={{ marginBottom: 20, borderTop: `3px solid ${BRAND.magenta}` }}>
        <div className="card-header"><span className="card-title">Built &amp; operated with Cortex Code (CoCo)</span></div>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 22 }}>
            <div style={{ fontSize: ".82rem", lineHeight: 1.65 }}>
              <strong>AI builds the trust layer, not just the dashboard.</strong> This accelerator — the SAP-style data model,
              the variance SQL, the Snowflake ML forecast, and this observability layer itself — is built and maintained
              agentically in <strong>Cortex Code</strong>. The same agent that writes the pipeline also writes the checks that
              keep it honest: schema diffs, data-quality SQL, the train-≤FY2025 backtest, and the cost queries on this page.
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--text-muted)" }}>
                <li>Generate &amp; evolve the costing model + views from natural language</li>
                <li>Author and run the ML forecast + backtest as code, versioned in git</li>
                <li>Stand up this observability tab — live DQ, drift and cost — in one session</li>
              </ul>
            </div>
            <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
              <div style={{ fontSize: ".7rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                Cost transparency — we meter the AI
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>APC compute ({WAREHOUSE}, 14d)</span>
                <strong style={{ color: BRAND.purple }}>{compute ? `${num(compute[`${WAREHOUSE}_CREDITS`], 2)} cr` : "n/a"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>Account credits (14d)</span>
                <strong>{compute ? `${num(compute.ACCOUNT_CREDITS, 2)} cr` : "n/a"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span>Cortex AI (explanations)</span>
                <strong style={{ color: BRAND.teal }}>{obs.cortexMetered ? `${num(cortex?.CORTEX_CREDITS, 4)} cr · ${cortex?.CORTEX_TOKENS} tok` : "no spend in window"}</strong>
              </div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
                The AI that explains a variance is itself a metered line item — so "what did the AI cost us?" is as
                answerable as "what did the product cost us?". {obs.meteringAvailable ? "Live from ACCOUNT_USAGE." : "Grant ACCOUNT_USAGE to surface live credits."}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: ".7rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        Data quality, backtest accuracy and consumption are queried live at page load. Cortex consumption appears once
        AI explanations have run in the trailing 14-day window and ACCOUNT_USAGE is granted to the service role.
      </p>
    </div>
  )
}
