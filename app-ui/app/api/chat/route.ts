import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"

export const dynamic = "force-dynamic"

const SEMANTIC_VIEW = `${DATABASE}.DBT_ANALYTICS.APC_RECONCILIATION_SV`

const SYSTEM_CONTEXT = `You are an AI assistant for pharmaceutical product costing reconciliation.
When decomposing cost questions:
1. Rate stability: Check MART_RATE_STABILITY for machine/labour rate drift (PL03 Dunboyne has +20.4% machine, +18% labour escalation)
2. Volume alignment: Check MART_VOLUME_ALIGNMENT for demand mismatches (PL05 Bangalore has spare capacity, $14.53/unit savings potential)
3. Component drivers: Break down by the 9 cost components (API, Excipients, Packaging, Labour, Overhead, QC, Logistics, Depreciation, Energy)
4. Trajectory: Use MART_COGM_EVOLUTION for period-over-period COGM trends and transfer activity context

Key insights:
- PL03 Dunboyne: rate instability crisis (machine +20.4%, labour +18%)
- PL05 Bangalore: volume misalignment with spare capacity; potential $14.53/unit savings via volume rebalancing
- FY2026 narrative: API price shock April, Dunboyne+Bangalore yield crisis May, partial recovery June

RESPONSE RULES:
1. Keep answers concise — 2-4 sentences max. Reference SAP field names where relevant.
2. When comparing numbers, include a chart using EXACTLY this format after your text:
<chart type="CHART_TYPE" title="CHART_TITLE">
[{"name":"LABEL","value":NUMBER},...]
</chart>

Chart types: "bar" (comparisons), "line" (trends), "pie" (proportions)
Only include a chart when it genuinely adds value.`

function sfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function queryWithAnalyst(question: string): Promise<string> {
  // Try Cortex Analyst against the semantic view first
  try {
    const rows = await querySnowflake(`
      SELECT SNOWFLAKE.CORTEX.COMPLETE(
        'claude-sonnet-4-5',
        CONCAT(
          '${sfEscape(SYSTEM_CONTEXT)}',
          '\\n\\nThe user asked: ${sfEscape(question)}',
          '\\n\\nHere is relevant data from the reconciliation semantic view:\\n',
          (SELECT LISTAGG(col_name || ': ' || col_value, ', ') FROM (
            SELECT TOP 20 * FROM TABLE(
              RESULT_SCAN(LAST_QUERY_ID())
            )
          ))
        )
      ) AS ANSWER
    `)
    const answer = ((rows[0] as any)?.ANSWER ?? "").trim()
    if (answer) return answer
  } catch {
    // Cortex Analyst not available or query failed, fall through
  }

  // Fallback: use AI_COMPLETE with data context from the reconciliation marts
  const context = await getReconciliationContext(question)
  const fullPrompt = `${SYSTEM_CONTEXT}\n\nData context:\n${context}\n\nQuestion: ${question}`
  const rows = await querySnowflake(
    `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-sonnet-4-5', '${sfEscape(fullPrompt)}') AS ANSWER`
  )
  return ((rows[0] as any)?.ANSWER ?? "No response generated.").trim()
}

async function getReconciliationContext(question: string): Promise<string> {
  const q = question.toLowerCase()
  const contextParts: string[] = []

  // Always get high-level summary
  try {
    const [summary] = await Promise.all([
      querySnowflake(`
        SELECT COUNT(DISTINCT MATERIAL_NUMBER) AS PRODUCTS,
               COUNT(DISTINCT PLANT_CODE) AS SITES,
               ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VARIANCE,
               ROUND(MAX(ABS(COST_VARIANCE_PCT)), 2) AS MAX_VARIANCE
        FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
        WHERE FISCAL_YEAR = 2026
      `)
    ])
    const s = summary[0] as any
    contextParts.push(`Overview: ${s.PRODUCTS} products, ${s.SITES} sites. Avg variance ${s.AVG_VARIANCE}%, max ${s.MAX_VARIANCE}%.`)
  } catch { /* skip */ }

  // Rate stability context
  if (q.includes("rate") || q.includes("dunboyne") || q.includes("pl03") || q.includes("labour") || q.includes("machine") || q.includes("escalat")) {
    try {
      const rates = await querySnowflake(`
        SELECT PLANT_CODE, PLANT_NAME, COST_ELEMENT,
               ROUND(RATE_CHANGE_PCT, 1) AS RATE_CHANGE_PCT,
               ROUND(STABILITY_INDEX, 2) AS STABILITY_INDEX
        FROM ${DATABASE}.DBT_ANALYTICS.MART_RATE_STABILITY
        WHERE FISCAL_YEAR = 2026
        ORDER BY ABS(RATE_CHANGE_PCT) DESC LIMIT 10
      `)
      contextParts.push("Rate stability: " + JSON.stringify(rates))
    } catch { /* skip */ }
  }

  // Volume alignment context
  if (q.includes("volume") || q.includes("capacity") || q.includes("bangalore") || q.includes("pl05") || q.includes("demand") || q.includes("misalign")) {
    try {
      const volumes = await querySnowflake(`
        SELECT PLANT_CODE, PLANT_NAME, MATERIAL_NUMBER,
               ROUND(CAPACITY_UTILIZATION_PCT, 1) AS UTIL_PCT,
               ROUND(SAVINGS_POTENTIAL_PER_UNIT, 2) AS SAVINGS_PER_UNIT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_VOLUME_ALIGNMENT
        WHERE FISCAL_YEAR = 2026
        ORDER BY SAVINGS_POTENTIAL_PER_UNIT DESC LIMIT 10
      `)
      contextParts.push("Volume alignment: " + JSON.stringify(volumes))
    } catch { /* skip */ }
  }

  // Component detail
  if (q.includes("component") || q.includes("breakdown") || q.includes("api") || q.includes("energy") || q.includes("cost driver")) {
    try {
      const components = await querySnowflake(`
        SELECT COST_COMPONENT, ROUND(SUM(ACTUAL_COST), 0) AS TOTAL_ACTUAL,
               ROUND(SUM(STANDARD_COST), 0) AS TOTAL_STANDARD,
               ROUND((SUM(ACTUAL_COST) - SUM(STANDARD_COST)) / NULLIF(SUM(STANDARD_COST), 0) * 100, 1) AS VARIANCE_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COST_COMPONENT_DETAIL
        WHERE FISCAL_YEAR = 2026
        GROUP BY COST_COMPONENT
        ORDER BY ABS(SUM(ACTUAL_COST) - SUM(STANDARD_COST)) DESC
      `)
      contextParts.push("Component detail: " + JSON.stringify(components))
    } catch { /* skip */ }
  }

  // COGM evolution
  if (q.includes("cogm") || q.includes("trend") || q.includes("trajectory") || q.includes("evolution") || q.includes("period")) {
    try {
      const cogm = await querySnowflake(`
        SELECT PERIOD, ROUND(AVG(COGM_PER_UNIT), 2) AS AVG_COGM,
               ROUND(AVG(COGM_CHANGE_PCT), 1) AS AVG_CHANGE_PCT
        FROM ${DATABASE}.DBT_ANALYTICS.MART_COGM_EVOLUTION
        WHERE FISCAL_YEAR = 2026
        GROUP BY PERIOD ORDER BY PERIOD
      `)
      contextParts.push("COGM evolution: " + JSON.stringify(cogm))
    } catch { /* skip */ }
  }

  // Top variances (always useful)
  try {
    const top = await querySnowflake(`
      SELECT MATERIAL_NUMBER, PLANT_NAME, PERIOD,
             ROUND(COST_VARIANCE_PCT, 2) AS VARIANCE_PCT,
             ROUND(ACTUAL_COST_PER_UNIT, 2) AS ACTUAL,
             ROUND(STANDARD_COST_PER_UNIT, 2) AS STANDARD
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
      ORDER BY ABS(COST_VARIANCE_PCT) DESC LIMIT 5
    `)
    contextParts.push("Top variances: " + JSON.stringify(top))
  } catch { /* skip */ }

  return contextParts.join("\n")
}

export async function POST(req: NextRequest) {
  try {
    const { question, tool } = await req.json()
    if (!question?.trim()) return Response.json({ error: "No question provided" }, { status: 400 })

    // If a specific tool is requested, delegate to that endpoint
    if (tool && tool !== "ask") {
      return Response.json({ error: "Use the specific /api/agent/<tool> endpoint" }, { status: 400 })
    }

    const answer = await queryWithAnalyst(question)

    // Stream the response as SSE, word by word
    const encoder = new TextEncoder()
    const words = answer.split(/(?<=\S)(?=\s)|(?<=\s)(?=\S)/)

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
    return Response.json({ answer: `Sorry, I encountered an error: ${msg}` })
  }
}
