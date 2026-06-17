---
name: apc-explore-schema
description: "Inventory and explore a schema in the AI Product Costing accelerator. Prompts the engineer for a schema, then lists its tables/views, row counts, storage sizes, dynamic-table status and freshness, and lineage, and suggests next data-engineering steps. Read-only — runs in a Snowflake Workspace with Cortex Code. Triggers: explore schema, inventory schema, whats in this schema, list tables, schema overview, what tables do we have, dynamic table status, lineage, schema map."
---

# APC — Explore Schema

Read-only orientation skill: gives a data engineer a fast map of what exists in an APC schema before they change anything. Built for a **Snowsight Workspace** with Cortex Code.

> Scope: `APC_DEPLOY_DB.SAP_RAW` (raw SAP extracts \u2014 the dbt source), `APC_DEPLOY_DB.SAP_BDC` (curated SAP tables), `APC_DEPLOY_DB.ANALYTICS` (views + ML + scenarios), `APC_DEPLOY_DB.DBT_ANALYTICS` (the dbt Dynamic-Table **marts the app reads**), `APC_DEPLOY_DB.ENGINEERING` (optional hand-written Dynamic Table demo). In a Workspace omit `-c`; locally add `-c <your-connection>`.

**⚠️ How to run queries:** Use the `snowflake_sql_execute` tool, or `snow sql -q "..."`. **Do NOT run Python that calls `Session.builder...create()`** — in a Workspace / Streamlit-in-Snowflake that opens a second session and breaks the active connection. If Snowpark Python is genuinely required, reuse the session: `from snowflake.snowpark.context import get_active_session; session = get_active_session()`.

> **Variables**: Read `vars.yaml` for `database` and `warehouse` values (defaults: `APC_DEPLOY_DB`, `APC_DEPLOY_WH`). Use these when running queries or commands below.

## Workflow

### Step 1 — Get the schema

**Ask the engineer** which schema to explore (`ask_user_question`, default `APC_DEPLOY_DB.DBT_ANALYTICS`). Offer the known schemas above.

### Step 2 — Inventory objects

```bash
snow sql -q "SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT, ROUND(BYTES/1024/1024,1) AS MB, CREATED, LAST_ALTERED FROM APC_DEPLOY_DB.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '<SCHEMA>' ORDER BY TABLE_TYPE, TABLE_NAME"
```

### Step 3 — Dynamic tables (if any)

```bash
snow sql -q "SHOW DYNAMIC TABLES IN SCHEMA APC_DEPLOY_DB.<SCHEMA>"
```
For each, report `target_lag`, `refresh_mode`, `scheduling_state`. Then the latest refresh status:
```bash
snow sql -q "SELECT NAME, STATE, REFRESH_ACTION, DATA_TIMESTAMP, REFRESH_END_TIME FROM TABLE(APC_DEPLOY_DB.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY()) WHERE SCHEMA_NAME='<SCHEMA>' QUALIFY ROW_NUMBER() OVER (PARTITION BY NAME ORDER BY REFRESH_START_TIME DESC)=1"
```

### Step 4 — Lineage (optional, for understanding dependencies)

For a key object, show upstream/downstream:
```bash
snow sql -q "SELECT * FROM TABLE(SNOWFLAKE.CORE.GET_LINEAGE('APC_DEPLOY_DB.<SCHEMA>.<OBJECT>', 'TABLE', 'UPSTREAM', 2))"
```
If `GET_LINEAGE` is unavailable, infer dependencies from the `sql/` scripts and dynamic-table definitions instead.

### Step 5 — Summarise + suggest next steps

Present:
- **Object inventory** table (name, type, rows, MB, last altered)
- **Dynamic table health** (lag, mode, scheduling state, last refresh) if applicable
- **Layer role** — explain where this schema sits (raw / semantic / engineered) per `AGENT.md`
- **Suggested next steps**, e.g.:
  - "Run `apc-data-quality` on `<object>` to profile it."
  - "Use `apc-new-pipeline` to add a staging→curated→mart set for `<raw table>`."
  - "Use `apc-data-engineering` to modify `<object>`."

Use `visualize_data` (e.g. rows or MB per object) when it helps; aggregate to <=500 rows first.

## Stopping Points
- ✋ After Step 5 — read-only; route the engineer to the right write-skill for any change.

## Output
A schema map: object inventory with sizes, dynamic-table health, dependency context, and recommended next data-engineering actions. No changes are made.
