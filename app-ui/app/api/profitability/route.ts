import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const period = searchParams.get("period") ?? "all"
  const periodClause = period !== "all" ? `AND PERIOD = '${period}'` : ""

  // Use subquery with fresh aliases to avoid Snowflake nested-aggregate error
  // (REVENUE etc. in PRODUCT_PROFITABILITY are already SUM()s internally)
  const rows = await querySnowflake(`
    SELECT
      MATERIAL_NUMBER,
      MATERIAL_DESCRIPTION,
      TOT_REVENUE                                              AS REVENUE,
      TOT_VOLUME                                               AS VOLUME_UNITS,
      TOT_COGS_ACTUAL                                          AS COGS_ACTUAL,
      TOT_COGS_BUDGET                                          AS COGS_BUDGET,
      TOT_GP_ACTUAL                                            AS GROSS_PROFIT_ACTUAL,
      TOT_GP_BUDGET                                            AS GROSS_PROFIT_BUDGET,
      ROUND(TOT_GP_ACTUAL / NULLIF(TOT_REVENUE, 0) * 100, 1)  AS GROSS_MARGIN_PCT_ACTUAL,
      ROUND(TOT_GP_BUDGET / NULLIF(TOT_REVENUE, 0) * 100, 1)  AS GROSS_MARGIN_PCT_BUDGET,
      ROUND(
        TOT_GP_ACTUAL / NULLIF(TOT_REVENUE, 0) * 100 -
        TOT_GP_BUDGET / NULLIF(TOT_REVENUE, 0) * 100
      , 1)                                                     AS MARGIN_VARIANCE_PPS
    FROM (
      SELECT
        MATERIAL_NUMBER,
        MATERIAL_DESCRIPTION,
        SUM(REVENUE)           AS TOT_REVENUE,
        SUM(VOLUME_UNITS)      AS TOT_VOLUME,
        SUM(COGS_ACTUAL)       AS TOT_COGS_ACTUAL,
        SUM(COGS_BUDGET)       AS TOT_COGS_BUDGET,
        SUM(GROSS_PROFIT_ACTUAL) AS TOT_GP_ACTUAL,
        SUM(GROSS_PROFIT_BUDGET) AS TOT_GP_BUDGET
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_PROFITABILITY
      WHERE FISCAL_YEAR = 2026 ${periodClause}
      GROUP BY MATERIAL_NUMBER, MATERIAL_DESCRIPTION
    )
    ORDER BY TOT_REVENUE DESC
  `)
  return Response.json({ rows })
}
