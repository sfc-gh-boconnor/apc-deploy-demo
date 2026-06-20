import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await querySnowflake(`
      SELECT
        MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_CODE, PLANT_NAME,
        PERIOD, STANDARD_COST_PER_UNIT, ACTUAL_COST_PER_UNIT,
        COST_VARIANCE_ABS, COST_VARIANCE_PCT
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
      ORDER BY MATERIAL_NUMBER, PLANT_CODE, PERIOD
    `)
    return Response.json({ rows })
  } catch (e) {
    console.error("[pivot]", e)
    return Response.json({ rows: [] }, { status: 500 })
  }
}
