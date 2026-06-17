// Server Component — fetches KPI summary at request time
import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { Dashboard } from "@/components/Dashboard"

export const dynamic = "force-dynamic"

const KPI_QUERY = `
  SELECT
    COUNT(DISTINCT MATERIAL_NUMBER) AS TOTAL_PRODUCTS,
    COUNT(DISTINCT PLANT_CODE)      AS TOTAL_SITES,
    ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VARIANCE_PCT,
    COUNT_IF(ABS(COST_VARIANCE_PCT) > 5) AS PRODUCTS_AT_RISK,
    ROUND(SUM(ACTUAL_COST_PER_UNIT - STANDARD_COST_PER_UNIT), 0) AS TOTAL_VARIANCE_USD
  FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
  WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
`

export default async function Home() {
  let kpis: Record<string, any> = {}
  let error: string | null = null

  try {
    const rows = await querySnowflake(KPI_QUERY)
    kpis = rows[0] ?? {}
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load KPIs"
  }

  return <Dashboard kpis={kpis} error={error} />
}
