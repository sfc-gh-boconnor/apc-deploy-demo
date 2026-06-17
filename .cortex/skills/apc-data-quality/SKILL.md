---
name: apc-data-quality
description: "Generate a data quality report for a table, view, or schema in the AI Product Costing accelerator. Prompts the engineer for an object name, profiles it (row counts, null rates, cardinality, duplicates, numeric stats, freshness), and flags issues with suggested fixes. Read-only — runs in a Snowflake Workspace with Cortex Code. Triggers: data quality report, DQ report, profile table, check data quality, data quality check, profile schema, null check, duplicate check, freshness check, assess table quality."
---

# APC — Data Quality Report

Read-only data quality profiling for any APC object. Built for a data engineer working in a **Snowsight Workspace** with Cortex Code. Prompts for the object, runs profiling SQL, and returns a report with flagged issues.

> Scope: APC objects \u2014 raw extracts `APC_DEPLOY_DB.SAP_RAW.*`, curated `APC_DEPLOY_DB.SAP_BDC.*`, semantic `APC_DEPLOY_DB.ANALYTICS.*`, dbt marts `APC_DEPLOY_DB.DBT_ANALYTICS.*` (what the app reads), engineered `APC_DEPLOY_DB.ENGINEERING.*`. In a Workspace omit `-c`; locally add `-c <your-connection>`.

**⚠️ How to run queries:** Use the `snowflake_sql_execute` tool, or `snow sql -q "..."`. **Do NOT run Python that calls `Session.builder...create()`** — in a Workspace / Streamlit-in-Snowflake that opens a second session and breaks the active connection. If Snowpark Python is genuinely required, reuse the session: `from snowflake.snowpark.context import get_active_session; session = get_active_session()`.

> **Variables**: Read `vars.yaml` for `database` and `warehouse` values (defaults: `APC_DEPLOY_DB`, `APC_DEPLOY_WH`). Use these when running queries or commands below.

## Workflow

### Step 1 — Get the target object

**Ask the engineer** which object to profile (use `ask_user_question`, default `APC_DEPLOY_DB.ENGINEERING.CURATED_PRODUCT_COST`):
- A single table or view: `APC_DEPLOY_DB.<SCHEMA>.<OBJECT>`
- Or a whole schema: `APC_DEPLOY_DB.<SCHEMA>` (profile every table/view in it)

If a schema is given, list its objects first and confirm which to include:
```bash
snow sql -q "SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT FROM APC_DEPLOY_DB.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '<SCHEMA>' ORDER BY TABLE_NAME"
```

### Step 2 — Inspect structure

```bash
snow sql -q "DESCRIBE TABLE APC_DEPLOY_DB.<SCHEMA>.<OBJECT>"
```
Use the column list + types to build the profiling queries in Step 3 (numeric vs string vs date columns get different checks).

### Step 3 — Profile the object

Run these checks (adapt column names from Step 2). Keep each query small.

**Volume + freshness:**
```bash
snow sql -q "SELECT COUNT(*) AS ROW_COUNT FROM APC_DEPLOY_DB.<SCHEMA>.<OBJECT>"
```
If a date/period column exists, report range: `SELECT MIN(<dt>), MAX(<dt>) FROM ...`.

**Null rate per column** (build dynamically from Step 2 columns):
```sql
SELECT
  COUNT(*) AS ROWS,
  SUM(CASE WHEN <col> IS NULL THEN 1 ELSE 0 END) AS <col>_NULLS,
  ROUND(SUM(CASE WHEN <col> IS NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0)*100,1) AS <col>_NULL_PCT
  -- repeat per column
FROM APC_DEPLOY_DB.<SCHEMA>.<OBJECT>;
```

**Cardinality / distinct counts** for key + categorical columns:
```sql
SELECT COUNT(DISTINCT <key>) AS DISTINCT_KEYS, COUNT(*) AS ROWS FROM APC_DEPLOY_DB.<SCHEMA>.<OBJECT>;
```

**Duplicate check** on the business/primary key (e.g. material+plant+period):
```sql
SELECT <k1>,<k2>,<k3>, COUNT(*) AS N
FROM APC_DEPLOY_DB.<SCHEMA>.<OBJECT>
GROUP BY 1,2,3 HAVING COUNT(*) > 1 ORDER BY N DESC LIMIT 20;
```

**Numeric sanity** (per numeric column): `MIN`, `MAX`, `AVG`, `STDDEV`, count of negatives/zeros where unexpected.

### Step 4 — Flag issues

Apply these heuristics and build an issues list:

| Check | Flag when |
|-------|-----------|
| Null rate | a non-nullable/business column > 5% NULL |
| Duplicates | any business-key group has COUNT > 1 |
| Freshness | latest period/date older than expected |
| Numeric outlier | values outside plausible range (e.g. negative cost, variance > 100%) |
| Cardinality | a supposed key has DISTINCT < ROW_COUNT |
| Empty | ROW_COUNT = 0 |

### Step 5 — Render the report

Present a concise report:
- **Object**, row count, freshness window
- **Column profile** table (type, null %, distinct)
- **Issues found** (severity + the failing metric) — or "No issues found"
- **Suggested fixes** (e.g. add a NOT NULL filter in staging, dedupe with QUALIFY ROW_NUMBER, investigate source). For the **dbt marts** (`DBT_ANALYTICS.*`), point at the relevant model in `dbt/apc/models/` and hand off to `apc-dbt-demo`. For the hand-written `ENGINEERING` tables, point at the `sql/08_data_engineering.sql` definition and offer to hand off to `apc-data-engineering`.

Use `visualize_data` for null-rate or issue-count bars when it aids clarity (aggregate to <=500 rows first).

## Stopping Points
- ✋ After Step 1 if a schema has many objects — confirm the subset before profiling.
- ✋ After Step 5 — this skill is read-only; to fix an issue, hand off to `apc-data-engineering`.

## Output
A data quality report for the chosen object(s): volume, per-column profile, flagged issues with severity, and concrete remediation suggestions. No changes are made to any object.
