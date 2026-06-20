import { NextRequest } from "next/server"
import { streamAgentResponse } from "@/lib/agent-stream"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * GET /api/chat?q=... — SSE endpoint using native event-stream.
 * Using GET allows browsers to use EventSource which gets special proxy treatment.
 */
export async function GET(req: NextRequest) {
  const question = req.nextUrl.searchParams.get("q") ?? ""
  if (!question.trim()) {
    return Response.json({ error: "No question provided" }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      await writer.write(encoder.encode("data: " + JSON.stringify({ type: "thinking", text: "" }) + "\n\n"))

      for await (const event of streamAgentResponse(question)) {
        if (event.type === "done") {
          await writer.write(encoder.encode("data: [DONE]\n\n"))
          break
        }
        if (event.type === "error") {
          await writer.write(encoder.encode("data: " + JSON.stringify({ type: "text", text: `Error: ${event.message}` }) + "\n\n"))
          await writer.write(encoder.encode("data: [DONE]\n\n"))
          break
        }
        await writer.write(encoder.encode("data: " + JSON.stringify(event) + "\n\n"))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stream failed"
      await writer.write(encoder.encode("data: " + JSON.stringify({ type: "text", text: `Error: ${msg}` }) + "\n\n"))
      await writer.write(encoder.encode("data: [DONE]\n\n"))
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

/** POST kept for backwards compat — redirects to GET logic */
export async function POST(req: NextRequest) {
  const { question } = await req.json()
  // Reuse the same logic
  const url = new URL(req.url)
  url.searchParams.set("q", question || "")
  const getReq = new NextRequest(url, { method: "GET" })
  return GET(getReq)
}
