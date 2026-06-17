import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"

export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `You are an AI assistant for a pharmaceutical company's Product Costing dashboard, powered by Snowflake Cortex AI.

You have access to SAP BDC product costing and profitability data:
- CO-PC: Standard costs (MBEW.STPRS), actual costs (CKMLCR.PVPRS), cost component splits (API/Drug Substance, Excipients, Packaging, Labour, Overhead)
- CO-PA: SD billing revenue, gross profit, and gross margin % by product and market

Products: RX-1234 (Tablets 10mg), RX-3312 (Biologics 100mg), RX-9901 (Inhaler 90mcg), RX-4567 (Injection 50mg/mL), RX-2891 (Capsules 25mg), RX-6103 (Tablets 5mg), RX-8834 (Tablets 20mg), RX-1156 (IV Infusion 200mg), RX-5521 (Patches), RX-7890 (Oral Solution)
Sites: Macclesfield (UK), Södertälje (Sweden), Dunboyne (Ireland), Mount Vernon (USA), Bangalore (India)
Fiscal year 2026, Periods: 001 (Jan-Apr), 002 (May-Aug), 003 (Sep-Dec)

RESPONSE RULES:
1. Keep answers concise — 2-4 sentences max. Reference SAP field names where relevant (MATNR, WERKS, STPRS, PVPRS).
2. When comparing numbers across products, sites, or periods, include a chart using EXACTLY this format after your text:
<chart type="CHART_TYPE" title="CHART_TITLE">
[{"name":"LABEL","value":NUMBER},...]
</chart>

Chart types: "bar" (comparisons), "line" (trends over periods), "pie" (proportions)
For trends, use: [{"name":"P001","value":2.1},{"name":"P002","value":4.3},{"name":"P003","value":7.7}]
Values must be plain numbers (no % or $ symbols in the value field).

For questions about manufacturing site locations, performance by site, or global operations use a MAP chart:
<chart type="map" title="Manufacturing Site Variance %">
[{"name":"Macclesfield","lat":53.26,"lng":-2.12,"value":7.7,"plant":"PL01"},{"name":"Södertälje","lat":59.20,"lng":17.63,"value":3.2,"plant":"PL02"},{"name":"Dunboyne","lat":53.42,"lng":-6.48,"value":4.1,"plant":"PL03"},{"name":"Mount Vernon","lat":40.91,"lng":-73.84,"value":2.8,"plant":"PL05"},{"name":"Bangalore","lat":12.97,"lng":77.59,"value":5.6,"plant":"PL04"}]
</chart>
Map values represent the current cost variance % at each site. Use real variance data from the context. Positive = over budget (red/amber), negative = under budget (green), near zero = on track (blue).

Only include a chart when it genuinely adds value — not for every answer.`

async function getDataContext(): Promise<string> {
  try {
    const [summary, trend, topVariance, profitability] = await Promise.all([
      querySnowflake(`
        SELECT
          COUNT(DISTINCT MATERIAL_NUMBER) AS PRODUCTS,
          COUNT(DISTINCT PLANT_CODE) AS SITES,
          ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VARIANCE_PCT,
          ROUND(MAX(ABS(COST_VARIANCE_PCT)), 2) AS MAX_VARIANCE_PCT,
          SUM(CASE WHEN COST_VARIANCE_PCT > 5 THEN 1 ELSE 0 END) AS PRODUCTS_OVER_5PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
        WHERE FISCAL_YEAR = 2026
      `),
      querySnowflake(`
        SELECT PERIOD, ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VARIANCE_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
        WHERE FISCAL_YEAR = 2026
        GROUP BY PERIOD ORDER BY PERIOD
      `),
      querySnowflake(`
        SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_NAME, PERIOD,
               ROUND(COST_VARIANCE_PCT, 2) AS VARIANCE_PCT,
               ROUND(STANDARD_COST_PER_UNIT, 2) AS BUDGET,
               ROUND(ACTUAL_COST_PER_UNIT, 2) AS ACTUAL
        FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
        WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
        ORDER BY ABS(COST_VARIANCE_PCT) DESC
        LIMIT 5
      `),
      querySnowflake(`
        SELECT MATERIAL_NUMBER,
          ROUND(TOT_GP / NULLIF(TOT_REV, 0) * 100, 1) AS MARGIN_PCT
        FROM (
          SELECT MATERIAL_NUMBER,
            SUM(GROSS_PROFIT_ACTUAL) AS TOT_GP,
            SUM(REVENUE) AS TOT_REV
          FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_PROFITABILITY
          WHERE FISCAL_YEAR = 2026
          GROUP BY MATERIAL_NUMBER
        )
        ORDER BY MARGIN_PCT DESC
      `),
    ])

    const s = summary[0] as any
    const trendStr = (trend as any[]).map((r: any) => `P${r.PERIOD}: ${r.AVG_VARIANCE_PCT}%`).join(", ")
    const topStr = (topVariance as any[])
      .map((r: any) => `${r.MATERIAL_NUMBER} (${r.PLANT_NAME}, P${r.PERIOD}): budget $${r.BUDGET}, actual $${r.ACTUAL}, variance ${r.VARIANCE_PCT}%`)
      .join("; ")
    const marginStr = (profitability as any[])
      .map((r: any) => `${r.MATERIAL_NUMBER}: ${r.MARGIN_PCT}%`)
      .join(", ")

    return `Cost data — ${s.PRODUCTS} products, ${s.SITES} sites. Avg variance: ${s.AVG_VARIANCE_PCT}%, Max: ${s.MAX_VARIANCE_PCT}%, Over 5% threshold: ${s.PRODUCTS_OVER_5PCT}. Period trend: ${trendStr}. Top 5 by variance: ${topStr}. Gross margins by product: ${marginStr}.`
  } catch {
    return "Data context unavailable."
  }
}

function sfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json()
    if (!question?.trim()) return Response.json({ error: "No question provided" }, { status: 400 })

    const context = await getDataContext()
    const fullPrompt = `${SYSTEM_PROMPT}\n\nCurrent data context:\n${context}\n\nQuestion: ${question}`

    const rows = await querySnowflake(
      `SELECT AI_COMPLETE('claude-sonnet-4-5', '${sfEscape(fullPrompt)}') AS ANSWER`
    )
    const answer = ((rows[0] as any)?.ANSWER ?? "No response generated.").trim()

    // Stream the response as SSE, word by word
    const encoder = new TextEncoder()
    const words = answer.split(/(?<=\S)(?=\s)|(?<=\s)(?=\S)/) // split keeping spaces

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const token of words) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`))
            await delay(28)
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        } catch {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[chat]", e)
    const msg = e instanceof Error ? e.message : "Query failed"
    // Fall back to plain JSON error (non-streaming)
    return Response.json({ answer: `Sorry, I encountered an error: ${msg}` })
  }
}
