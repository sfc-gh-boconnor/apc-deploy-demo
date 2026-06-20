import { NextRequest } from "next/server"
import { streamAgentResponse, AgentEvent } from "@/lib/agent-stream"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Chat route: streams real-time events from the Cortex Agent REST API.
 *
 * SSE event format sent to the client:
 *   data: {"type":"thinking","text":"..."}
 *   data: {"type":"text","text":"..."}
 *   data: {"type":"sql","statement":"SELECT ..."}
 *   data: {"type":"table","columns":[...],"rows":[...]}
 *   data: {"type":"suggested_queries","queries":[...]}
 *   data: [DONE]
 */
export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json()
    if (!question?.trim()) {
      return Response.json({ error: "No question provided" }, { status: 400 })
    }

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of streamAgentResponse(question)) {
            if (event.type === "done") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              break
            }
            if (event.type === "error") {
              // Send error as text so the UI can display it
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "text", text: `Error: ${event.message}` })}\n\n`)
              )
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              break
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            )
          }
          controller.close()
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Stream failed"
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "text", text: `Error: ${msg}` })}\n\n`)
          )
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
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
