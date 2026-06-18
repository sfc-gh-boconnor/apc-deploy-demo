import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Agent Anomaly: queries cost anomalies with z-scores and component attribution.
 * Reads from MART_COST_ANOMALIES and optionally calls APC_ANOMALY_DETECTOR model.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const material = searchParams.get("material_number")
  const plant = searchParams.get("plant_code")
  const threshold = parseFloat(searchParams.get("threshold") ?? "2.0")

  try {
    const conditions: string[] = ["FISCAL_YEAR = 2026"]
    if (material) conditions.push(`MATERIAL_NUMBER = '${material}'`)
    if (plant) conditions.push(`PLANT_CODE = '${plant}'`)

    const whereClause = conditions.join(" AND ")

    const [anomalies, componentBreakdown] = await Promise.all([
      querySnowflake(`
        SELECT MATERIAL_NUMBER, PLANT_CODE, PLANT_NAME, PERIOD,
               ROUND(Z_SCORE, 2) AS Z_SCORE,
               ROUND(ACTUAL_COST_PER_UNIT, 2) AS ACTUAL_COST,
               ROUND(EXPECTED_COST, 2) AS EXPECTED_COST,
               ROUND(ABS(ACTUAL_COST_PER_UNIT - EXPECTED_COST), 2) AS DEVIATION,
               ANOMALY_FLAG,
               COST_DRIVER
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_ANOMALIES
        WHERE ${whereClause} AND ABS(Z_SCORE) >= ${threshold}
        ORDER BY ABS(Z_SCORE) DESC
        LIMIT 50
      `),
      querySnowflake(`
        SELECT a.MATERIAL_NUMBER, a.PLANT_CODE, a.PERIOD,
               c.COST_COMPONENT,
               ROUND(c.ACTUAL_COST, 2) AS COMPONENT_ACTUAL,
               ROUND(c.STANDARD_COST, 2) AS COMPONENT_STANDARD,
               ROUND((c.ACTUAL_COST - c.STANDARD_COST) / NULLIF(c.STANDARD_COST, 0) * 100, 1) AS COMPONENT_VARIANCE_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_ANOMALIES a
        JOIN ${DATABASE}.DBT_ANALYTICS.MART_COST_COMPONENT_DETAIL c
          ON a.MATERIAL_NUMBER = c.MATERIAL_NUMBER
          AND a.PLANT_CODE = c.PLANT_CODE
          AND a.PERIOD = c.PERIOD
          AND a.FISCAL_YEAR = c.FISCAL_YEAR
        WHERE ${whereClause} AND ABS(a.Z_SCORE) >= ${threshold}
        ORDER BY ABS(c.ACTUAL_COST - c.STANDARD_COST) DESC
        LIMIT 100
      `)
    ])

    const anomalyRows = anomalies as any[]
    const componentRows = componentBreakdown as any[]

    // Group component attribution by anomaly
    const attributionMap: Record<string, any[]> = {}
    for (const row of componentRows) {
      const key = `${row.MATERIAL_NUMBER}|${row.PLANT_CODE}|${row.PERIOD}`
      if (!attributionMap[key]) attributionMap[key] = []
      attributionMap[key].push({
        component: row.COST_COMPONENT,
        actual: row.COMPONENT_ACTUAL,
        standard: row.COMPONENT_STANDARD,
        variancePct: row.COMPONENT_VARIANCE_PCT,
      })
    }

    const enrichedAnomalies = anomalyRows.map((a: any) => ({
      ...a,
      componentAttribution: attributionMap[`${a.MATERIAL_NUMBER}|${a.PLANT_CODE}|${a.PERIOD}`] || [],
    }))

    // Summary
    const totalAnomalies = anomalyRows.length
    const avgZScore = totalAnomalies > 0
      ? Math.round(anomalyRows.reduce((s: number, r: any) => s + Math.abs(r.Z_SCORE), 0) / totalAnomalies * 100) / 100
      : 0
    const topDrivers = [...new Set(anomalyRows.map((r: any) => r.COST_DRIVER).filter(Boolean))]

    return Response.json({
      anomalies: enrichedAnomalies,
      summary: {
        totalFlagged: totalAnomalies,
        avgAbsZScore: avgZScore,
        threshold,
        topCostDrivers: topDrivers.slice(0, 5),
        plantsAffected: [...new Set(anomalyRows.map((r: any) => r.PLANT_NAME))],
      }
    })
  } catch (e) {
    console.error("[agent/anomaly]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Anomaly query failed" }, { status: 500 })
  }
}
