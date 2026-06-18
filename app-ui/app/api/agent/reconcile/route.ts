import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Agent Reconcile: full cost reconciliation decomposition.
 * Orchestrates multiple marts to produce a structured root-cause analysis
 * ranked by financial impact.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const material = searchParams.get("material_number")
  const plant = searchParams.get("plant_code")
  const period = searchParams.get("period")

  try {
    const conditions: string[] = ["FISCAL_YEAR = 2026"]
    if (material) conditions.push(`MATERIAL_NUMBER = '${material}'`)
    if (plant) conditions.push(`PLANT_CODE = '${plant}'`)
    if (period) conditions.push(`PERIOD = ${period}`)

    const whereClause = conditions.join(" AND ")

    // Orchestrate all four reconciliation dimensions in parallel
    const [rateData, volumeData, componentData, cogmData] = await Promise.all([
      // 1. Rate stability → rate driver
      querySnowflake(`
        SELECT PLANT_CODE, PLANT_NAME, COST_ELEMENT,
               ROUND(RATE_CHANGE_PCT, 2) AS RATE_CHANGE_PCT,
               ROUND(STABILITY_INDEX, 3) AS STABILITY_INDEX,
               ROUND(FINANCIAL_IMPACT, 2) AS FINANCIAL_IMPACT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_RATE_STABILITY
        WHERE ${whereClause.replace(/MATERIAL_NUMBER = '[^']+' AND /g, '')}
        ORDER BY ABS(FINANCIAL_IMPACT) DESC
        LIMIT 20
      `),
      // 2. Volume alignment → demand driver
      querySnowflake(`
        SELECT PLANT_CODE, PLANT_NAME, MATERIAL_NUMBER,
               ROUND(CAPACITY_UTILIZATION_PCT, 1) AS UTIL_PCT,
               ROUND(VOLUME_VARIANCE_PCT, 1) AS VOLUME_VARIANCE_PCT,
               ROUND(SAVINGS_POTENTIAL_PER_UNIT, 2) AS SAVINGS_PER_UNIT,
               ROUND(FINANCIAL_IMPACT, 2) AS FINANCIAL_IMPACT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_VOLUME_ALIGNMENT
        WHERE ${whereClause}
        ORDER BY ABS(FINANCIAL_IMPACT) DESC
        LIMIT 20
      `),
      // 3. Cost component detail → component driver
      querySnowflake(`
        SELECT MATERIAL_NUMBER, PLANT_CODE, COST_COMPONENT,
               ROUND(ACTUAL_COST, 2) AS ACTUAL,
               ROUND(STANDARD_COST, 2) AS STANDARD,
               ROUND(ACTUAL_COST - STANDARD_COST, 2) AS VARIANCE_ABS,
               ROUND((ACTUAL_COST - STANDARD_COST) / NULLIF(STANDARD_COST, 0) * 100, 1) AS VARIANCE_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_COMPONENT_DETAIL
        WHERE ${whereClause}
        ORDER BY ABS(ACTUAL_COST - STANDARD_COST) DESC
        LIMIT 30
      `),
      // 4. COGM evolution → trajectory + TA context
      querySnowflake(`
        SELECT MATERIAL_NUMBER, PLANT_CODE, PERIOD,
               ROUND(COGM_PER_UNIT, 2) AS COGM_PER_UNIT,
               ROUND(COGM_CHANGE_PCT, 2) AS COGM_CHANGE_PCT,
               ROUND(TRANSFER_ACTIVITY_IMPACT, 2) AS TA_IMPACT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COGM_EVOLUTION
        WHERE ${whereClause}
        ORDER BY PERIOD DESC
        LIMIT 20
      `)
    ])

    const rates = rateData as any[]
    const volumes = volumeData as any[]
    const components = componentData as any[]
    const cogm = cogmData as any[]

    // Rank root causes by financial impact
    const rootCauses: Array<{ category: string; driver: string; impact: number; detail: string }> = []

    // Rate-driven root causes
    for (const r of rates) {
      if (Math.abs(r.FINANCIAL_IMPACT) > 0) {
        rootCauses.push({
          category: "Rate Stability",
          driver: `${r.COST_ELEMENT} at ${r.PLANT_NAME}`,
          impact: r.FINANCIAL_IMPACT,
          detail: `Rate changed ${r.RATE_CHANGE_PCT}% (stability index: ${r.STABILITY_INDEX})`
        })
      }
    }

    // Volume-driven root causes
    for (const v of volumes) {
      if (Math.abs(v.FINANCIAL_IMPACT) > 0) {
        rootCauses.push({
          category: "Volume Alignment",
          driver: `${v.MATERIAL_NUMBER} at ${v.PLANT_NAME}`,
          impact: v.FINANCIAL_IMPACT,
          detail: `Utilization ${v.UTIL_PCT}%, volume variance ${v.VOLUME_VARIANCE_PCT}%, savings potential $${v.SAVINGS_PER_UNIT}/unit`
        })
      }
    }

    // Component-driven root causes
    const componentGroups: Record<string, number> = {}
    for (const c of components) {
      componentGroups[c.COST_COMPONENT] = (componentGroups[c.COST_COMPONENT] || 0) + c.VARIANCE_ABS
    }
    for (const [comp, totalVar] of Object.entries(componentGroups)) {
      if (Math.abs(totalVar) > 0) {
        rootCauses.push({
          category: "Component Driver",
          driver: comp,
          impact: totalVar,
          detail: `Total component variance: $${Math.round(totalVar * 100) / 100}`
        })
      }
    }

    // Sort by absolute financial impact
    rootCauses.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))

    // COGM trajectory summary
    const cogmTrend = cogm.length > 1
      ? (cogm[0] as any).COGM_CHANGE_PCT > 0 ? "increasing" : "decreasing"
      : "insufficient data"

    return Response.json({
      rootCauses: rootCauses.slice(0, 15),
      rateAnalysis: { data: rates, topIssue: rates[0] || null },
      volumeAnalysis: { data: volumes, topIssue: volumes[0] || null },
      componentAnalysis: { data: components, topComponents: Object.entries(componentGroups).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5) },
      cogmTrajectory: { data: cogm, trend: cogmTrend },
      summary: {
        totalRootCauses: rootCauses.length,
        topCategory: rootCauses[0]?.category || "None",
        topDriver: rootCauses[0]?.driver || "None",
        topImpact: rootCauses[0]?.impact || 0,
        cogmTrend,
        filters: { material, plant, period }
      }
    })
  } catch (e) {
    console.error("[agent/reconcile]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Reconciliation failed" }, { status: 500 })
  }
}
