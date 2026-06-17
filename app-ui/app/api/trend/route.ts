import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await querySnowflake(`
      SELECT PERIOD, ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VARIANCE_PCT,
             SUM(STANDARD_COST_PER_UNIT) AS TOTAL_STANDARD,
             SUM(ACTUAL_COST_PER_UNIT)   AS TOTAL_ACTUAL
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
      GROUP BY PERIOD ORDER BY PERIOD
    `)
    return Response.json({ rows })
  } catch (e) {
    console.error(new Date().toISOString(), "[trend]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Query failed", rows: [] }, { status: 500 })
  }
}
