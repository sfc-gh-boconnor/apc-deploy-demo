"use client"
import { useEffect, useState, useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend, ComposedChart, Area } from "recharts"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type Row = Record<string, any>

type ExplainCtx = {
  product: string
  description: string
  site: string
  period: string
  budget: string
  actual: string
  varianceAbs: string
  variancePct: string
  field: string
}

const PERIOD_LABELS: Record<string, string> = {
  "001": "Jan", "002": "Feb", "003": "Mar",
  "004": "Apr", "005": "May", "006": "Jun"
}

function sfEscape(s: string) { return s.replace(/'/g, "''") }

export function VariancePanel() {
  // global filters (server-side)
  const [filter, setFilter] = useState({ period: "all", site: "all", type: "FERT" })
  const [topVariance, setTopVariance] = useState<Row[]>([])
  const [trendData, setTrendData] = useState<Row[]>([])
  const [ytdData, setYtdData] = useState<Row[]>([])
  const [componentData, setComponentData] = useState<Row[]>([])
  const [selectedProduct, setSelectedProduct] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<string[]>([])

  // pivot data (all products × sites × periods, loaded once)
  const [pivotRows, setPivotRows] = useState<Row[]>([])

  // table interaction state
  const [sortCol, setSortCol] = useState("COST_VARIANCE_PCT")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [colFilters, setColFilters] = useState({ material: "", site: "", period: "" })
  const [viewMode, setViewMode] = useState<"table" | "site" | "period">("table")

  // explain modal state
  const [explainCell, setExplainCell] = useState<ExplainCtx | null>(null)
  const [explainText, setExplainText] = useState("")
  const [explainLoading, setExplainLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams({ ...filter })
    Promise.all([
      fetch(`/api/variance?${p}`).then(r => r.json()),
      fetch(`/api/trend?${p}`).then(r => r.json()),
      fetch("/api/sites").then(r => r.json()),
      fetch("/api/trend/ytd").then(r => r.json()),
    ]).then(([v, t, s, ytd]) => {
      setTopVariance(v.rows ?? [])
      setTrendData(t.rows ?? [])
      setSites(s.sites ?? [])
      setYtdData(ytd.rows ?? [])
      if (v.rows?.length) setSelectedProduct(v.rows[0].MATERIAL_NUMBER)
    }).finally(() => setLoading(false))
  }, [filter])

  useEffect(() => {
    fetch("/api/pivot").then(r => r.json()).then(d => setPivotRows(d.rows ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedProduct) return
    fetch(`/api/components?product=${encodeURIComponent(selectedProduct)}&period=${filter.period}&site=${filter.site}`)
      .then(r => r.json())
      .then(d => setComponentData(d.rows ?? []))
  }, [selectedProduct, filter])

  // client-side sort + filter
  const filteredRows = useMemo(() => {
    let rows = topVariance
      .filter(r => !colFilters.material || r.MATERIAL_NUMBER.toLowerCase().includes(colFilters.material.toLowerCase()))
      .filter(r => !colFilters.site || (r.PLANT_NAME ?? "").toLowerCase().includes(colFilters.site.toLowerCase()))
      .filter(r => !colFilters.period || r.PERIOD === colFilters.period)
    const numeric = ["STANDARD_COST_PER_UNIT", "ACTUAL_COST_PER_UNIT", "BUDGET_COST_PER_UNIT", "COST_VARIANCE_ABS", "COST_VARIANCE_PCT", "BUDGET_VARIANCE_PCT"].includes(sortCol)
    return [...rows].sort((a, b) => {
      if (numeric) {
        const av = parseFloat(a[sortCol]) || 0, bv = parseFloat(b[sortCol]) || 0
        return sortDir === "desc" ? bv - av : av - bv
      }
      const av = (a[sortCol] ?? ""), bv = (b[sortCol] ?? "")
      return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv)
    })
  }, [topVariance, colFilters, sortCol, sortDir])

  // pivot data — uses full dataset, not the top-10 chart data
  const uniqueSites   = useMemo(() => [...new Set(pivotRows.map(r => r.PLANT_NAME))].sort(), [pivotRows])
  const uniquePeriods = useMemo(() => [...new Set(pivotRows.map(r => r.PERIOD))].sort(), [pivotRows])
  const uniqueProds   = useMemo(() => [...new Set(pivotRows.map(r => r.MATERIAL_NUMBER))].sort(), [pivotRows])

  // colour helpers
  const varColor = (v: number) => v > 5 ? "var(--danger)" : v > 2 ? "var(--warning)" : v < -2 ? "var(--success)" : "var(--primary)"
  const pivotBg  = (vp: number | null) => {
    if (vp === null) return "transparent"
    if (vp > 5) return "rgba(239,68,68,0.22)"
    if (vp > 2) return "rgba(245,158,11,0.22)"
    if (vp < -2) return "rgba(34,197,94,0.22)"
    return "transparent"
  }

  // sort header helper
  const SortTh = ({ col, label }: { col: string; label: string }) => (
    <th
      onClick={() => { setSortCol(col); setSortDir(d => sortCol === col ? (d === "desc" ? "asc" : "desc") : "desc") }}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label} <span style={{ opacity: sortCol === col ? 1 : 0.3 }}>{sortCol === col ? (sortDir === "desc" ? "↓" : "↑") : "⇅"}</span>
    </th>
  )

  // build context object from a row
  const rowCtx = (r: Row, field = "overall"): ExplainCtx => ({
    product:     r.MATERIAL_NUMBER,
    description: r.MATERIAL_DESCRIPTION,
    site:        r.PLANT_NAME,
    period:      PERIOD_LABELS[r.PERIOD] || r.PERIOD,
    budget:      parseFloat(r.STANDARD_COST_PER_UNIT).toFixed(2),
    actual:      parseFloat(r.ACTUAL_COST_PER_UNIT).toFixed(2),
    varianceAbs: parseFloat(r.COST_VARIANCE_ABS).toFixed(2),
    variancePct: parseFloat(r.COST_VARIANCE_PCT).toFixed(1),
    field,
  })

  // explain SSE streaming
  const explainNumber = async (ctx: ExplainCtx) => {
    setExplainCell(ctx)
    setExplainText("")
    setExplainLoading(true)
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ctx),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (payload === "[DONE]") break
          try { setExplainText(prev => prev + JSON.parse(payload).token) } catch { /* skip */ }
        }
      }
    } catch { /* session expired etc */ }
    finally { setExplainLoading(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--card-bg)", color: "var(--text-primary)",
    border: "1px solid var(--border)", padding: "2px 4px", fontSize: ".72rem", borderRadius: 3,
  }

  return (
    <>
      {/* global filter bar */}
      <div className="filter-row">
        <select className="filter-select" value={filter.period} onChange={e => setFilter(f => ({ ...f, period: e.target.value }))}>
          <option value="all">All Periods</option>
          <option value="001">Period 001 — Jan</option>
          <option value="002">Period 002 — Feb</option>
          <option value="003">Period 003 — Mar</option>
          <option value="004">Period 004 — Apr</option>
          <option value="005">Period 005 — May</option>
          <option value="006">Period 006 — Jun</option>
        </select>
        <select className="filter-select" value={filter.site} onChange={e => setFilter(f => ({ ...f, site: e.target.value }))}>
          <option value="all">All Sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
          <option value="FERT">Finished Products</option>
          <option value="HALB">Semi-Finished</option>
          <option value="ROH">Raw Materials</option>
        </select>
      </div>

      {loading ? <div className="loading">Loading cost data from SAP BDC…</div> : (
        <>
          {/* Top Variance Chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Cost Variance by Product — Top 10</span>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>CKMLCR actual vs MBEW standard (SAP BDC)</span>
            </div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topVariance} margin={{ top: 4, right: 16, left: 16, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="MATERIAL_DESCRIPTION" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: any) => [`${parseFloat(v).toFixed(2)}%`, "Variance"]} />
                  <Bar dataKey="COST_VARIANCE_PCT" name="Variance %" radius={[4, 4, 0, 0]}>
                    {topVariance.map((row, i) => (
                      <Cell key={i} fill={varColor(parseFloat(row.COST_VARIANCE_PCT))} cursor="pointer"
                        onClick={() => setSelectedProduct(row.MATERIAL_NUMBER)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Charts 2-col */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* YTD trend */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">YTD Budget vs Actual Cost Trend</span>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Over budget = red · Under = green</span>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={ytdData.map(r => ({
                    period: PERIOD_LABELS[r.PERIOD] || r.PERIOD,
                    "Budget Cost": parseFloat(r.BUDGET_COST_K),
                    "Actual Cost": parseFloat(r.ACTUAL_COST_K),
                    variance_pct: parseFloat(r.VARIANCE_PCT),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="cost" tick={{ fontSize: 10 }} tickFormatter={v => `$${v}K`} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                    <Tooltip formatter={(v: any, n: string) => [
                      n === "Variance %" ? `${parseFloat(v).toFixed(1)}%` : `$${parseFloat(v).toLocaleString()}K`, n
                    ]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area yAxisId="cost" type="monotone" dataKey="Budget Cost" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} />
                    <Line yAxisId="cost" type="monotone" dataKey="Actual Cost" stroke="var(--danger)" strokeWidth={2} dot={{ r: 4 }} />
                    <Bar yAxisId="pct" dataKey="variance_pct" name="Variance %" fill="var(--warning)" opacity={0.4} radius={[3,3,0,0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Portfolio trend */}
              <div className="card">
                <div className="card-header"><span className="card-title">Portfolio Variance Trend</span></div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendData.map(r => ({ ...r, period: PERIOD_LABELS[r.PERIOD] || r.PERIOD }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: any) => [`${parseFloat(v).toFixed(2)}%`]} />
                      <Line type="monotone" dataKey="AVG_VARIANCE_PCT" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4 }} name="Avg Variance %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Cost components */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Budget Cost Components — {selectedProduct || "Select a product"}</span>
                </div>
                <div className="card-body">
                  {componentData.length ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={componentData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `$${v.toFixed(1)}`} />
                        <YAxis type="category" dataKey="COST_COMPONENT" tick={{ fontSize: 10 }} width={120} />
                        <Tooltip formatter={(v: any) => [`$${parseFloat(v).toFixed(4)}`]} />
                        <Bar dataKey="STANDARD_COST" name="Budget" fill="var(--primary)" opacity={.6} radius={[0, 3, 3, 0]} />
                        <Bar dataKey="ACTUAL_COST" name="Actual" fill="var(--danger)" opacity={.7} radius={[0, 3, 3, 0]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <div className="loading">Click a product bar to see cost component breakdown</div>}
                </div>
              </div>
            </div>
          </div>

          {/* ── Interactive Detail Section ── */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Product Cost Detail — Standard vs Actual (SAP MBEW / CKMLCR)</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: ".7rem", color: "var(--text-muted)", marginRight: 4 }}>Click any cell for AI explanation</span>
                {(["table", "site", "period"] as const).map(mode => (
                  <button key={mode}
                    onClick={() => setViewMode(mode)}
                    style={{
                      fontSize: ".73rem", padding: "3px 12px", borderRadius: 4, cursor: "pointer",
                      background: viewMode === mode ? "var(--primary)" : "transparent",
                      color: viewMode === mode ? "#fff" : "var(--text-muted)",
                      border: `1px solid ${viewMode === mode ? "var(--primary)" : "var(--border)"}`,
                    }}>
                    {mode === "table" ? "Table" : mode === "site" ? "× Site" : "× Period"}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-body" style={{ overflowX: "auto" }}>

              {/* ── TABLE VIEW ── */}
              {viewMode === "table" && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortTh col="MATERIAL_NUMBER"       label="Material (MATNR)" />
                      <SortTh col="MATERIAL_DESCRIPTION"  label="Description" />
                      <SortTh col="PLANT_NAME"            label="Site (WERKS)" />
                      <SortTh col="PERIOD"                label="Period (POPER)" />
                      <SortTh col="STANDARD_COST_PER_UNIT" label="Standard (STPRS)" />
                      <SortTh col="BUDGET_COST_PER_UNIT"  label="Budget (PY)" />
                      <SortTh col="ACTUAL_COST_PER_UNIT"  label="Actual (PVPRS)" />
                      <SortTh col="COST_VARIANCE_ABS"     label="Variance $" />
                      <SortTh col="COST_VARIANCE_PCT"     label="vs Std %" />
                      <SortTh col="BUDGET_VARIANCE_PCT"   label="vs Budget %" />
                    </tr>
                    <tr style={{ background: "var(--bg-secondary)" }}>
                      <th><input style={inputStyle} placeholder="filter…" value={colFilters.material}
                        onChange={e => setColFilters(f => ({ ...f, material: e.target.value }))} /></th>
                      <th />
                      <th><input style={inputStyle} placeholder="filter…" value={colFilters.site}
                        onChange={e => setColFilters(f => ({ ...f, site: e.target.value }))} /></th>
                      <th>
                        <select style={{ ...inputStyle, cursor: "pointer" }} value={colFilters.period}
                          onChange={e => setColFilters(f => ({ ...f, period: e.target.value }))}>
                          <option value="">All</option>
                          <option value="001">Jan</option>
                          <option value="002">Feb</option>
                          <option value="003">Mar</option>
                          <option value="004">Apr</option>
                          <option value="005">May</option>
                          <option value="006">Jun</option>
                        </select>
                      </th>
                      <th /><th /><th /><th /><th /><th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r, i) => {
                      const vp  = parseFloat(r.COST_VARIANCE_PCT)
                      const cls = vp > 2 ? "var-positive" : vp < -2 ? "var-negative" : "var-neutral"
                      return (
                        <tr key={i} style={{ cursor: "pointer" }}
                          onClick={() => setSelectedProduct(r.MATERIAL_NUMBER)}>
                          <td style={{ fontFamily: "monospace", fontSize: ".78rem" }}>{r.MATERIAL_NUMBER}</td>
                          <td>{r.MATERIAL_DESCRIPTION}</td>
                          <td>{r.PLANT_NAME}</td>
                          <td>{PERIOD_LABELS[r.PERIOD] || r.PERIOD}</td>
                          <td title="Click to explain" onClick={e => { e.stopPropagation(); explainNumber(rowCtx(r, "budget")) }}
                            style={{ cursor: "help" }}>
                            ${parseFloat(r.STANDARD_COST_PER_UNIT).toFixed(2)}
                          </td>
                          <td style={{ color: "var(--text-muted)" }}>
                            {r.BUDGET_COST_PER_UNIT != null ? `$${parseFloat(r.BUDGET_COST_PER_UNIT).toFixed(2)}` : "—"}
                          </td>
                          <td title="Click to explain" onClick={e => { e.stopPropagation(); explainNumber(rowCtx(r, "actual")) }}
                            style={{ cursor: "help" }}>
                            ${parseFloat(r.ACTUAL_COST_PER_UNIT).toFixed(2)}
                          </td>
                          <td className={cls} title="Click to explain"
                            onClick={e => { e.stopPropagation(); explainNumber(rowCtx(r, "variance")) }}
                            style={{ cursor: "help" }}>
                            {parseFloat(r.COST_VARIANCE_ABS) > 0 ? "+" : ""}${parseFloat(r.COST_VARIANCE_ABS).toFixed(2)}
                          </td>
                          <td className={cls} title="Click to explain"
                            onClick={e => { e.stopPropagation(); explainNumber(rowCtx(r, "variance_pct")) }}
                            style={{ cursor: "help" }}>
                            {vp > 0 ? "+" : ""}{vp.toFixed(1)}%
                          </td>
                          {(() => {
                            const bvp = r.BUDGET_VARIANCE_PCT != null ? parseFloat(r.BUDGET_VARIANCE_PCT) : null
                            const bcls = bvp == null ? "var-neutral" : bvp > 2 ? "var-positive" : bvp < -2 ? "var-negative" : "var-neutral"
                            return (
                              <td className={bcls}>
                                {bvp == null ? "—" : `${bvp > 0 ? "+" : ""}${bvp.toFixed(1)}%`}
                              </td>
                            )
                          })()}
                        </tr>
                      )
                    })}
                    {filteredRows.length === 0 && (
                      <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20 }}>No rows match the filters</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {/* ── PIVOT: Products × Sites ── */}
              {viewMode === "site" && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>Product</th>
                      {uniqueSites.map(s => <th key={s} style={{ textAlign: "center", minWidth: 90 }}>{s}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueProds.map(prod => {
                      const desc = pivotRows.find(r => r.MATERIAL_NUMBER === prod)?.MATERIAL_DESCRIPTION || prod
                      return (
                        <tr key={prod}>
                          <td>
                            <span style={{ fontFamily: "monospace", fontSize: ".78rem" }}>{prod}</span>
                            <br /><span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{desc}</span>
                          </td>
                          {uniqueSites.map(site => {
                            const row = pivotRows.find(r => r.MATERIAL_NUMBER === prod && r.PLANT_NAME === site)
                            const vp  = row ? parseFloat(row.COST_VARIANCE_PCT) : null
                            return (
                              <td key={site}
                                style={{ background: pivotBg(vp), textAlign: "center", fontSize: ".83rem",
                                  cursor: row ? "pointer" : "default", transition: "filter 0.15s" }}
                                title={row ? "Click to explain" : undefined}
                                onClick={() => row && explainNumber(rowCtx(row, "variance_pct"))}>
                                {vp !== null ? <strong>{vp > 0 ? "+" : ""}{vp.toFixed(1)}%</strong> : <span style={{ color: "var(--border)" }}>—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* ── PIVOT: Products × Periods ── */}
              {viewMode === "period" && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>Product</th>
                      {uniquePeriods.map(p => <th key={p} style={{ textAlign: "center", minWidth: 90 }}>{PERIOD_LABELS[p] || p}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueProds.map(prod => {
                      const desc = pivotRows.find(r => r.MATERIAL_NUMBER === prod)?.MATERIAL_DESCRIPTION || prod
                      return (
                        <tr key={prod}>
                          <td>
                            <span style={{ fontFamily: "monospace", fontSize: ".78rem" }}>{prod}</span>
                            <br /><span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{desc}</span>
                          </td>
                          {uniquePeriods.map(period => {
                            const row = pivotRows.find(r => r.MATERIAL_NUMBER === prod && r.PERIOD === period)
                            const vp  = row ? parseFloat(row.COST_VARIANCE_PCT) : null
                            return (
                              <td key={period}
                                style={{ background: pivotBg(vp), textAlign: "center", fontSize: ".83rem",
                                  cursor: row ? "pointer" : "default" }}
                                title={row ? "Click to explain" : undefined}
                                onClick={() => row && explainNumber(rowCtx(row, "variance_pct"))}>
                                {vp !== null ? <strong>{vp > 0 ? "+" : ""}{vp.toFixed(1)}%</strong> : <span style={{ color: "var(--border)" }}>—</span>}
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

          {/* ── AI EXPLAIN MODAL ── */}
          {explainCell && (
            <div className="modal-overlay" onClick={() => setExplainCell(null)}>
              <div className="modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <div>
                    <div className="modal-title">{explainCell.description}</div>
                    <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 2 }}>{explainCell.product}</div>
                  </div>
                  <button className="modal-close" onClick={() => setExplainCell(null)}>✕</button>
                </div>
                <div className="modal-context">
                  <span>Site: <strong>{explainCell.site}</strong></span>
                  <span>Period: <strong>{explainCell.period}</strong></span>
                  <span>Budget: <strong>${explainCell.budget}</strong></span>
                  <span>Actual: <strong>${explainCell.actual}</strong></span>
                  <span style={{ color: parseFloat(explainCell.variancePct) > 0 ? "var(--danger)" : "var(--success)" }}>
                    Variance: <strong>{parseFloat(explainCell.variancePct) > 0 ? "+" : ""}{explainCell.variancePct}%</strong>
                  </span>
                </div>
                <div className="modal-body">
                  {explainText && <ReactMarkdown remarkPlugins={[remarkGfm]}>{explainText}</ReactMarkdown>}
                  {explainLoading && <span className="cursor">▋</span>}
                  {!explainLoading && !explainText && <span style={{ color: "var(--text-muted)" }}>Starting analysis…</span>}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
