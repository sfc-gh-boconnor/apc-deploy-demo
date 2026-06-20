#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Guardrail: block creating a NEW Snowflake connection — always reuse the
# active Workspace / Streamlit-in-Snowflake session's auth token.
#
# WHY: In a Workspace the platform provides a short-lived OAuth token via
# /snowflake/session/token. Creating a NEW connection (Session.builder,
# snowflake.connector.connect, SnowflakeConnection, etc.) opens a SECOND
# session that races with the platform token — the platform then revokes
# the original token, breaking the Workspace connection mid-flight.
# The ONLY safe pattern is to reuse the existing session:
#   from snowflake.snowpark.context import get_active_session
#   session = get_active_session()
# Or run SQL via `snowflake_sql_execute` / `snow sql`.
#
# Registered as a Cortex Code PreToolUse hook (matcher ".*"). Reads the hook
# JSON on stdin. It only inspects EXECUTION tools (Bash, notebook cell add/edit,
# generic code-exec); it never blocks file edits/reads, so documentation that
# merely mentions these patterns is unaffected.
#
# Exit 2 = block (stderr is shown to the agent). Exit 0 = allow.
# -----------------------------------------------------------------------------
input="$(cat)"

tool="$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_name",""))
except Exception: print("")' 2>/dev/null)"

# Never block file-editing / read-only tools (their content may legitimately
# document the forbidden pattern, e.g. AGENT.md / SKILL.md).
case "$tool" in
  Edit|MultiEdit|Write|Read|Grep|Glob|NotebookRead|notebook_read|notebook_output) exit 0 ;;
esac

# Pull the tool_input as a compact JSON string to scan.
payload="$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.dumps(json.load(sys.stdin).get("tool_input",{})))
except Exception: print("")' 2>/dev/null)"

# Block genuine connection-creation calls.
# Patterns caught:
#   1. Session.builder             (Snowpark session builder)
#   2. snowflake.connector.connect (Python connector direct)
#   3. snowflake.snowpark.Session( (Snowpark session constructor)
#   4. SnowflakeConnection(        (alternate connector wrapper)
#   5. create_engine.*snowflake    (SQLAlchemy with Snowflake dialect)
#   6. snowflake.connector.SnowflakeConnection (direct class instantiation)
if printf '%s' "$payload" | grep -Eiq 'Session[[:space:]]*\.[[:space:]]*builder|snowflake\.connector\.connect[[:space:]]*\(|snowflake\.snowpark\.Session\(|SnowflakeConnection[[:space:]]*\(|create_engine[^)]*snowflake|snowflake\.connector\.SnowflakeConnection' ; then
  cat >&2 <<'MSG'
BLOCKED: Do not create a new Snowflake connection/session.

In a Workspace or Streamlit-in-Snowflake, the platform provides a short-lived
OAuth token. Creating a NEW connection hijacks this token and BREAKS the active
Workspace session (the token gets expired/revoked).

✅ Correct — reuse the existing session:
    from snowflake.snowpark.context import get_active_session
    session = get_active_session()

✅ Or run SQL directly:
    snowflake_sql_execute tool  |  snow sql -q "..."

❌ Blocked patterns:
    Session.builder...create()
    snowflake.connector.connect(...)
    snowflake.snowpark.Session(...)
    SnowflakeConnection(...)
    create_engine("snowflake://...")
MSG
  exit 2
fi

exit 0
