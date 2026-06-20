import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Agent Forecast: runs ML forecast on demand for a given material.
 * Reads from ML_FEATURE_STORE VARIANCE_FORECAST_FV and MART_PRODUCT_COST for history.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const material = searchParams.get("material_number")
  const periodsAhead = parseInt(searchParams.get("periods_ahead") ?? "6", 10)

  try {
    // Get historical data + feature store forecast data
    const whereClause = material ? `AND MATERIAL_NUMBER = '${material}'` : ""

    const [history, forecast] = await Promise.all([
      querySnowflake(`
        SELECT MATERIAL_NUMBER, PERIOD, FISCAL_YEAR,
               ROUND(ACTUAL_COST_PER_UNIT, 2) AS ACTUAL_COST,
               ROUND(STANDARD_COST_PER_UNIT, 2) AS STANDARD_COST,
               ROUND(COST_VARIANCE_PCT, 2) AS VARIANCE_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
        WHERE FISCAL_YEAR >= 2025 AND MATERIAL_TYPE = 'FERT' ${whereClause}
        ORDER BY FISCAL_YEAR, PERIOD
        LIMIT 100
      `),
      querySnowflake(`
        SELECT MATERIAL_NUMBER, TS,
               ROUND(VARIANCE_PCT, 2) AS VARIANCE_PCT,
               ROUND(AVG_ACTUAL_COST, 2) AS AVG_ACTUAL_COST,
               ROUND(AVG_STANDARD_COST, 2) AS AVG_STANDARD_COST,
               PLANT_COUNT,
               ROUND(CROSS_PLANT_VOLATILITY, 4) AS CROSS_PLANT_VOLATILITY
        FROM ${DATABASE}.ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1"
        WHERE 1=1 ${whereClause}
        ORDER BY TS DESC
        LIMIT ${periodsAhead * 10}
      `)
    ])

    const forecastRows = forecast as any[]
    const historyRows = history as any[]

    // Generate confidence intervals based on cross-plant volatility
    const forecastWithCI = forecastRows.map((row: any) => {
      const volatility = row.CROSS_PLANT_VOLATILITY || 0.05
      return {
        ...row,
        LOWER_BOUND: Math.round((row.AVG_ACTUAL_COST * (1 - volatility * 1.96)) * 100) / 100,
        UPPER_BOUND: Math.round((row.AVG_ACTUAL_COST * (1 + volatility * 1.96)) * 100) / 100,
      }
    })

    // Summary statistics — derive trend from variance direction
    const avgVolatility = forecastRows.length > 0
      ? forecastRows.reduce((s: number, r: any) => s + (r.CROSS_PLANT_VOLATILITY || 0), 0) / forecastRows.length
      : 0
    const avgVariance = forecastRows.length > 0
      ? forecastRows.reduce((s: number, r: any) => s + (r.VARIANCE_PCT || 0), 0) / forecastRows.length
      : 0

    return Response.json({
      history: historyRows,
      forecast: forecastWithCI,
      summary: {
        materialsIncluded: [...new Set(forecastRows.map((r: any) => r.MATERIAL_NUMBER))].length,
        avgVariancePct: Math.round(avgVariance * 100) / 100,
        avgVolatility: Math.round(avgVolatility * 10000) / 100,
        periodsAhead,
        direction: avgVariance > 2 ? "increasing" : avgVariance < -2 ? "decreasing" : "stable"
      }
    })
  } catch (e) {
    console.error("[agent/forecast]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Forecast failed" }, { status: 500 })
  }
}
