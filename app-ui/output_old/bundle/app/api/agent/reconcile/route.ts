import { querySnowflakeLongRunning } from "@/lib/snowflake"
import { DATABASE } from "@/lib/config"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 300 // Allow up to 5 minutes for agent responses

const AGENT_FQN = `${DATABASE}.ANALYTICS.APC_RECONCILIATION_AGENT`

/**
 * Agent Reconcile: delegates to the APC_RECONCILIATION_AGENT Cortex Agent
 * via SNOWFLAKE.CORTEX.DATA_AGENT_RUN.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const material = searchParams.get("material_number")
  const plant = searchParams.get("plant_code")
  const period = searchParams.get("period")
  const question = searchParams.get("question")

  try {
    const prompt = question || buildPrompt(material, plant, period)
    const response = await callAgent(prompt)

    return Response.json({
      ...response,
      filters: { material, plant, period, question }
    })
  } catch (e) {
    console.error("[agent/reconcile]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Reconciliation failed" }, { status: 500 })
  }
}

/** POST for longer/custom questions with thread support */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { question } = body

    if (!question) {
      return Response.json({ error: "question is required" }, { status: 400 })
    }

    const response = await callAgent(question)
    return Response.json(response)
  } catch (e) {
    console.error("[agent/reconcile POST]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Reconciliation failed" }, { status: 500 })
  }
}

async function callAgent(prompt: string) {
  // Escape single quotes for SQL string literal
  const safePrompt = prompt.replace(/'/g, "''")

  const requestBody = JSON.stringify({
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    stream: false
  }).replace(/'/g, "''")

  const rows = await querySnowflakeLongRunning(`
    SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
      '${AGENT_FQN}',
      '${requestBody}'
    ) AS RESPONSE
  `)

  const raw = rows[0]?.RESPONSE
  if (!raw) {
    throw new Error("No response from agent")
  }

  // DATA_AGENT_RUN returns a string that may be double-quote escaped (CSV style)
  // or already a parsed object depending on the driver mode
  let response: any
  if (typeof raw === "object") {
    response = raw
  } else {
    let jsonStr = raw as string
    // Strip outer quotes and unescape doubled quotes if present
    if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
      jsonStr = jsonStr.slice(1, -1).replace(/""/g, '"')
    }
    try {
      response = JSON.parse(jsonStr)
    } catch (parseErr) {
      // If parse fails, return the raw text as the answer (could be an error message)
      return {
        answer: jsonStr.slice(0, 2000),
        tables: [],
        suggestedQueries: [],
        raw: jsonStr.slice(0, 500)
      }
    }
  }

  // Parse the agent response — it's a single message object with content array
  const content = response?.content ?? []
  const textParts: string[] = []
  const tables: any[] = []
  const suggestedQueries: string[] = []

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text)
    } else if (block.type === "table") {
      tables.push(block.table)
    } else if (block.type === "suggested_queries") {
      for (const sq of block.suggested_queries ?? []) {
        suggestedQueries.push(sq.query)
      }
    }
  }

  return {
    answer: textParts.join("\n\n"),
    tables,
    suggestedQueries,
    raw: response
  }
}

function buildPrompt(material: string | null, plant: string | null, period: string | null): string {
  const parts = ["Perform a full cost reconciliation analysis for FY2026"]
  if (material) parts.push(`for material ${material}`)
  if (plant) parts.push(`at plant ${plant}`)
  if (period) parts.push(`in period ${period}`)
  parts.push(". Identify the top root causes of cost variance ranked by financial impact, covering rate stability, volume alignment, cost component drivers, and cost trajectory.")
  return parts.join(" ")
}
