import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Agent Anomaly: queries cost anomalies with z-scores and component attribution.
 * Reads from MART_COST_ANOMALIES.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const material = searchParams.get("material_number")
  const plant = searchParams.get("plant_code")
  const threshold = parseFloat(searchParams.get("threshold") ?? "2.0")

  try {
    const conditions: string[] = ["FISCAL_YEAR = 2026"]
    if (material) conditions.push(`MATERIAL_NUMBER = '${material}'`)
    if (plant) conditions.push(`PLANT_NAME LIKE '%${plant}%'`)

    const whereClause = conditions.join(" AND ")

    const anomalies = await querySnowflake(`
      SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_NAME,
             COST_COMPONENT, FISCAL_YEAR, PERIOD,
             ROUND(ACTUAL_COST, 2) AS ACTUAL_COST,
             ROUND(STANDARD_COST, 2) AS STANDARD_COST,
             ROUND(VARIANCE_PCT, 2) AS VARIANCE_PCT,
             ROUND(Z_SCORE, 2) AS Z_SCORE,
             IS_ANOMALY
      FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_ANOMALIES
      WHERE ${whereClause} AND ABS(Z_SCORE) >= ${threshold}
      ORDER BY ABS(Z_SCORE) DESC
      LIMIT 50
    `)

    const anomalyRows = anomalies as any[]

    // Summary
    const totalAnomalies = anomalyRows.length
    const avgZScore = totalAnomalies > 0
      ? Math.round(anomalyRows.reduce((s: number, r: any) => s + Math.abs(r.Z_SCORE), 0) / totalAnomalies * 100) / 100
      : 0
    const topComponents = [...new Set(anomalyRows.map((r: any) => r.COST_COMPONENT).filter(Boolean))]

    return Response.json({
      anomalies: anomalyRows,
      summary: {
        totalFlagged: totalAnomalies,
        avgAbsZScore: avgZScore,
        threshold,
        topCostDrivers: topComponents.slice(0, 5),
        plantsAffected: [...new Set(anomalyRows.map((r: any) => r.PLANT_NAME))],
      }
    })
  } catch (e) {
    console.error("[agent/anomaly]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Anomaly query failed" }, { status: 500 })
  }
}
