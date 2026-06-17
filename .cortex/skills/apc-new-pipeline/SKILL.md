---
name: apc-new-pipeline
description: "Scaffold a new medallion Dynamic Table pipeline (staging -> curated -> mart) for a source table in the AI Product Costing accelerator. Prompts the engineer for the source and target, generates DT DDL following the sql/08 pattern, validates, deploys to APC_DEPLOY_DB.ENGINEERING, verifies refresh, and commits to a NEW feature branch (main stays the template). Runs in a Snowflake Workspace with Cortex Code. Triggers: new pipeline, scaffold pipeline, add dynamic table pipeline, build staging curated mart, new medallion pipeline, engineer a new source, add a pipeline for."
---

# APC — New Pipeline (scaffold)

Generate a new staging → curated → mart Dynamic Table pipeline for a source table, following the established pattern in `sql/08_data_engineering.sql`. Write skill — built for a **Snowsight Workspace** with Cortex Code.

> Scope: builds into `APC_DEPLOY_DB.ENGINEERING`, sourcing from `APC_DEPLOY_DB.SAP_RAW` / `APC_DEPLOY_DB.SAP_BDC` (raw) or `APC_DEPLOY_DB.ANALYTICS`. In a Workspace omit `-c`; locally add `-c <your-connection>`.\n>\n> **Note:** this scaffolds the **SQL-authored** Dynamic Table layer (`ENGINEERING`). The app's production pipeline is the dbt project `dbt/apc` → `APC_DEPLOY_DB.DBT_ANALYTICS`; to add models there instead, create them under `dbt/apc/models/` and build via `apc-dbt-demo`.

**⚠️ How to run queries:** Use the `snowflake_sql_execute` tool, or `snow sql -q "..."` / `snow sql -f <file>`. **Do NOT run Python that calls `Session.builder...create()`** — in a Workspace / Streamlit-in-Snowflake that opens a second session and breaks the active connection. If Snowpark Python is genuinely required, reuse the session: `from snowflake.snowpark.context import get_active_session; session = get_active_session()`.

## Git discipline (READ FIRST)
**`main` is the pristine accelerator template — never commit engineer changes to it.** All new work goes on a feature branch.

```bash
git rev-parse --abbrev-ref HEAD   # check current branch
```
If on `main`, create a branch before writing anything:
```bash
git checkout -b de/<short-kebab-summary>   # e.g. de/add-inventory-pipeline
```

> **Variables**: Read `vars.yaml` for `database` and `warehouse` values (defaults: `APC_DEPLOY_DB`, `APC_DEPLOY_WH`). Use these when running queries or commands below.

## Workflow

### Step 1 — Gather requirements

**Ask the engineer** (`ask_user_question`):
- **Source object** (default a `APC_DEPLOY_DB.SAP_BDC` table)
- **Pipeline name / subject** (e.g. `INVENTORY`, `YIELD`) — used to name the DTs
- **Grain** of the mart (e.g. material × period, plant × period)
- **Target lag** for staging (default `1 hour`)

**⚠️ STOP**: Confirm requirements before generating DDL.

### Step 2 — Inspect the source

```bash
snow sql -q "DESCRIBE TABLE <SOURCE>"
snow sql -q "SELECT * FROM <SOURCE> LIMIT 5"
```
Use real columns/types to build the SELECTs — never assume column names.

### Step 3 — Generate the pipeline DDL

Create `sql/<NN>_<subject>_pipeline.sql` (next free number) with three (or four) Dynamic Tables, mirroring `sql/08_data_engineering.sql` conventions:

- `STG_<SUBJECT>` — clean/conform: TRIM keys, `LPAD(POPER,3,'0')`, rename SAP fields, drop incomplete rows. `REFRESH_MODE = INCREMENTAL`, `TARGET_LAG = '<lag>'`.
- `CURATED_<SUBJECT>` — enrich (join master data), compute business metrics + flags. `TARGET_LAG = 'DOWNSTREAM'`, `INCREMENTAL`.
- `MART_<SUBJECT>` — aggregate to the requested grain. `TARGET_LAG = 'DOWNSTREAM'`, `REFRESH_MODE = AUTO`.
- (optional) `DQ_<SUBJECT>_CHECKS` — one row per rule, `REFRESH_MODE = FULL`.

Every DT: `WAREHOUSE = APC_DEPLOY_WH`, `INITIALIZE = ON_CREATE`, a `COMMENT`. Reuse the exact header/section style from `sql/08`.

### Step 4 — Validate

Compile before running. Use `snowflake_sql_execute` with `only_compile: true` for each `CREATE OR REPLACE DYNAMIC TABLE`, or:
```bash
snow sql -q "EXPLAIN <the inner SELECT>"
```
Fix any errors (the most common is an unsupported construct for `INCREMENTAL` → switch that table to `REFRESH_MODE = FULL`).

**⚠️ STOP**: Show the generated DDL and validation result; get approval before deploying.

### Step 5 — Deploy

```bash
snow sql -f sql/<NN>_<subject>_pipeline.sql
```

### Step 6 — Verify

```bash
snow sql -q "SELECT COUNT(*) FROM APC_DEPLOY_DB.ENGINEERING.MART_<SUBJECT>"
snow sql -q "SELECT NAME, STATE, REFRESH_ACTION FROM TABLE(APC_DEPLOY_DB.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY()) WHERE SCHEMA_NAME='ENGINEERING' AND NAME ILIKE '%<SUBJECT>%' ORDER BY REFRESH_START_TIME DESC"
```
Optionally hand off to `apc-data-quality` on the new mart.

### Step 7 — Commit to the feature branch

```bash
git add sql/<NN>_<subject>_pipeline.sql
git commit -m "Add <SUBJECT> medallion pipeline (staging/curated/mart)"
```
Do **not** merge to `main`. Tell the engineer the branch name and that they can open a PR when ready.

## Stopping Points
- ✋ Step 1 — requirements confirmed
- ✋ Step 4 — DDL + validation approved before deploy
- ✋ Before any commit to `main` — never do it; use the feature branch

## Output
A new, deployed medallion Dynamic Table pipeline in `APC_DEPLOY_DB.ENGINEERING`, defined in a new `sql/` script and committed to a feature branch. `main` is untouched.
