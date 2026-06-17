import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const period = searchParams.get("period") ?? "all"
  const site   = searchParams.get("site")   ?? "all"
  const type   = searchParams.get("type")   ?? "FERT"

  const periodClause = period !== "all" ? `AND PERIOD = '${period}'` : ""
  const siteClause   = site   !== "all" ? `AND PLANT_CODE = '${site}'` : ""

  try {
    const rows = await querySnowflake(`
      SELECT
        MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_CODE, PLANT_NAME,
        PERIOD, STANDARD_COST_PER_UNIT, ACTUAL_COST_PER_UNIT,
        BUDGET_COST_PER_UNIT, BUDGET_VARIANCE_PCT,
        COST_VARIANCE_ABS, COST_VARIANCE_PCT
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      WHERE FISCAL_YEAR = 2026
        AND MATERIAL_TYPE = '${type}'
        ${periodClause} ${siteClause}
      ORDER BY ABS(COST_VARIANCE_PCT) DESC
      LIMIT 10
    `)
    return Response.json({ rows })
  } catch (e) {
    console.error(new Date().toISOString(), "[variance]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Query failed", rows: [] }, { status: 500 })
  }
}
