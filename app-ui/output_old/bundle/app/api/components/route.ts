import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const product = searchParams.get("product") ?? ""
  const period  = searchParams.get("period")  ?? "all"
  const site    = searchParams.get("site")    ?? "all"

  if (!product) return Response.json({ rows: [] })

  const periodClause = period !== "all" ? `AND PERIOD = '${period}'` : ""
  const siteClause   = site   !== "all" ? `AND PLANT_CODE = '${site}'` : ""

  try {
    const rows = await querySnowflake(`
      SELECT COST_COMPONENT,
             AVG(STANDARD_COST)          AS STANDARD_COST,
             AVG(ACTUAL_COST)            AS ACTUAL_COST,
             AVG(COMPONENT_VARIANCE_PCT) AS VARIANCE_PCT
      FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_COMPONENT_DETAIL
      WHERE MATERIAL_NUMBER = '${product.replace(/'/g, "''")}'
        AND FISCAL_YEAR = 2026
        ${periodClause} ${siteClause}
      GROUP BY COST_COMPONENT
      ORDER BY 3 DESC
    `)
    return Response.json({ rows })
  } catch (e) {
    console.error(new Date().toISOString(), "[components]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Query failed", rows: [] }, { status: 500 })
  }
}
