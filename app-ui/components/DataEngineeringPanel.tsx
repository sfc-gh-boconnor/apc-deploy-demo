"use client"
import { useState, useEffect } from "react"
import { DATABASE, WAREHOUSE } from "@/lib/config"

// -----------------------------------------------------------------------------
// Data Engineering tab — articulates how RAW SAP transactional data is engineered
// into the costing model using dbt Projects on Snowflake + Dynamic Tables, with
// links to the relevant Snowflake setup docs. Static narrative (no live query).
// -----------------------------------------------------------------------------

const BRAND = { magenta: "#830051", teal: "#00857c", gold: "#b8860b", purple: "#3c1053" }

// Verified Snowflake documentation URLs (checked to resolve).
const DOCS = {
  dbt: "https://docs.snowflake.com/en/user-guide/data-engineering/dbt-projects-on-snowflake",
  dbtDeploy: "https://docs.snowflake.com/en/user-guide/data-engineering/dbt-projects-on-snowflake-deploy",
  snowDbt: "https://docs.snowflake.com/en/developer-guide/snowflake-cli/command-reference/dbt-commands/overview",
  executeDbt: "https://docs.snowflake.com/en/sql-reference/sql/execute-dbt-project",
  dt: "https://docs.snowflake.com/en/user-guide/dynamic-tables-about",
  dtCreate: "https://docs.snowflake.com/en/user-guide/dynamic-tables/create",
  dtGuide: "https://docs.snowflake.com/en/user-guide/dynamic-tables/decision-guide",
  openflow: "https://docs.snowflake.com/en/user-guide/data-integration/openflow/about",
  openflowConnectors: "https://docs.snowflake.com/en/user-guide/data-integration/openflow/connectors/about-openflow-connectors",
  workspaces: "https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces",
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ color: BRAND.teal, textDecoration: "none", fontWeight: 600 }}>
      {children} ↗
    </a>
  )
}

// Deep links into THIS account's Snowsight objects (the live pipeline).
// SNOW is fetched dynamically via /api/account at runtime.
const SF_PATHS = {
  dbtSchema:  `/#/data/databases/${DATABASE}/schemas/DBT_ANALYTICS`,
  rawSchema:  `/#/data/databases/${DATABASE}/schemas/SAP_RAW`,
  database:   `/#/data/databases/${DATABASE}`,
  martCost:   `/#/data/databases/${DATABASE}/schemas/DBT_ANALYTICS/table/MART_PRODUCT_COST`,
  martTrend:  `/#/data/databases/${DATABASE}/schemas/DBT_ANALYTICS/table/MART_VARIANCE_TREND_WITH_FORECAST`,
}

const STAGES = [
  { key: "RAW", title: "RAW SAP", sub: `${DATABASE}.SAP_RAW`, color: "#9aa0a6",
    items: ["MATERIAL_LEDGER_DOC (postings)", "MBEW (eff-dated standard)", "KEPH (coded components)", "MARA / T001W (master)", "TCURR (FX rates)"] },
  { key: "STG", title: "Staging", sub: "stg_*", color: BRAND.gold,
    items: ["trim keys · zero-pad period", "de-dupe extract rows", "drop null postings", "decode FX inverted date"] },
  { key: "INT", title: "Intermediate", sub: "int_*", color: BRAND.teal,
    items: ["aggregate postings → unit cost", "net reversals (BWART 102)", "FX → USD", "resolve eff-dated standard", "derive budget + std reset"] },
  { key: "MART", title: "Marts (Dynamic Tables)", sub: "mart_*", color: BRAND.magenta,
    items: ["mart_product_cost (3-way)", "mart_cost_budget", "mart_cost_component_detail", "mart_product_cost_monthly"] },
]

const TRANSFORMS = [
  ["Posting line items (many per period)", "Aggregate → weighted-avg unit cost (Σamount ÷ Σqty)"],
  ["Reversals & duplicate extract rows", "Net BWART 102 out; de-dupe on document key"],
  ["Amounts in local currency (GBP/SEK/EUR/INR)", "FX-convert to USD via monthly TCURR rate"],
  ["Effective-dated standard prices (MBEW)", "Pick the standard in force for each fiscal year"],
  ["Coded fields (MTART, KEPH element #)", "Decode to labels via dbt seeds"],
  ["No budget / no variance in source", "Derive budget = prior-year actual; compute 3-way variance"],
]

export function DataEngineeringPanel() {
  const [snowUrl, setSnowUrl] = useState("")
  useEffect(() => {
    fetch("/api/account").then(r => r.json()).then(d => setSnowUrl(d.snowsightUrl || "")).catch(() => {})
  }, [])
  const SF = Object.fromEntries(Object.entries(SF_PATHS).map(([k, v]) => [k, snowUrl + v]))

  return (
    <div>
      <p className="section-lead">
        How raw SAP gets to the costing model. The dashboards above read analysis-ready tables — but in production that data
        starts as <strong>messy SAP transactions</strong>. This is the governed pipeline that does the real engineering, built with
        <strong> dbt Projects on Snowflake</strong> and materialised as <strong>Dynamic Tables</strong> — all inside Snowflake, no external orchestration.
      </p>

      {/* Pipeline flow */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">The medallion pipeline — raw SAP → costed</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>{DATABASE}.SAP_RAW → DBT_ANALYTICS</span></div>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, alignItems: "stretch" }}>
            {STAGES.map((s, i) => (
              <div key={s.key} style={{ position: "relative", background: "var(--bg-secondary)", borderRadius: "var(--radius)",
                borderTop: `3px solid ${s.color}`, padding: "12px 14px" }}>
                <div style={{ fontSize: ".82rem", fontWeight: 800, color: s.color }}>{s.title}</div>
                <div style={{ fontSize: ".64rem", color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 8 }}>{s.sub}</div>
                <ul style={{ margin: 0, paddingLeft: 14, fontSize: ".68rem", lineHeight: 1.5, color: "var(--text)" }}>
                  {s.items.map(it => <li key={it}>{it}</li>)}
                </ul>
                {i < STAGES.length - 1 && (
                  <div style={{ position: "absolute", right: -8, top: "50%", fontSize: "1.1rem", color: "var(--text-muted)", zIndex: 1 }}>→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* What's messy → what dbt does */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">The real transformation work</span></div>
        <div className="card-body" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Raw SAP characteristic</th><th>dbt transformation</th></tr></thead>
            <tbody>
              {TRANSFORMS.map(([a, b]) => (
                <tr key={a}><td>{a}</td><td style={{ fontWeight: 600 }}>{b}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tooling recommendation */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.purple}` }}>
          <div className="kpi-label">1 · Ingest</div>
          <div style={{ fontSize: ".95rem", fontWeight: 800, color: BRAND.purple, margin: "2px 0 6px" }}>SAP → Snowflake</div>
          <div className="kpi-sub" style={{ fontSize: ".7rem", lineHeight: 1.5 }}>
            Land raw SAP via <strong>SAP BDC</strong> zero-copy share, or <strong>Openflow</strong> CDC where BDC isn't exposed. No transformation here — just get the raw tables in.
            <div style={{ marginTop: 6 }}><Link href={DOCS.openflow}>Openflow</Link> · <Link href={DOCS.openflowConnectors}>Connectors</Link></div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.teal}` }}>
          <div className="kpi-label">2 · Transform</div>
          <div style={{ fontSize: ".95rem", fontWeight: 800, color: BRAND.teal, margin: "2px 0 6px" }}>dbt on Snowflake</div>
          <div className="kpi-sub" style={{ fontSize: ".7rem", lineHeight: 1.5 }}>
            Modular, <strong>tested, version-controlled</strong> SQL with lineage — the governance Finance needs. Runs natively in Snowflake, no extra infra.
            <div style={{ marginTop: 6 }}><Link href={DOCS.dbt}>dbt Projects</Link> · <Link href={DOCS.dbtDeploy}>Deploy</Link> · <Link href={DOCS.snowDbt}>snow dbt</Link></div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTop: `3px solid ${BRAND.magenta}` }}>
          <div className="kpi-label">3 · Materialise</div>
          <div style={{ fontSize: ".95rem", fontWeight: 800, color: BRAND.magenta, margin: "2px 0 6px" }}>Dynamic Tables</div>
          <div className="kpi-sub" style={{ fontSize: ".7rem", lineHeight: 1.5 }}>
            Declarative incremental refresh on a <strong>TARGET_LAG</strong> — the chain stays fresh with no tasks or streams. dbt models materialise as Dynamic Tables.
            <div style={{ marginTop: 6 }}><Link href={DOCS.dt}>Dynamic Tables</Link> · <Link href={DOCS.dtGuide}>Decision guide</Link></div>
          </div>
        </div>
      </div>

      {/* Governance / reconciliation */}
      <div className="card" style={{ marginBottom: 20, borderTop: `3px solid ${BRAND.teal}` }}>
        <div className="card-header"><span className="card-title">Governed &amp; reconciled — not a black box</span></div>
        <div className="card-body" style={{ fontSize: ".82rem", lineHeight: 1.6 }}>
          The pipeline ships with dbt tests, including <strong>reconciliation tests</strong> that prove the model rebuilt from raw SAP
          matches the curated truth within a sub-cent FX tolerance. Latest run: <strong style={{ color: BRAND.teal }}>48 / 48 tests passed</strong>
          {" "}(14 Dynamic Tables, 2 seeds), incl. <code>assert_product_cost_reconciles</code> and <code>assert_budget_reconciles</code>.
          Every model is version-controlled, documented and lineage-tracked in Snowsight Workspaces.
          <div style={{ marginTop: 8 }}>
            <Link href={DOCS.executeDbt}>EXECUTE DBT PROJECT</Link> · <Link href={DOCS.workspaces}>Workspaces</Link>
          </div>
        </div>
      </div>

      {/* Open in Snowsight — live objects in this account */}
      <div className="card" style={{ marginBottom: 20, borderTop: `3px solid ${BRAND.magenta}` }}>
        <div className="card-header"><span className="card-title">Open in Snowsight — the live pipeline in this account</span>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>{DATABASE} · deployed objects</span></div>
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 28px", fontSize: ".8rem", lineHeight: 1.9 }}>
          <div><Link href={SF.dbtSchema}>DBT_ANALYTICS schema — dbt project + 19 Dynamic Tables</Link></div>
          <div><Link href={SF.rawSchema}>SAP_RAW schema — raw SAP extracts (source)</Link></div>
          <div><Link href={SF.martCost}>MART_PRODUCT_COST — the costed model</Link></div>
          <div><Link href={SF.martTrend}>MART_VARIANCE_TREND_WITH_FORECAST</Link></div>
          <div><Link href={SF.database}>{DATABASE} database</Link></div>
        </div>
        <div className="card-body" style={{ paddingTop: 0, fontSize: ".68rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Opens Snowsight for this account — browse the deployed dbt project, inspect each Dynamic Table's refresh/lineage, and run the marts directly.
        </div>
      </div>

      {/* Setup links */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">Reference docs — how to set it up</span></div>
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 28px", fontSize: ".8rem", lineHeight: 1.9 }}>
          <div><Link href={DOCS.dbt}>dbt Projects on Snowflake</Link></div>
          <div><Link href={DOCS.dt}>Dynamic Tables</Link></div>
          <div><Link href={DOCS.dbtDeploy}>Deploy a dbt project</Link></div>
          <div><Link href={DOCS.dtCreate}>Create a Dynamic Table</Link></div>
          <div><Link href={DOCS.snowDbt}>snow dbt CLI commands</Link></div>
          <div><Link href={DOCS.dtGuide}>Dynamic Tables decision guide</Link></div>
          <div><Link href={DOCS.openflow}>Openflow (SAP / CDC ingestion)</Link></div>
          <div><Link href={DOCS.workspaces}>Snowsight Workspaces (dbt IDE)</Link></div>
          <div><Link href={DOCS.executeDbt}>EXECUTE DBT PROJECT (SQL)</Link></div>
        </div>
      </div>

      <p style={{ fontSize: ".7rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        Pipeline source: <code>dbt/apc</code> (staging → intermediate → marts) + <code>sql/09_raw_sap.sql</code> raw schema.
        Full transform walkthrough in <code>docs/dbt-raw-to-costed-lineage.md</code>. Links open the official Snowflake documentation.
      </p>
    </div>
  )
}
