import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const period = searchParams.get("period") ?? "all"
  const periodClause = period !== "all" ? `AND PERIOD = '${period}'` : ""

  // Aggregate across sites/periods for cleaner cross-scenario chart
  const rows = await querySnowflake(`
    SELECT
      SCENARIO_ID,
      SCENARIO_NAME,
      IS_BASE,
      MATERIAL_NUMBER,
      MATERIAL_DESCRIPTION,
      ROUND(AVG(BASE_COST), 2)     AS BASE_COST,
      ROUND(AVG(SCENARIO_COST), 2) AS SCENARIO_COST,
      ROUND(AVG(COST_DELTA), 2)    AS COST_DELTA,
      ROUND(AVG(COST_DELTA_PCT), 2) AS COST_DELTA_PCT
    FROM ${DATABASE}.ANALYTICS.SCENARIO_RESULTS
    WHERE MATERIAL_NUMBER LIKE '%-FIN'
      ${periodClause}
    GROUP BY SCENARIO_ID, SCENARIO_NAME, IS_BASE, MATERIAL_NUMBER, MATERIAL_DESCRIPTION
    ORDER BY SCENARIO_ID, MATERIAL_NUMBER
  `)
  return Response.json({ rows })
}
