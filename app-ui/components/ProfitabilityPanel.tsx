"use client"
import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, LineChart, Line, ComposedChart, Area,
} from "recharts"

type Row = Record<string, any>

const MARKET_COLORS: Record<string, string> = {
  "United States":  "var(--primary)",
  "Europe":         "#8b5cf6",
  "Japan":          "#f59e0b",
  "Emerging Mkts":  "#10b981",
}

const PERIOD_LABELS: Record<string, string> = { "001": "P001 Jan", "002": "P002 Feb", "003": "P003 Mar" }

const fmt = (v: number, type: "m" | "pct" | "k" = "m") => {
  if (v == null || isNaN(v)) return "—"
  if (type === "pct") return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`
  if (type === "k") return `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`
  return `$${(Math.abs(v) / 1).toFixed(1)}M`
}

export function ProfitabilityPanel() {
  const [byProduct, setByProduct] = useState<Row[]>([])
  const [byMarket, setByMarket]   = useState<Row[]>([])
  const [trend, setTrend]         = useState<Row[]>([])
  const [period, setPeriod]       = useState("all")
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    const p = `period=${period}`
    Promise.all([
      fetch(`/api/profitability?${p}`).then(r => r.json()),
      fetch(`/api/profitability/market?${p}`).then(r => r.json()),
      fetch("/api/trend/ytd").then(r => r.json()),
    ]).then(([prod, mkt, tr]) => {
      setByProduct(prod.rows ?? [])
      setByMarket(mkt.rows ?? [])
      setTrend(tr.rows ?? [])
    }).finally(() => setLoading(false))
  }, [period])

  // KPI aggregates
  const totalRevenue     = byProduct.reduce((s, r) => s + parseFloat(r.REVENUE ?? 0), 0)
  const totalProfit      = byProduct.reduce((s, r) => s + parseFloat(r.GROSS_PROFIT_ACTUAL ?? 0), 0)
  const avgMargin        = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const avgBudgetMargin  = byProduct.length
    ? byProduct.reduce((s, r) => s + parseFloat(r.GROSS_MARGIN_PCT_BUDGET ?? 0), 0) / byProduct.length
    : 0
  const marginDelta = avgMargin - avgBudgetMargin

  // Market stacked data — one entry per product, keys per market
  const marketChartData = (() => {
    const products = Array.from(new Set(byMarket.map(r => r.MATERIAL_NUMBER)))
    return products.map(mat => {
      const entry: Record<string, any> = { product: mat.replace("-FIN", "") }
      byMarket.filter(r => r.MATERIAL_NUMBER === mat).forEach(r => {
        entry[r.MARKET] = parseFloat(r.REVENUE) / 1_000_000
      })
      return entry
    })
  })()

  const markets = Array.from(new Set(byMarket.map(r => r.MARKET)))

  if (loading) return <div className="loading">Loading profitability data from SAP BDC + SD…</div>

  return (
    <>
      {/* Context note */}
      <p className="section-lead">
        Combines <strong>CO-PC cost data</strong> (SAP MBEW/CKMLCR via SAP BDC Connect) with
        <strong> SD billing revenue</strong> (SAP VBRP/VBRK) to produce a
        <strong> CO-PA style gross margin view</strong> — the full product P&amp;L in one place.
      </p>

      {/* Period filter */}
      <div className="filter-row">
        <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="all">All Periods (YTD)</option>
          <option value="001">Period 001 — Jan</option>
          <option value="002">Period 002 — Feb</option>
          <option value="003">Period 003 — Mar</option>
        </select>
      </div>

      {/* KPI row */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Revenue (YTD)</div>
          <div className="kpi-value">{fmt(totalRevenue / 1_000_000)}</div>
          <div className="kpi-sub">All markets, all products</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Gross Profit</div>
          <div className="kpi-value success">{fmt(totalProfit / 1_000_000)}</div>
          <div className="kpi-sub">Revenue minus actual COGS</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Gross Margin</div>
          <div className={`kpi-value ${avgMargin > 60 ? "success" : avgMargin > 40 ? "warning" : "danger"}`}>
            {avgMargin.toFixed(1)}%
          </div>
          <div className="kpi-sub">vs {avgBudgetMargin.toFixed(1)}% budget</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Margin vs Budget</div>
          <div className={`kpi-value ${marginDelta >= 0 ? "success" : "danger"}`}>
            {marginDelta > 0 ? "+" : ""}{marginDelta.toFixed(1)} pp
          </div>
          <div className="kpi-sub">Actual vs standard cost impact</div>
        </div>
      </div>

      {/* Revenue trend + gross profit */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Revenue &amp; Gross Profit Trend — YTD</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>$M — all products, all markets</span>
        </div>
        <div className="card-body">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={trend.map(r => ({
              period: PERIOD_LABELS[r.PERIOD] || r.PERIOD,
              Revenue:      parseFloat(r.REVENUE_M ?? 0),
              "Gross Profit": parseFloat(r.GROSS_PROFIT_M ?? 0),
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}M`} />
              <Tooltip formatter={(v: any, n: string) => [`$${parseFloat(v).toFixed(1)}M`, n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Revenue" fill="var(--primary)" stroke="var(--primary)"
                fillOpacity={0.15} strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Gross Profit" stroke="var(--success)"
                strokeWidth={2} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Margin by product + Revenue by market side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Gross margin by product */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Gross Margin % by Product</span>
            <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Actual vs Budget</span>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={byProduct.map(r => ({
                  product: r.MATERIAL_NUMBER.replace("-FIN", ""),
                  "Actual %": parseFloat(r.GROSS_MARGIN_PCT_ACTUAL),
                  "Budget %": parseFloat(r.GROSS_MARGIN_PCT_BUDGET),
                }))}
                layout="vertical" margin={{ left: 55 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                <YAxis type="category" dataKey="product" tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v: any, n: string) => [`${parseFloat(v).toFixed(1)}%`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Budget %" fill="var(--border)" opacity={0.8} radius={[0, 3, 3, 0]} />
                <Bar dataKey="Actual %" fill="var(--primary)" opacity={0.85} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue by market stacked */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Revenue by Market ($M)</span>
            <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Stacked by region</span>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={marketChartData} margin={{ bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="product" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}M`} />
                <Tooltip formatter={(v: any, n: string) => [`$${parseFloat(v).toFixed(1)}M`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {markets.map(m => (
                  <Bar key={m} dataKey={m} stackId="a"
                    fill={MARKET_COLORS[m] ?? "#94a3b8"} opacity={0.85} radius={[0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Detail table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Product P&amp;L Summary — Actual vs Budget (CO-PA view)</span>
        </div>
        <div className="card-body" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Description</th>
                <th>Revenue</th>
                <th>COGS Budget</th>
                <th>COGS Actual</th>
                <th>Gross Profit</th>
                <th>Margin % (Actual)</th>
                <th>Margin % (Budget)</th>
                <th>Δ vs Budget</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((r, i) => {
                const delta = parseFloat(r.MARGIN_VARIANCE_PPS)
                const cls = delta >= 0 ? "var-negative" : "var-positive"
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: ".78rem" }}>
                      {r.MATERIAL_NUMBER.replace("-FIN", "")}
                    </td>
                    <td>{r.MATERIAL_DESCRIPTION}</td>
                    <td>${(parseFloat(r.REVENUE) / 1_000_000).toFixed(1)}M</td>
                    <td>${(parseFloat(r.COGS_BUDGET) / 1_000_000).toFixed(1)}M</td>
                    <td>${(parseFloat(r.COGS_ACTUAL) / 1_000_000).toFixed(1)}M</td>
                    <td className="var-negative">${(parseFloat(r.GROSS_PROFIT_ACTUAL) / 1_000_000).toFixed(1)}M</td>
                    <td style={{ fontWeight: 700 }}>{parseFloat(r.GROSS_MARGIN_PCT_ACTUAL).toFixed(1)}%</td>
                    <td style={{ color: "var(--text-muted)" }}>{parseFloat(r.GROSS_MARGIN_PCT_BUDGET).toFixed(1)}%</td>
                    <td className={cls}>{delta > 0 ? "+" : ""}{delta.toFixed(1)} pp</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
