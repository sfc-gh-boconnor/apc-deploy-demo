import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

/**
 * Sales Forecast under a scenario: perturbs cost assumptions and recalculates
 * forecast margin. Returns the same shape as the base forecast but with
 * scenario-adjusted margin figures.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const apiPct = parseFloat(searchParams.get("api_pct") ?? "0")
  const energyPct = parseFloat(searchParams.get("energy_pct") ?? "0")
  const volumeMult = parseFloat(searchParams.get("volume_mult") ?? "1.0")
  const labourPct = parseFloat(searchParams.get("labour_pct") ?? "0")
  const fxPct = parseFloat(searchParams.get("fx_pct") ?? "0")

  try {
    // Cost increase factor: weighted by typical pharma cost structure
    // API ~35% of COGS, Energy ~15%, Labour ~20%, FX ~10%, Other ~20%
    const costIncreasePct = (apiPct * 0.35) + (energyPct * 0.15) + (labourPct * 0.20) + (fxPct * 0.10)

    const rows = await querySnowflake(`
      SELECT
        TO_CHAR(TS, 'YYYY-MM-DD') AS TS,
        MATERIAL_NUMBER,
        DATA_TYPE,
        ACTUAL_MARGIN_PCT,
        FORECAST_MARGIN_PCT,
        FORECAST_REVENUE,
        COST_PER_UNIT,
        -- Scenario: increase cost, which compresses margin
        CASE
          WHEN DATA_TYPE = 'forecast' THEN
            ROUND(FORECAST_MARGIN_PCT - (${costIncreasePct} / 100.0 * (100 - FORECAST_MARGIN_PCT)), 1)
          ELSE ACTUAL_MARGIN_PCT
        END AS SCENARIO_MARGIN_PCT,
        -- Scenario: volume adjustment affects revenue
        CASE
          WHEN DATA_TYPE = 'forecast' THEN ROUND(FORECAST_REVENUE * ${volumeMult}, 0)
          ELSE NULL
        END AS SCENARIO_REVENUE
      FROM ${DATABASE}.DBT_ANALYTICS.MART_SALES_FORECAST
      ORDER BY MATERIAL_NUMBER, TS
    `)

    return Response.json({ trend: rows })
  } catch (e) {
    console.error("[sales-forecast/scenario]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
