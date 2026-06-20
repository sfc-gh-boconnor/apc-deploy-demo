import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  const rows = await querySnowflake(`
    WITH cost_by_period AS (
      SELECT
        PERIOD,
        SUM(COALESCE(BUDGET_COST_PER_UNIT, STANDARD_COST_PER_UNIT) * 1000) AS BUDGET_COST,
        SUM(ACTUAL_COST_PER_UNIT   * 1000) AS ACTUAL_COST
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
      GROUP BY PERIOD
    ),
    revenue_by_period AS (
      SELECT
        PERIOD,
        SUM(REVENUE)             AS TOT_REVENUE,
        SUM(GROSS_PROFIT_ACTUAL) AS TOT_GP
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_PROFITABILITY
      WHERE FISCAL_YEAR = 2026
      GROUP BY PERIOD
    )
    SELECT
      c.PERIOD,
      ROUND(c.BUDGET_COST / 1000, 0) AS BUDGET_COST_K,
      ROUND(c.ACTUAL_COST / 1000, 0) AS ACTUAL_COST_K,
      ROUND((c.ACTUAL_COST - c.BUDGET_COST) / NULLIF(c.BUDGET_COST, 0) * 100, 2) AS VARIANCE_PCT,
      ROUND(r.TOT_REVENUE / 1000000, 2) AS REVENUE_M,
      ROUND(r.TOT_GP      / 1000000, 2) AS GROSS_PROFIT_M
    FROM cost_by_period c
    LEFT JOIN revenue_by_period r ON c.PERIOD = r.PERIOD
    ORDER BY c.PERIOD
  `)
  return Response.json({ rows })
}
