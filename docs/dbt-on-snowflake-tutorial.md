# Tutorial: dbt Projects on Snowflake (native `snow dbt`)

A hands-on walkthrough of running a **dbt project deployed as a Snowflake object** — using `snow dbt deploy` and `EXECUTE DBT PROJECT`, not local `dbt run`. The project lives in [`dbt/apc/`](../dbt/apc) and is the **primary pipeline** that transforms genuinely **raw SAP extracts** (`APC_DEPLOY_DB.SAP_RAW`) into the costing marts (Dynamic Tables) in `APC_DEPLOY_DB.DBT_ANALYTICS` that the app reads.

> **Native dbt vs local dbt:** Here dbt runs *inside Snowflake*. You deploy the project once, then execute it with the `snow` CLI or SQL. No local warehouse credentials, no `dbt-core` install needed to run it — Snowflake does the work.

You can run every step yourself, or just invoke the **`apc-dbt-demo`** skill in a Workspace and let Cortex Code drive it.

## What the project builds

```
APC_DEPLOY_DB.SAP_RAW (raw extracts)        →  APC_DEPLOY_DB.DBT_ANALYTICS (Dynamic Tables)
  MATERIAL_LEDGER_DOC (line items),     staging:  stg_ledger_postings, stg_standard_price,
  MBEW_RAW, KEPH_RAW, MARA_RAW,                   stg_cost_components, stg_material_master,
  T001W_RAW, TCURR_RAW (FX)                        stg_plant, stg_fx_rates
                                        intermediate: int_period_actuals (aggregate+FX),
                                                   int_standard_by_period, int_cost_components, int_budget
                                        marts:   mart_product_cost (Actual/Budget/Standard),
                                                   mart_cost_budget, mart_cost_component_detail,
                                                   mart_product_profitability, mart_cost_anomalies,
                                                   mart_product_risk_scores,
                                                   mart_variance_trend_with_forecast, mart_product_cost_monthly
```

Plus dbt **tests**: `not_null`, `unique`, `accepted_values`, `relationships`, and **reconciliation** singular tests proving the marts match the curated `ANALYTICS` views within ±0.05 (FX round-trip tolerance).

## Project structure

```
dbt/apc/
├── dbt_project.yml          # project config; ALL layers materialised as Dynamic Tables (target_lag)
├── profiles.yml             # native-dbt profile (NO password / NO env_var)
├── seeds/                   # cost_component_map, material_type_map (code -> label decode)
└── models/
    ├── sources.yml          # declares APC_DEPLOY_DB.SAP_RAW (+ SAP_BDC.SD_BILLING) source tables
    ├── staging/             # stg_* : clean, conform, FX decode, dedupe
    ├── intermediate/        # int_* : aggregate postings, FX->USD, eff-dated standard, budget
    └── marts/               # mart_* : analysis-ready (mirror the curated view columns)
        └── _marts.yml       # tests
    tests/                   # reconciliation singular tests vs ANALYTICS views
```

## Prerequisites

- The APC accelerator is deployed and `APC_DEPLOY_DB.SAP_RAW` is populated (run `sql/09_raw_sap.sql` + `sql/10_raw_sap_data.sql`, or the `apc-deploy` skill, if not).
- `snow` CLI available. In a Snowsight Workspace it's built in (omit `-c`); locally add `-c <your-connection>`.
- Role with privileges on `APC_DEPLOY_DB` and usage on `APC_DEPLOY_WH`.

## Step 1 — Set the profile identity

`dbt/apc/profiles.yml` ships with placeholder `account` / `user` / `role`. Native dbt forbids `password`, `authenticator`, and `env_var()`. Fill the placeholders from your session (the `apc-dbt-demo` skill does this automatically):

```bash
snow sql -q "SELECT CURRENT_ACCOUNT() AS A, CURRENT_USER() AS U, CURRENT_ROLE() AS R"
```
Replace `<YOUR_ACCOUNT>`, `<YOUR_USER>`, `<YOUR_ROLE>` in `profiles.yml`. Do **not** commit real values to the `main` template (keep the edit local or on a feature branch).

## Step 2 — Create the target schema

```bash
snow sql -q "CREATE SCHEMA IF NOT EXISTS APC_DEPLOY_DB.DBT_ANALYTICS"
```

## Step 3 — Deploy the project to Snowflake

```bash
snow dbt deploy apc --source dbt/apc --database APC_DEPLOY_DB --schema DBT_ANALYTICS
```
No `--external-access-integration` is needed (no external packages). Re-running the same command after edits creates a new version (`VERSION$2`, …).

Verify:
```bash
snow dbt list --in schema DBT_ANALYTICS --database APC_DEPLOY_DB
snow sql -q "SHOW VERSIONS IN DBT PROJECT APC_DEPLOY_DB.DBT_ANALYTICS.apc"
```

## Step 4 — Preview a model (no objects created)

`show` previews output without materialising:
```bash
snow dbt execute -c <conn> --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc show --select mart_product_cost
```
(In a Workspace, drop `-c <conn>`.)

## Step 5 — Run the models (materialise)

```bash
snow dbt execute -c <conn> --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc run
```
This creates the staging, intermediate and mart **Dynamic Tables** in `APC_DEPLOY_DB.DBT_ANALYTICS`. Check:
```bash
snow sql -q "SELECT * FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_PRODUCT_COST_MONTHLY ORDER BY PERIOD, MATERIAL_NUMBER LIMIT 15"
```

## Step 6 — Run the tests

```bash
snow dbt execute -c <conn> --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc test
```
`build` does run + test + seed + snapshot in dependency order if you prefer one command.

## Step 7 — Generate documentation / lineage

`docs generate` is **not** supported by `snow dbt execute`; use SQL:
```bash
snow sql -q "EXECUTE DBT PROJECT APC_DEPLOY_DB.DBT_ANALYTICS.apc ARGS='docs generate'"
```

## Step 8 — (Optional) Schedule it

```sql
CREATE OR REPLACE TASK APC_DEPLOY_DB.DBT_ANALYTICS.run_apc_daily
  WAREHOUSE = APC_DEPLOY_WH
  SCHEDULE = 'USING CRON 0 6 * * * UTC'
AS
EXECUTE DBT PROJECT APC_DEPLOY_DB.DBT_ANALYTICS.apc ARGS='build';
-- ALTER TASK ... RESUME to activate.
```

## Cleanup

```bash
snow sql -q "DROP DBT PROJECT IF EXISTS APC_DEPLOY_DB.DBT_ANALYTICS.apc"
snow sql -q "DROP SCHEMA IF EXISTS APC_DEPLOY_DB.DBT_ANALYTICS CASCADE"
```
(The `apc-cleanup` skill's `DROP DATABASE APC_DEPLOY_DB CASCADE` removes all of this too.)

## dbt-on-Snowflake vs the Dynamic Table layer

This accelerator shows two transformation styles over the same raw data:

| Approach | Where | Refresh | Role |
|----------|-------|---------|------|
| **dbt project** (this tutorial) | `APC_DEPLOY_DB.DBT_ANALYTICS` | Dynamic Tables on `TARGET_LAG`, auto | **Primary** — the marts the app reads; tests, docs, lineage, version control |
| **Hand-written Dynamic Tables** (`apc-data-engineering`) | `APC_DEPLOY_DB.ENGINEERING` | Declarative `TARGET_LAG`, automatic | Optional SQL-authored demo of the same medallion pattern (no dbt) |

Both materialise as Dynamic Tables; the dbt path adds testing/lineage/version control and is what the app runs on. The `apc-dbt-demo` skill drives the dbt path end to end.
