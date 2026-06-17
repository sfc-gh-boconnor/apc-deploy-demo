import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  const rows = await querySnowflake(`
    SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_NAME,
           COST_COMPONENT, PERIOD, VARIANCE_PCT, Z_SCORE
    FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_ANOMALIES
    WHERE IS_ANOMALY = TRUE
    ORDER BY ABS(Z_SCORE) DESC
    LIMIT 20
  `)

  const count = await querySnowflake(`
    SELECT COUNT(*) AS TOTAL FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_ANOMALIES WHERE IS_ANOMALY = TRUE
  `)

  return Response.json({ rows, totalAnomalies: (count[0] as any)?.TOTAL ?? 0 })
}
