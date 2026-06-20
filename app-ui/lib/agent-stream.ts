/**
 * Cortex Agent REST API streaming helper.
 * Uses Node.js native https for true chunk-by-chunk streaming (no buffering).
 */

import fs from "fs"
import https from "https"
import http from "http"
import { DATABASE } from "./config"

const SPCS_TOKEN_PATH = "/snowflake/session/token"

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "sql"; statement: string }
  | { type: "table"; columns: string[]; rows: Record<string, any>[] }
  | { type: "suggested_queries"; queries: string[] }
  | { type: "done" }
  | { type: "error"; message: string }

function getToken(): string {
  try {
    return fs.readFileSync(SPCS_TOKEN_PATH, "utf8").trim()
  } catch {
    return ""
  }
}

function getAccountUrl(): string {
  if (process.env.SNOWFLAKE_ACCOUNT_URL) return process.env.SNOWFLAKE_ACCOUNT_URL
  if (process.env.SNOWFLAKE_HOST) return `https://${process.env.SNOWFLAKE_HOST}`
  const account = process.env.SNOWFLAKE_ACCOUNT || ""
  if (account) return `https://${account}.snowflakecomputing.com`
  return ""
}

export interface AgentStreamOptions {
  agentName?: string
  schema?: string
  database?: string
}

/**
 * Stream events from the Cortex Agent REST API using Node native HTTP.
 * Each chunk is processed immediately as it arrives — no buffering.
 */
export function streamAgentRaw(
  question: string,
  options: AgentStreamOptions = {}
): { stream: AsyncGenerator<AgentEvent>; abort: () => void } {
  const {
    agentName = "APC_RECONCILIATION_AGENT",
    schema = "ANALYTICS",
    database: db = DATABASE,
  } = options

  const token = getToken()
  const accountUrl = getAccountUrl()

  let abortController: { abort: () => void } = { abort: () => {} }

  async function* generate(): AsyncGenerator<AgentEvent> {
    if (!token) {
      yield { type: "error", message: "No SPCS token available" }
      return
    }
    if (!accountUrl) {
      yield { type: "error", message: "Cannot determine Snowflake account URL" }
      return
    }

    const urlPath = `/api/v2/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/agents/${encodeURIComponent(agentName)}:run`
    const parsedUrl = new URL(urlPath, accountUrl)

    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: question }] }],
      stream: true,
    })

    // Use a promise-based wrapper around Node native http(s) for true streaming
    const events: AgentEvent[] = []
    let resolve: (() => void) | null = null
    let done = false
    let error: string | null = null

    const pending: AgentEvent[] = []
    let waiting: ((v: IteratorResult<AgentEvent>) => void) | null = null

    function push(event: AgentEvent) {
      if (waiting) {
        const w = waiting
        waiting = null
        w({ value: event, done: false })
      } else {
        pending.push(event)
      }
    }

    function finish() {
      done = true
      if (waiting) {
        const w = waiting
        waiting = null
        w({ value: undefined as any, done: true })
      }
    }

    const proto = parsedUrl.protocol === "https:" ? https : http
    const req = proto.request(
      parsedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
          "User-Agent": "APC-ProductCosting/1.0",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ""
          res.on("data", (chunk: Buffer) => { errBody += chunk.toString() })
          res.on("end", () => {
            push({ type: "error", message: `Agent API error (${res.statusCode}): ${errBody.slice(0, 500)}` })
            push({ type: "done" })
            finish()
          })
          return
        }

        let buffer = ""
        const blockTypes = new Map<number, string>()
        let chunkCount = 0
        const startTime = Date.now()

        res.on("data", (chunk: Buffer) => {
          chunkCount++
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          console.log(`[agent-stream] chunk #${chunkCount} at ${elapsed}s, size=${chunk.length}`)
          
          buffer += chunk.toString()
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data:")) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === "[DONE]") {
              if (payload === "[DONE]") {
                push({ type: "done" })
                finish()
              }
              continue
            }

            let event: any
            try { event = JSON.parse(payload) } catch { continue }

            const eventType = event.type || event.event

            // Process streaming events
            if (eventType === "content_block_start") {
              const block = event.content_block
              const idx = event.index ?? 0
              if (block) {
                blockTypes.set(idx, block.type)
                if (block.type === "tool_use" && block.input?.sql) {
                  push({ type: "sql", statement: block.input.sql })
                }
                if (block.type === "tool_result" || block.type === "tool_results") {
                  processToolResult(block.content || [], push)
                }
                if (block.type === "table") {
                  processTableBlock(block, push)
                }
              }
            } else if (eventType === "content_block_delta") {
              const delta = event.delta
              const idx = event.index ?? 0
              const blockType = blockTypes.get(idx)
              if (delta?.type === "thinking_delta" || blockType === "thinking") {
                push({ type: "thinking", text: delta.thinking || delta.text || "" })
              } else if (delta?.type === "text_delta" || blockType === "text") {
                push({ type: "text", text: delta.text || "" })
              }
            } else if (eventType === "message_stop" || eventType === "message_delta") {
              if (event.delta?.content) {
                for (const block of event.delta.content) {
                  if (block.type === "suggested_queries") {
                    const queries = (block.suggested_queries || []).map((sq: any) => sq.query || sq)
                    if (queries.length > 0) push({ type: "suggested_queries", queries })
                  }
                }
              }
            }

            // Handle flat format (complete message in one event)
            if (event.content && Array.isArray(event.content)) {
              for (const block of event.content) {
                if (block.type === "text") push({ type: "text", text: block.text })
                else if (block.type === "thinking") push({ type: "thinking", text: block.thinking?.text || block.thinking || block.text || "" })
                else if (block.type === "tool_use") {
                  if (block.tool_use?.input?.sql || block.input?.sql) push({ type: "sql", statement: block.tool_use?.input?.sql || block.input?.sql })
                }
                else if (block.type === "tool_result") processToolResult(block.tool_result?.content || block.content || [], push)
                else if (block.type === "table") processTableBlock(block, push)
                else if (block.type === "suggested_queries") {
                  const queries = (block.suggested_queries || []).map((sq: any) => sq.query || sq)
                  if (queries.length > 0) push({ type: "suggested_queries", queries })
                }
              }
            }
          }
        })

        res.on("end", () => {
          if (!done) {
            push({ type: "done" })
            finish()
          }
        })

        res.on("error", (err) => {
          push({ type: "error", message: err.message })
          finish()
        })
      }
    )

    req.on("error", (err) => {
      push({ type: "error", message: `Request failed: ${err.message}` })
      finish()
    })

    abortController = { abort: () => req.destroy() }
    req.write(body)
    req.end()

    // Async iterator that yields events as they arrive
    while (true) {
      if (pending.length > 0) {
        const ev = pending.shift()!
        if (ev.type === "done") return
        yield ev
      } else if (done) {
        return
      } else {
        const ev = await new Promise<IteratorResult<AgentEvent>>((r) => { waiting = r })
        if (ev.done) return
        if (ev.value.type === "done") return
        yield ev.value
      }
    }
  }

  return { stream: generate(), abort: () => abortController.abort() }
}

// Legacy wrapper for compatibility
export async function* streamAgentResponse(
  question: string,
  options: AgentStreamOptions = {}
): AsyncGenerator<AgentEvent> {
  const { stream } = streamAgentRaw(question, options)
  yield* stream
}

function processToolResult(content: any[], push: (e: AgentEvent) => void) {
  for (const item of content) {
    if (item.type === "json") {
      const json = item.json || {}
      if (json.sql) push({ type: "sql", statement: json.sql })
      if (json.result_set?.data && json.result_set?.resultSetMetaData?.rowType) {
        const columns = json.result_set.resultSetMetaData.rowType.map((col: any) => col.name)
        const rows = json.result_set.data.map((row: any[]) => {
          const obj: Record<string, any> = {}
          columns.forEach((col: string, i: number) => { obj[col] = row[i] })
          return obj
        })
        push({ type: "table", columns, rows })
      }
      if (json.error?.message) push({ type: "text", text: `Error: ${json.error.message}` })
      else if (json.error && typeof json.error === "string") push({ type: "text", text: `Error: ${json.error}` })
    } else if (item.type === "text") {
      push({ type: "text", text: item.text })
    }
  }
}

function processTableBlock(block: any, push: (e: AgentEvent) => void) {
  const resultSet = block.result_set || block.table?.result_set
  if (resultSet?.data && resultSet?.resultSetMetaData?.rowType) {
    const columns = resultSet.resultSetMetaData.rowType.map((col: any) => col.name)
    const rows = resultSet.data.map((row: any[]) => {
      const obj: Record<string, any> = {}
      columns.forEach((col: string, i: number) => { obj[col] = row[i] })
      return obj
    })
    push({ type: "table", columns, rows })
  }
}
