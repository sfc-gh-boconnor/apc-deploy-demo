import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Agent Scenario: what-if calculation with volume rebalancing between plants.
 * Extends the existing /api/scenarios/forecast with plant-shifting capability
 * using MART_COGM_EVOLUTION for savings calculation.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const apiPct = parseFloat(searchParams.get("api_pct") ?? "0")
  const energyPct = parseFloat(searchParams.get("energy_pct") ?? "0")
  const volumeMult = parseFloat(searchParams.get("volume_mult") ?? "1.0")
  const labourPct = parseFloat(searchParams.get("labour_pct") ?? "0")
  const fxPct = parseFloat(searchParams.get("fx_pct") ?? "0")
  const shiftFrom = searchParams.get("shift_plant_from")
  const shiftTo = searchParams.get("shift_plant_to")

  try {
    // Base scenario calculation (same as existing /api/scenarios/forecast)
    const costResults = await querySnowflake(`
      SELECT MATERIAL_NUMBER,
             ROUND(VARIANCE_PCT, 2) AS BASE_VARIANCE,
             ROUND(VARIANCE_PCT + (${apiPct} * 0.35) + (${energyPct} * 0.15) + (${labourPct} * 0.2) + (${fxPct} * 0.1), 2) AS SCENARIO_VARIANCE,
             ROUND(AVG_ACTUAL_COST, 2) AS BASE_COST,
             ROUND(AVG_ACTUAL_COST * (1.0 + (${apiPct} + ${energyPct} + ${labourPct}) / 300.0) * ${volumeMult}, 2) AS SCENARIO_COST,
             ROUND(AVG_ACTUAL_COST * (1.0 + (${apiPct} + ${energyPct} + ${labourPct}) / 300.0) * ${volumeMult} - AVG_ACTUAL_COST, 2) AS COST_IMPACT
      FROM ${DATABASE}.ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1"
      WHERE TS = (SELECT MAX(TS) FROM ${DATABASE}.ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1")
      ORDER BY ABS(VARIANCE_PCT + (${apiPct} * 0.35) + (${energyPct} * 0.15)) DESC
    `)

    let volumeRebalancing = null

    // Volume rebalancing: calculate savings from shifting production
    if (shiftFrom && shiftTo) {
      const rebalanceResults = await querySnowflake(`
        SELECT
          src.MATERIAL_NUMBER,
          src.PLANT_CODE AS FROM_PLANT,
          src.ACTUAL_COST_PER_UNIT AS FROM_COGM,
          dst.PLANT_CODE AS TO_PLANT,
          dst.ACTUAL_COST_PER_UNIT AS TO_COGM,
          ROUND(src.ACTUAL_COST_PER_UNIT - dst.ACTUAL_COST_PER_UNIT, 2) AS SAVINGS_PER_UNIT,
          ROUND((src.ACTUAL_COST_PER_UNIT - dst.ACTUAL_COST_PER_UNIT) / NULLIF(src.ACTUAL_COST_PER_UNIT, 0) * 100, 1) AS SAVINGS_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COGM_EVOLUTION src
        JOIN ${DATABASE}.DBT_ANALYTICS.MART_COGM_EVOLUTION dst
          ON src.MATERIAL_NUMBER = dst.MATERIAL_NUMBER
          AND src.PERIOD = dst.PERIOD
          AND src.FISCAL_YEAR = dst.FISCAL_YEAR
        WHERE src.PLANT_CODE = '${shiftFrom}'
          AND dst.PLANT_CODE = '${shiftTo}'
          AND src.FISCAL_YEAR = 2026
          AND src.PERIOD = (SELECT MAX(PERIOD) FROM ${DATABASE}.DBT_ANALYTICS.MART_COGM_EVOLUTION WHERE FISCAL_YEAR = 2026)
        ORDER BY SAVINGS_PER_UNIT DESC
      `)

      const rebalanceRows = rebalanceResults as any[]
      const totalSavings = rebalanceRows.reduce((s: number, r: any) => s + (r.SAVINGS_PER_UNIT || 0), 0)

      volumeRebalancing = {
        fromPlant: shiftFrom,
        toPlant: shiftTo,
        products: rebalanceRows,
        totalSavingsPerUnit: Math.round(totalSavings * 100) / 100,
        avgSavingsPct: rebalanceRows.length > 0
          ? Math.round(rebalanceRows.reduce((s: number, r: any) => s + (r.SAVINGS_PCT || 0), 0) / rebalanceRows.length * 10) / 10
          : 0,
        recommendation: totalSavings > 0
          ? `Shifting production from ${shiftFrom} to ${shiftTo} saves $${Math.round(totalSavings * 100) / 100}/unit on average`
          : `No savings from shifting ${shiftFrom} → ${shiftTo}; consider reverse direction`
      }
    }

    const results = costResults as any[]
    const baseTotalVariance = results.reduce((s: number, r: any) => s + r.BASE_VARIANCE, 0) / results.length
    const scenarioTotalVariance = results.reduce((s: number, r: any) => s + r.SCENARIO_VARIANCE, 0) / results.length
    const totalCostImpact = results.reduce((s: number, r: any) => s + r.COST_IMPACT, 0)

    return Response.json({
      products: results,
      volumeRebalancing,
      summary: {
        baseVariance: Math.round(baseTotalVariance * 100) / 100,
        scenarioVariance: Math.round(scenarioTotalVariance * 100) / 100,
        varianceShift: Math.round((scenarioTotalVariance - baseTotalVariance) * 100) / 100,
        totalCostImpact: Math.round(totalCostImpact * 100) / 100,
        scenarioParams: { apiPct, energyPct, volumeMult, labourPct, fxPct, shiftFrom, shiftTo },
        recommendations: generateRecommendations(results, volumeRebalancing)
      }
    })
  } catch (e) {
    console.error("[agent/scenario]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Scenario calculation failed" }, { status: 500 })
  }
}

function generateRecommendations(results: any[], rebalancing: any): string[] {
  const recs: string[] = []
  const highImpact = results.filter((r: any) => Math.abs(r.COST_IMPACT) > 5)
  if (highImpact.length > 0) {
    recs.push(`${highImpact.length} products have >$5/unit cost impact — prioritise renegotiation for ${highImpact[0].MATERIAL_NUMBER}`)
  }
  if (rebalancing && rebalancing.totalSavingsPerUnit > 0) {
    recs.push(rebalancing.recommendation)
  }
  const avgScenarioVar = results.reduce((s: number, r: any) => s + r.SCENARIO_VARIANCE, 0) / results.length
  if (avgScenarioVar > 10) {
    recs.push("Scenario pushes average variance above 10% — trigger cost review with Finance")
  }
  if (recs.length === 0) recs.push("Scenario impact within normal thresholds")
  return recs
}
