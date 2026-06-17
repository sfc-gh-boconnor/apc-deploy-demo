import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const period = searchParams.get("period") ?? "all"
  const periodClause = period !== "all" ? `AND PERIOD = '${period}'` : ""

  const rows = await querySnowflake(`
    SELECT
      MARKET,
      MATERIAL_NUMBER,
      MATERIAL_DESCRIPTION,
      TOT_REVENUE             AS REVENUE,
      TOT_GP                  AS GROSS_PROFIT,
      ROUND(TOT_GP / NULLIF(TOT_REVENUE, 0) * 100, 1) AS MARGIN_PCT
    FROM (
      SELECT
        MARKET,
        MATERIAL_NUMBER,
        MATERIAL_DESCRIPTION,
        SUM(REVENUE)             AS TOT_REVENUE,
        SUM(GROSS_PROFIT_ACTUAL) AS TOT_GP
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_PROFITABILITY
      WHERE FISCAL_YEAR = 2026 ${periodClause}
      GROUP BY MARKET, MATERIAL_NUMBER, MATERIAL_DESCRIPTION
    )
    ORDER BY MARKET, TOT_REVENUE DESC
  `)
  return Response.json({ rows })
}
