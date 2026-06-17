import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

/**
 * Scenario Forecast: takes scenario parameters and calculates the predicted
 * cost variance shift and cost impact using the Feature Store's latest data.
 *
 * Weighting: API 35%, Energy 15%, Labour 20%, FX 10% of COGS impact on variance.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const apiPct = parseFloat(searchParams.get("api_pct") ?? "0")
  const energyPct = parseFloat(searchParams.get("energy_pct") ?? "0")
  const volumeMult = parseFloat(searchParams.get("volume_mult") ?? "1.0")
  const labourPct = parseFloat(searchParams.get("labour_pct") ?? "0")
  const fxPct = parseFloat(searchParams.get("fx_pct") ?? "0")

  try {
    const costResults = await querySnowflake(`
      SELECT
        MATERIAL_NUMBER,
        ROUND(VARIANCE_PCT, 2) AS BASE_VARIANCE,
        ROUND(VARIANCE_PCT + (${apiPct} * 0.35) + (${energyPct} * 0.15) + (${labourPct} * 0.2) + (${fxPct} * 0.1), 2) AS SCENARIO_VARIANCE,
        ROUND(AVG_ACTUAL_COST, 2) AS BASE_COST,
        ROUND(AVG_ACTUAL_COST * (1.0 + (${apiPct} + ${energyPct} + ${labourPct}) / 300.0), 2) AS SCENARIO_COST,
        ROUND(AVG_ACTUAL_COST * (1.0 + (${apiPct} + ${energyPct} + ${labourPct}) / 300.0) - AVG_ACTUAL_COST, 2) AS COST_IMPACT
      FROM ${DATABASE}.ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1"
      WHERE TS = (SELECT MAX(TS) FROM ${DATABASE}.ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1")
      ORDER BY ABS(VARIANCE_PCT + (${apiPct} * 0.35) + (${energyPct} * 0.15)) DESC
    `)

    const results = costResults as any[]
    const baseTotalVariance = results.reduce((s, r) => s + r.BASE_VARIANCE, 0) / results.length
    const scenarioTotalVariance = results.reduce((s, r) => s + r.SCENARIO_VARIANCE, 0) / results.length
    const totalCostImpact = results.reduce((s, r) => s + r.COST_IMPACT, 0)

    return Response.json({
      products: results,
      summary: {
        baseVariance: Math.round(baseTotalVariance * 100) / 100,
        scenarioVariance: Math.round(scenarioTotalVariance * 100) / 100,
        varianceShift: Math.round((scenarioTotalVariance - baseTotalVariance) * 100) / 100,
        totalCostImpact: Math.round(totalCostImpact * 100) / 100,
        scenarioParams: { apiPct, energyPct, volumeMult, labourPct, fxPct }
      }
    })
  } catch (e) {
    console.error("[scenarios/forecast]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Forecast failed" }, { status: 500 })
  }
}
