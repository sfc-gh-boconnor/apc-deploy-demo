---
name: apc-data-engineering
description: "Make a change to the engineered data layer of the AI Product Costing accelerator and deploy it, in a Snowflake Workspace with Cortex Code. The engineer describes a change in plain English (add a column, new metric, fix a transform, change grain or target lag); CoCo edits the SQL/Dynamic Table definition, validates, deploys to APC_DEPLOY_DB.ENGINEERING, verifies the refresh, and commits to a NEW feature branch (main stays the template). Triggers: change the data, modify dynamic table, add a column, edit transformation, update the pipeline, fix the data, change target lag, alter mart, deploy data change, data engineering change, modify curated, engineer data."
---

# APC — Data Engineering: change & deploy

The core data-engineering loop for the accelerator: an engineer describes a change in plain English, and Cortex Code implements → validates → deploys → verifies → commits it. This is why a data engineer uses **Workspaces + Cortex Code** (not Snowflake Intelligence): direct edit-and-deploy control over the engineered layer.

> Scope: modifies existing objects in `APC_DEPLOY_DB.ENGINEERING` (and the `sql/` scripts that define them). Raw `APC_DEPLOY_DB.SAP_BDC` / `APC_DEPLOY_DB.SAP_RAW` are source-of-record — do not edit them. To build a brand-new pipeline use `apc-new-pipeline`; to profile/inspect first use `apc-data-quality` / `apc-explore-schema`.\n>\n> **Note:** the **primary** pipeline the app reads is the dbt project (`dbt/apc` → `APC_DEPLOY_DB.DBT_ANALYTICS` marts). To change those, edit the dbt models in `dbt/apc/models/` and rebuild via `apc-dbt-demo`. This skill targets the optional **SQL-authored** `ENGINEERING` Dynamic Tables (the non-dbt demo of the same medallion pattern).
>
> The baseline medallion pipeline (`sql/08_data_engineering.sql`: `STG_*` → `CURATED_PRODUCT_COST` → `MART_PRODUCT_COST_MONTHLY` + `DQ_PRODUCT_COST_CHECKS`) is the **template on `main`**. In a Workspace omit `-c`; locally add `-c <your-connection>`.

**⚠️ How to run queries:** Use the `snowflake_sql_execute` tool, or `snow sql -q "..."` / `snow sql -f <file>`. **Do NOT run Python that calls `Session.builder...create()`** — in a Workspace / Streamlit-in-Snowflake that opens a second session and breaks the active connection. If Snowpark Python is genuinely required, reuse the session: `from snowflake.snowpark.context import get_active_session; session = get_active_session()`.

## Git discipline (READ FIRST)
**`main` is the pristine template — never commit engineer changes to it.** Work on a feature branch.
```bash
git rev-parse --abbrev-ref HEAD            # check current branch
git checkout -b de/<short-kebab-summary>   # if on main, branch first (e.g. de/add-margin-col)
```

> **Variables**: Read `vars.yaml` for `database` and `warehouse` values (defaults: `APC_DEPLOY_DB`, `APC_DEPLOY_WH`). Use these when running queries or commands below.

## Workflow

### Step 1 — Understand the requested change

**Ask the engineer** what they want to change (`ask_user_question`, free text), e.g.:
- "Add a `MARGIN_PCT` column to the mart"
- "Exclude raw materials (MTART = 'ROH') from staging"
- "Change the mart grain to plant × period"
- "Tighten staging target lag to 20 minutes"
- "Add a data quality rule for negative stock value"

Restate the change and identify the **target object(s)** and the `sql/` file that defines them.

### Step 2 — Inspect current state

Read the defining SQL and the live object before editing:
```bash
snow sql -q "SELECT GET_DDL('TABLE', 'APC_DEPLOY_DB.ENGINEERING.<OBJECT>')"
snow sql -q "DESCRIBE TABLE APC_DEPLOY_DB.ENGINEERING.<OBJECT>"
```
Confirm upstream columns exist (read the source object's columns) — never assume.

### Step 3 — Implement the change in SQL

Edit the relevant `CREATE OR REPLACE DYNAMIC TABLE` block in its `sql/` file (e.g. `sql/08_data_engineering.sql`). Keep the existing style/comments. Mind the pipeline dependencies:
- A new column in `CURATED_*` that the `MART_*` should expose must be added to the mart's SELECT/GROUP BY too.
- Changing a key/grain may require updating downstream aggregations and DQ checks.

### Step 4 — Validate

Compile before deploying. Use `snowflake_sql_execute` with `only_compile: true` on each changed statement, or:
```bash
snow sql -q "EXPLAIN <the changed inner SELECT>"
```
For data changes, preview the new output:
```bash
snow sql -q "SELECT * FROM ( <new SELECT> ) LIMIT 10"
```
If incremental refresh is no longer supported by the new logic, switch that table to `REFRESH_MODE = FULL`.

**⚠️ STOP**: Show the diff (old vs new DDL), the validation result, and a sample preview. Get approval before deploying.

### Step 5 — Deploy

Apply the changed DDL to Snowflake:
```bash
snow sql -f sql/<file>.sql          # re-runs the CREATE OR REPLACE statements
```
`CREATE OR REPLACE DYNAMIC TABLE` re-points downstream `DOWNSTREAM` tables automatically.

### Step 6 — Verify

```bash
snow sql -q "DESCRIBE TABLE APC_DEPLOY_DB.ENGINEERING.<OBJECT>"        -- new column/shape present
snow sql -q "SELECT COUNT(*) FROM APC_DEPLOY_DB.ENGINEERING.<OBJECT>"  -- still populated
snow sql -q "SELECT NAME, STATE, REFRESH_ACTION, REFRESH_END_TIME FROM TABLE(APC_DEPLOY_DB.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY()) WHERE SCHEMA_NAME='ENGINEERING' ORDER BY REFRESH_START_TIME DESC LIMIT 10"
```
If a downstream table didn't pick up the change, force it: `ALTER DYNAMIC TABLE <name> REFRESH`. Optionally run `apc-data-quality` on the changed object.

### Step 7 — Commit to the feature branch

```bash
git add sql/<file>.sql
git commit -m "<concise description of the data change>"
```
Do **not** merge to `main`. Report the branch name; the engineer can open a PR when ready.

## Stopping Points
- ✋ Confirm you are on a feature branch (not `main`) before editing
- ✋ Step 4 — diff + validation + preview approved before deploy
- ✋ Never commit/merge to `main`

## Output
The requested change implemented in the `sql/` definition, deployed to `APC_DEPLOY_DB.ENGINEERING`, verified (shape + refresh), and committed to a feature branch — `main` untouched.

## Troubleshooting
| Error | Fix |
|-------|-----|
| `invalid identifier` on a new column | The upstream column doesn't exist — re-check with `DESCRIBE` on the source. |
| `incremental refresh not supported` | The new logic isn't incrementally maintainable — set that table to `REFRESH_MODE = FULL`. |
| Downstream table stale after deploy | `ALTER DYNAMIC TABLE <name> REFRESH`. |
| `Aggregate functions cannot be nested` | Don't `SUM()` over a column already aggregated upstream (e.g. `PRODUCT_PROFITABILITY`); aggregate from the base grain instead. |
