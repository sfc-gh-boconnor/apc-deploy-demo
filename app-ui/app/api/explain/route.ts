import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"

export const dynamic = "force-dynamic"

function sfEscape(s: string) { return s.replace(/'/g, "''") }
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

const FIELD_LABELS: Record<string, string> = {
  budget:       "standard/budget cost per unit",
  actual:       "actual cost per unit",
  variance:     "absolute cost variance",
  variance_pct: "cost variance percentage",
  overall:      "cost variance",
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { product, description, site, period, budget, actual, varianceAbs, variancePct, field } = body

    const fieldLabel = FIELD_LABELS[field] ?? "cost variance"
    const sign = parseFloat(variancePct) > 0 ? "over" : "under"

    const prompt = `You are a pharmaceutical manufacturing cost analyst, expert in SAP CO-PC (Product Costing) and material ledger.

A cost controller is reviewing the ${fieldLabel} for the following product:

Product: ${description} (SAP MATNR: ${product})
Manufacturing site (WERKS): ${site}
Fiscal period: ${period} 2026
SAP MBEW standard cost (STPRS): $${budget} per unit
SAP CKMLCR actual cost (PVPRS): $${actual} per unit
Cost variance: ${parseFloat(variancePct) > 0 ? "+" : ""}${variancePct}% (${sign} budget by $${varianceAbs} per unit)

In 3-5 concise sentences, explain what this number likely means and what the probable root causes are. Cover the most relevant SAP CO-PC drivers for a pharma product, such as:
- Raw material or API price changes (purchasing price variance)
- Yield loss or batch rejection (quantity variance)
- Overhead absorption rate changes (fixed cost under/over-absorption)
- Labour efficiency or machine utilisation
- Packaging material cost changes
- Exchange rate impact (if cross-border site)
- Planned vs actual batch size differences (volume variance)

Be specific and practical. Reference SAP field names (STPRS, PVPRS, KEPH components) where relevant. End with one recommended action for the cost controller.`

    const rows = await querySnowflake(
      `SELECT AI_COMPLETE('claude-sonnet-4-5', '${sfEscape(prompt)}') AS ANSWER`
    )
    const answer = ((rows[0] as any)?.ANSWER ?? "Unable to generate explanation.").trim()

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
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (e) {
    console.error("[explain]", e)
    return Response.json({ error: "Explain failed" }, { status: 500 })
  }
}
