#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Guardrail: block creating a NEW Snowflake connection — always reuse the
# active Workspace / Streamlit-in-Snowflake session.
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

# Block only genuine connection-creation calls.
if printf '%s' "$payload" | grep -Eiq 'Session[[:space:]]*\.[[:space:]]*builder|snowflake\.connector\.connect[[:space:]]*\(|snowflake\.snowpark\.Session\(' ; then
  echo "BLOCKED: do not create a new Snowflake connection/session. In a Workspace or Streamlit-in-Snowflake this hijacks and breaks the active connection. Reuse the active session instead:
  from snowflake.snowpark.context import get_active_session
  session = get_active_session()
To run SQL, prefer the snowflake_sql_execute tool or 'snow sql'." >&2
  exit 2
fi

exit 0
