# Data Engineering Skills — Guide

A set of **standard, invokable data-engineering skills** for the AI Product Costing accelerator. They are built for a data engineer working in a **Snowflake Workspace with Cortex Code (CoCo)** — the right tool for hands-on, deployable data engineering (as opposed to Snowflake Intelligence, which is aimed at business Q&A).

You describe what you want in plain English; CoCo runs the skill, asks for any inputs it needs (a table name, a change description), does the work, and — for changes — validates, deploys, and commits to a feature branch.

## How to use a skill

1. Open this repo in a **Snowsight Workspace** (or locally with the `snow` CLI configured).
2. In the CoCo chat, either:
   - **Invoke explicitly:** type `/apc-data-quality` (or `$apc-data-quality`), or
   - **Just ask** in plain English — CoCo matches your request to the right skill by its triggers (e.g. "give me a data quality report for the curated cost table").
3. Answer the prompt(s) CoCo asks (e.g. which table, what change).
4. For write skills, review the diff and approve before anything is deployed.

> **Environment:** In a Workspace, auth is implicit (no `-c` flag) and paths are relative. Locally, every command needs `-c <your-connection>`.

## The skills

### `apc-explore-schema` — orientation (read-only)
Inventory a schema before you touch it: objects, row counts, storage sizes, Dynamic Table health (target lag, refresh mode, last refresh), and lineage, plus suggested next steps.

- **Use when:** "what's in `APC_DEPLOY_DB.ENGINEERING`?", starting on an unfamiliar area, checking DT refresh status.
- **It will ask:** which schema (`APC_DEPLOY_DB.SAP_RAW`, `APC_DEPLOY_DB.SAP_BDC`, `APC_DEPLOY_DB.ANALYTICS`, `APC_DEPLOY_DB.DBT_ANALYTICS`, or `APC_DEPLOY_DB.ENGINEERING`).
- **Example prompts:**
  - "Explore the ENGINEERING schema"
  - "What tables and views do we have in ANALYTICS and how big are they?"

### `apc-data-quality` — DQ report (read-only)
Profile a table, view, or whole schema and get a data quality report: row counts, per-column null rates, cardinality, duplicate-key checks, numeric sanity, and freshness — with flagged issues and suggested fixes.

- **Use when:** validating a table is analysis-ready, investigating suspect data, a periodic quality check.
- **It will ask:** the object name (e.g. `APC_DEPLOY_DB.ENGINEERING.CURATED_PRODUCT_COST`); if you give a schema, it confirms which objects to include.
- **Example prompts:**
  - "Run a data quality report on `APC_DEPLOY_DB.ENGINEERING.MART_PRODUCT_COST_MONTHLY`"
  - "Check the data quality of the SAP_BDC schema"
- **Output:** a report only — to fix an issue it finds, it hands off to `apc-data-engineering`.

### `apc-new-pipeline` — scaffold a pipeline (write)
Build a brand-new medallion Dynamic Table pipeline (staging → curated → mart, plus optional DQ checks) for a source table, following the established `sql/08_data_engineering.sql` pattern. Validates, deploys to `APC_DEPLOY_DB.ENGINEERING`, verifies, and commits to a feature branch.

- **Use when:** onboarding a new source into the engineered layer.
- **It will ask:** source object, pipeline subject/name, mart grain, target lag.
- **Example prompts:**
  - "Scaffold a new pipeline from `APC_DEPLOY_DB.SAP_BDC.MATERIAL_VALUATION`"
  - "Add a staging→curated→mart pipeline for inventory data at material × period grain"

### `apc-data-engineering` — change & deploy (write)
The core loop. Describe a change to the engineered layer in plain English; CoCo edits the SQL/Dynamic Table definition, validates it, deploys it, verifies the refresh, and commits to a feature branch.

- **Use when:** adding a column, a new metric, fixing a transform, changing grain or target lag, adding a DQ rule.
- **It will ask:** what you want to change (free text).
- **Example prompts:**
  - "Add a `MARGIN_PCT` column to the mart"
  - "Exclude raw materials (MTART = 'ROH') from staging"
  - "Tighten the staging target lag to 20 minutes"
  - "Add a data quality rule for negative stock value"

## Typical workflow

```
explore-schema   →   data-quality   →   data-engineering / new-pipeline
(what's here?)       (is it good?)       (change it / build it)  →  deploy + commit to branch
```

A common loop: explore a schema, profile a table, spot an issue in the DQ report, then ask `apc-data-engineering` to fix it — review, deploy, done.

## Git model (important)

`main` is the **pristine accelerator template** — engineer changes are never committed to it.

- The write skills (`apc-new-pipeline`, `apc-data-engineering`) automatically work on a **feature branch** named `de/<short-summary>` (created from `main` if you're on `main`).
- They commit your change to that branch and leave merging to a **pull request** you open when ready.
- This keeps the demo baseline clean and makes every change reviewable.

## What you can change vs not

| Layer | Schema | Editable by these skills? |
|-------|--------|---------------------------|
| Raw SAP extracts (source of record) | `APC_DEPLOY_DB.SAP_RAW` | No — read only (the dbt pipeline's source) |
| Curated SAP tables | `APC_DEPLOY_DB.SAP_BDC` | No — read only |
| **dbt marts (the app reads these)** | `APC_DEPLOY_DB.DBT_ANALYTICS` | Via `dbt/apc` models + `apc-dbt-demo` |
| Engineered (hand-written medallion DTs) | `APC_DEPLOY_DB.ENGINEERING` | Yes — this is where `apc-data-engineering` / `apc-new-pipeline` changes land |
| Semantic / app views + ML + scenarios | `APC_DEPLOY_DB.ANALYTICS` | Read for context; change with care |

## Before you start

- The accelerator must be deployed (raw data populated). If not, run the `apc-deploy` skill first.
- You need a role with the usual engineering privileges on `APC_DEPLOY_DB` and usage on `APC_DEPLOY_WH`.
- Read `AGENT.md` at the repo root for the full project context, data model, and conventions.

## Writing Snowpark in a Workspace

If you ask CoCo to write **Snowpark Python** (e.g. in a Workspace notebook or cell), it reuses the existing Workspace session:

```python
from snowflake.snowpark.context import get_active_session
session = get_active_session()
```

Do **not** use `Session.builder.configs(...).create()` in a Workspace or Streamlit-in-Snowflake — creating a new session hijacks and breaks the active connection. Always `get_active_session()`.
