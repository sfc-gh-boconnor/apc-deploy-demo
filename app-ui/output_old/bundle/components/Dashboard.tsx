"use client"
import { useState } from "react"
import { VariancePanel } from "./VariancePanel"
import { ChatPanel } from "./ChatPanel"
import { ScenarioPanel } from "./ScenarioPanel"
import { ProfitabilityPanel } from "./ProfitabilityPanel"
import { SmartInsightsPanel } from "./SmartInsightsPanel"
import { SalesForecastPanel } from "./SalesForecastPanel"
import { ObservabilityPanel } from "./ObservabilityPanel"

import { DataEngineeringPanel } from "./DataEngineeringPanel"

const TABS = ["Variance Analysis", "Scenario Analysis", "Profitability", "Sales Forecast", "Smart Insights", "Ask Cortex AI", "Data Engineering", "Observability & Trust"] as const
type Tab = typeof TABS[number]

type KPIs = Record<string, any>

export function Dashboard({ kpis, error }: { kpis: KPIs; error: string | null }) {
  const [tab, setTab] = useState<Tab>("Data Engineering")

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div>
            <div className="header-title">AI Product Costing Accelerator</div>
            <div className="header-sub">SAP BDC Connect · Snowflake Cortex AI · Data Engineering</div>
          </div>
          <span className="header-badge">Workspaces · CoCo CLI · snow dbt</span>
        </div>
        <div className="tabs">
          <div className="tabs-inner">
            {TABS.map(t => (
              <button key={t} className={`tab-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-box">{error}</div>}

        {tab === "Variance Analysis" && <VariancePanel />}
        {tab === "Scenario Analysis" && <ScenarioPanel />}
        {tab === "Profitability" && <ProfitabilityPanel />}
        {tab === "Sales Forecast" && <SalesForecastPanel />}
        {tab === "Smart Insights" && <SmartInsightsPanel />}
        {tab === "Ask Cortex AI" && <ChatPanel />}
        {tab === "Data Engineering" && <DataEngineeringPanel />}
        {tab === "Observability & Trust" && <ObservabilityPanel />}
      </main>
    </>
  )
}
