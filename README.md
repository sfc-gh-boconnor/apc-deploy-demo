# AI Product Costing (APC) — Deployment Demo

Snowflake demo accelerator for **SAP product costing & profitability** at a pharmaceutical company. Simulates SAP data via SAP BDC Connect (zero-copy), engineers it through a dbt medallion pipeline, layers a Feature Store + Model Registry for ML, scenario-based forecasting, and a live multi-tab React dashboard with Cortex AI chat.

> Entirely synthetic data. Brand-neutral and account-agnostic.

---

## Skills — your interface to this demo

Every action in this accelerator is driven by a Cortex Code skill. Type the skill name in the CoCo chat panel to begin.

| Skill | What it does | Components touched | R/W |
|-------|--------------|--------------------|-----|
| `/apc-github-setup` | Connect this repo as a Snowflake Workspace | Git repository, API integration, secret | W |
| `/apc-deploy` | Full accelerator deploy: SQL → dbt → Feature Store → React app | `sql/`, `dbt/apc/`, `feature_store.ipynb`, `app-ui/`, `APC_SV.yaml` | W |
| `/apc-cleanup` | Tear down all APC objects | Database, warehouse, Snowflake Application | W |
| `/apc-dbt-demo` | Build the raw-SAP → costed dbt pipeline | `dbt/apc/`, `DBT_ANALYTICS` schema, Feature Store | W |
| `/apc-explore-schema` | Schema inventory, Dynamic Table health, lineage | Any schema — default `DBT_ANALYTICS` | R |
| `/apc-data-quality` | DQ profiling: nulls, duplicates, freshness, outliers | Any table or view | R |
| `/apc-data-engineering` | Describe a change → edit → validate → deploy SQL Dynamic Tables | `sql/`, `ENGINEERING` schema | W |
| `/apc-new-pipeline` | Scaffold a new staging → curated → mart Dynamic Table pipeline | `sql/`, `ENGINEERING` schema | W |
| `/apc-external-integration` | Add outbound HTTPS access (network rule + integration) | Network rules, external access integrations | W |

---

## Component map

Each component shows which skill(s) manage it.

| Component | Description | Managed by |
|-----------|-------------|------------|
| `APC_DEPLOY_DB.SAP_RAW` | Raw messy SAP extracts (dbt source) | `/apc-deploy` (setup) · `/apc-dbt-demo` (full-refresh) |
| `APC_DEPLOY_DB.DBT_ANALYTICS` | dbt marts — what the React app reads, all Dynamic Tables | `/apc-dbt-demo` · `/apc-explore-schema` |
| `APC_DEPLOY_DB.ENGINEERING` | Hand-authored medallion Dynamic Tables | `/apc-new-pipeline` (create) · `/apc-data-engineering` (modify) |
| `APC_DEPLOY_DB.ML_FEATURE_STORE` | Feature Store: entities, feature views, training datasets, models | `/apc-deploy` (notebook step) · `/apc-dbt-demo` (step 7b) |
| `APC_SV.yaml` | Semantic model for Cortex Analyst (Ask AI tab) | `/apc-deploy` (stages to Snowflake) |
| React app / SPCS (`app-ui/`) | Next.js dashboard — 8 tabs, Cortex AI chat | `/apc-deploy` (deploy) · `/apc-cleanup` (teardown) |
| `dbt/apc/` | Native dbt project (`snow dbt`) | `/apc-dbt-demo` · `/apc-external-integration` (if external access needed) |
| GitHub Workspace | Repo-backed Workspace for in-browser development | `/apc-github-setup` |

**Dashboard tabs:** Variance Analysis · Scenario Analysis · Profitability · Sales Forecast · Smart Insights · Ask Cortex AI · Data Engineering · Observability & Trust

---

## Architecture

```
SAP_RAW ──────────────────┐
                           ▼
ENERGY_MARKET ──► dbt Pipeline (snow dbt) ──► DBT_ANALYTICS (Dynamic Table marts)
                                                        │
                                               React App (SPCS)
                                               [8-tab dashboard]
                                                        │
SCENARIO_INPUTS ──────────────────────────────► Scenario Forecast APIs

DBT_ANALYTICS ──► ML_FEATURE_STORE ──► 4 registered models
                  (feature views,       (variance, cost, yield, profitability)
                   training datasets)

APC_SV.yaml (semantic model) ──► Cortex Analyst ──► Ask AI tab
```

---

## Repository layout (reference)

| Path | What it is |
|------|------------|
| `sql/` | Numbered setup scripts (01–05, 09–11) |
| `app-ui/` | React / Next.js dashboard (App Runtime on SPCS) |
| `dbt/apc/` | Native dbt project → `DBT_ANALYTICS` Dynamic Table marts |
| `feature_store.ipynb` | Feature Store + Model Registry setup notebook |
| `APC_SV.yaml` | Semantic model for Cortex Analyst |
| `.cortex/skills/` | All project-local Cortex Code skills |
| `AGENTS.md` | Full project context for AI agents |
| `streamlit/` | Legacy Streamlit variant (kept for backwards compatibility) |
| `vars.yaml` | Database, warehouse, and warehouse_size config |
| `deploy.py` | Python wrapper for `snow sql -f` (reads `vars.yaml`) |
