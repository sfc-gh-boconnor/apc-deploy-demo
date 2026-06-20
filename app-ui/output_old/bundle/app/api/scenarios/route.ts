import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  const rows = await querySnowflake(`
    SELECT SCENARIO_ID, SCENARIO_NAME, DESCRIPTION,
           API_COST_CHANGE_PCT, LABOUR_COST_CHANGE_PCT,
           VOLUME_MULTIPLIER, FX_ADJUSTMENT_PCT, ENERGY_COST_CHANGE_PCT, IS_BASE
    FROM ${DATABASE}.ANALYTICS.SCENARIO_INPUTS
    ORDER BY SCENARIO_ID
  `)
  return Response.json({ scenarios: rows })
}
