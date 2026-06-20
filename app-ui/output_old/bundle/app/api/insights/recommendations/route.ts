import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"

export const dynamic = "force-dynamic"

function sfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function GET(req: NextRequest) {
  try {
    // Gather ML context to feed into the recommendation prompt
    const [riskScores, anomalies, forecast] = await Promise.all([
      querySnowflake(`
        SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, VAR_P001, VAR_P003, VAR_P006,
               VARIANCE_SLOPE AS SLOPE, ESTIMATED_NEXT_PERIOD AS ESTIMATED_P007, RISK_LEVEL
        FROM ${DATABASE}.ML_FEATURE_STORE."PRODUCT_RISK_FV$V1"
        ORDER BY ABS(VARIANCE_SLOPE) DESC LIMIT 10
      `),
      querySnowflake(`
        SELECT MATERIAL_NUMBER, COST_COMPONENT, PERIOD, VARIANCE_PCT, Z_SCORE
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_ANOMALIES WHERE IS_ANOMALY = TRUE
        ORDER BY ABS(Z_SCORE) DESC LIMIT 8
      `),
      querySnowflake(`
        SELECT PERIOD_LABEL, FORECAST_VARIANCE, FORECAST_LOWER, FORECAST_UPPER
        FROM ${DATABASE}.DBT_ANALYTICS.MART_VARIANCE_TREND_WITH_FORECAST
        WHERE DATA_TYPE = 'forecast' ORDER BY TS LIMIT 3
      `),
    ])

    const riskSummary = (riskScores as any[])
      .map((r: any) => `${r.MATERIAL_NUMBER} (${r.RISK_LEVEL}): P001=${r.VAR_P001}%, P003=${r.VAR_P003}%, P006=${r.VAR_P006}%, trend slope=${r.SLOPE}%/period, estimated next period=${r.ESTIMATED_P007}%`)
      .join("; ")

    const anomalySummary = (anomalies as any[])
      .map((r: any) => `${r.MATERIAL_NUMBER} — ${r.COST_COMPONENT} in P${r.PERIOD}: ${r.VARIANCE_PCT}% (z-score ${r.Z_SCORE})`)
      .join("; ")

    const forecastSummary = (forecast as any[])
      .map((r: any) => `${r.PERIOD_LABEL}: forecast ${r.FORECAST_VARIANCE}% (range ${r.FORECAST_LOWER}% to ${r.FORECAST_UPPER}%)`)
      .join("; ")

    const prompt = `You are a Snowflake AI assistant for a pharmaceutical company's Finance team. You have just run Snowflake's native ML FORECAST and anomaly detection models on SAP product cost data.

ML RESULTS:
- Portfolio forecast (FY2026 H2): ${forecastSummary}
- Product risk scores (by variance slope): ${riskSummary}
- Statistical anomalies flagged (z-score > 1.5): ${anomalySummary}

Generate exactly 4 specific, actionable recommendations for the Finance and Supply Chain teams. Each recommendation should:
1. Reference a specific product (MATNR), site, or cost component from the ML data above
2. State the quantified risk (variance %, trend slope)
3. Give a concrete action Finance or Supply Chain should take
4. Be framed as urgent if risk level is HIGH or z-score > 2.0

Format as numbered list. Use business language (not ML jargon). Keep each recommendation to 2-3 sentences.
Start directly with "1." — no preamble.`

    const rows = await querySnowflake(
      `SELECT AI_COMPLETE('claude-sonnet-4-5', '${sfEscape(prompt)}') AS ANSWER`
    )
    const answer = ((rows[0] as any)?.ANSWER ?? "Unable to generate recommendations.").trim()

    // Stream response
    const encoder = new TextEncoder()
    const words = answer.split(/(?<=\S)(?=\s)|(?<=\s)(?=\S)/)

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const token of words) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`))
            await delay(22)
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        } catch {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    })
  } catch (e) {
    console.error("[insights/recommendations]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
