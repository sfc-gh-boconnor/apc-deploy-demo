/**
 * Cortex Agent REST API streaming helper.
 * Calls the agent:run endpoint with SSE streaming and yields parsed events.
 */

import fs from "fs"
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
  // SPCS injects SNOWFLAKE_ACCOUNT_URL or SNOWFLAKE_HOST
  if (process.env.SNOWFLAKE_ACCOUNT_URL) return process.env.SNOWFLAKE_ACCOUNT_URL
  if (process.env.SNOWFLAKE_HOST) return `https://${process.env.SNOWFLAKE_HOST}`
  // Fallback: construct from account identifier
  const account = process.env.SNOWFLAKE_ACCOUNT || ""
  if (account) return `https://${account}.snowflakecomputing.com`
  return ""
}

export interface AgentStreamOptions {
  agentName?: string
  schema?: string
  database?: string
  signal?: AbortSignal
}

/**
 * Stream events from the Cortex Agent REST API.
 * Yields AgentEvent objects as they arrive from the SSE stream.
 */
export async function* streamAgentResponse(
  question: string,
  options: AgentStreamOptions = {}
): AsyncGenerator<AgentEvent> {
  const {
    agentName = "APC_RECONCILIATION_AGENT",
    schema = "ANALYTICS",
    database: db = DATABASE,
    signal,
  } = options

  const token = getToken()
  if (!token) {
    yield { type: "error", message: "No SPCS token available — agent streaming requires SPCS runtime" }
    return
  }

  const accountUrl = getAccountUrl()
  if (!accountUrl) {
    yield { type: "error", message: "Cannot determine Snowflake account URL" }
    return
  }

  const url = `${accountUrl}/api/v2/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/agents/${encodeURIComponent(agentName)}:run`

  const body = JSON.stringify({
    messages: [{ role: "user", content: [{ type: "text", text: question }] }],
    stream: true,
  })

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    body,
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    yield { type: "error", message: `Agent API error (${res.status}): ${errText.slice(0, 500)}` }
    return
  }

  // Parse SSE stream
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  // Track content blocks by index for proper assembly
  const blockTypes = new Map<number, string>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") {
        if (payload === "[DONE]") {
          yield { type: "done" }
          return
        }
        continue
      }

      let event: any
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }

      // The Cortex Agent streaming format uses Anthropic-style SSE events:
      // - message_start: beginning of message
      // - content_block_start: start of a content block (text, thinking, tool_use, tool_result)
      // - content_block_delta: incremental text/thinking token
      // - content_block_stop: end of a content block
      // - message_delta: end of message with stop_reason
      // - message_stop: final event

      const eventType = event.type || event.event

      if (eventType === "content_block_start") {
        const block = event.content_block
        const idx = event.index ?? 0
        if (block) {
          blockTypes.set(idx, block.type)

          // tool_use blocks contain the generated SQL in input.sql
          if (block.type === "tool_use" && block.input?.sql) {
            yield { type: "sql", statement: block.input.sql }
          }

          // tool_result blocks contain SQL execution results
          if (block.type === "tool_result" || block.type === "tool_results") {
            const content = block.content || []
            for (const item of content) {
              if (item.type === "json") {
                const json = item.json || {}
                // Extract SQL from the result
                if (json.sql) {
                  yield { type: "sql", statement: json.sql }
                }
                // Extract result_set table data
                if (json.result_set?.data && json.result_set?.resultSetMetaData?.rowType) {
                  const columns = json.result_set.resultSetMetaData.rowType.map((col: any) => col.name)
                  const rows = json.result_set.data.map((row: any[]) => {
                    const obj: Record<string, any> = {}
                    columns.forEach((col: string, i: number) => { obj[col] = row[i] })
                    return obj
                  })
                  yield { type: "table", columns, rows }
                }
                // Extract error messages
                if (json.error?.message) {
                  yield { type: "text", text: `Error: ${json.error.message}` }
                } else if (json.error && typeof json.error === "string") {
                  yield { type: "text", text: `Error: ${json.error}` }
                }
              } else if (item.type === "text") {
                yield { type: "text", text: item.text }
              }
            }
          }

          // table blocks at content level
          if (block.type === "table") {
            const resultSet = block.result_set || block.table?.result_set
            if (resultSet?.data && resultSet?.resultSetMetaData?.rowType) {
              const columns = resultSet.resultSetMetaData.rowType.map((col: any) => col.name)
              const rows = resultSet.data.map((row: any[]) => {
                const obj: Record<string, any> = {}
                columns.forEach((col: string, i: number) => { obj[col] = row[i] })
                return obj
              })
              yield { type: "table", columns, rows }
            }
          }
        }
      } else if (eventType === "content_block_delta") {
        const delta = event.delta
        const idx = event.index ?? 0
        const blockType = blockTypes.get(idx)

        if (delta?.type === "thinking_delta" || blockType === "thinking") {
          yield { type: "thinking", text: delta.thinking || delta.text || "" }
        } else if (delta?.type === "text_delta" || blockType === "text") {
          yield { type: "text", text: delta.text || "" }
        } else if (delta?.type === "input_json_delta") {
          // Tool input being streamed — skip (internal agent mechanics)
        }
      } else if (eventType === "content_block_stop") {
        // Block finished — nothing to emit
      } else if (eventType === "message_stop" || eventType === "message_delta") {
        // Check for suggested queries in message_delta.content or stop reason
        if (event.delta?.content) {
          for (const block of event.delta.content) {
            if (block.type === "suggested_queries") {
              const queries = (block.suggested_queries || []).map((sq: any) => sq.query || sq)
              if (queries.length > 0) yield { type: "suggested_queries", queries }
            }
          }
        }
      }

      // Handle flat/non-streaming event format (full message in one event)
      if (event.content && Array.isArray(event.content)) {
        for (const block of event.content) {
          if (block.type === "text") {
            yield { type: "text", text: block.text }
          } else if (block.type === "thinking") {
            yield { type: "thinking", text: block.thinking?.text || block.thinking || block.text || "" }
          } else if (block.type === "tool_use") {
            // Extract SQL from tool_use input
            if (block.tool_use?.input?.sql || block.input?.sql) {
              yield { type: "sql", statement: block.tool_use?.input?.sql || block.input?.sql }
            }
          } else if (block.type === "tool_result") {
            const content = block.tool_result?.content || block.content || []
            for (const item of content) {
              const json = item.json || item
              if (json.sql) {
                yield { type: "sql", statement: json.sql }
              }
              if (json.result_set?.data && json.result_set?.resultSetMetaData?.rowType) {
                const columns = json.result_set.resultSetMetaData.rowType.map((col: any) => col.name)
                const rows = json.result_set.data.map((row: any[]) => {
                  const obj: Record<string, any> = {}
                  columns.forEach((col: string, i: number) => { obj[col] = row[i] })
                  return obj
                })
                yield { type: "table", columns, rows }
              }
            }
          } else if (block.type === "table") {
            const resultSet = block.table?.result_set || block.result_set
            if (resultSet?.data && resultSet?.resultSetMetaData?.rowType) {
              const columns = resultSet.resultSetMetaData.rowType.map((col: any) => col.name)
              const rows = resultSet.data.map((row: any[]) => {
                const obj: Record<string, any> = {}
                columns.forEach((col: string, i: number) => { obj[col] = row[i] })
                return obj
              })
              yield { type: "table", columns, rows }
            }
          } else if (block.type === "suggested_queries") {
            const queries = (block.suggested_queries || []).map((sq: any) => sq.query || sq)
            if (queries.length > 0) yield { type: "suggested_queries", queries }
          }
        }
      }
    }
  }

  // If we exit without [DONE], yield done anyway
  yield { type: "done" }
}
