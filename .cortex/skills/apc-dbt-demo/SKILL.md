---
name: apc-dbt-demo
description: "Run the AI Product Costing dbt-on-Snowflake pipeline: deploy the dbt project (dbt/apc) into Snowflake with snow dbt, build (seeds + Dynamic Tables + reconciliation tests), generate docs, and optionally schedule it. This is the PRIMARY pipeline that transforms raw SAP (APC_DEPLOY_DB.SAP_RAW) into the DBT_ANALYTICS marts the app reads. Runs in a Snowflake Workspace with Cortex Code. Triggers: dbt demo, run dbt demo, dbt on snowflake, deploy the dbt project, snow dbt, apc dbt, build the pipeline, EXECUTE DBT PROJECT, dbt tutorial, rebuild marts."
---

# APC — dbt-on-Snowflake Demo

Drives the **native dbt** pipeline in [`dbt/apc/`](../../../dbt/apc) end to end: deploy → build → test → docs → (schedule) → cleanup. It transforms **raw SAP extracts (`APC_DEPLOY_DB.SAP_RAW`)** through staging → intermediate → marts, all materialised as **Dynamic Tables** in `APC_DEPLOY_DB.DBT_ANALYTICS`. **These marts are what the app reads** — this is the production path, not a side demo. Built for a **Snowsight Workspace** with Cortex Code.

> Transforms genuinely messy raw SAP (posting line items in local currency, reversals, effective-dated standards, coded components, FX) into the costed model. **Reconciliation tests** prove the marts match the curated `ANALYTICS` views within ±0.05. The hand-written Dynamic Table demo in `APC_DEPLOY_DB.ENGINEERING` (`apc-data-engineering`) is a separate, optional SQL-authored alternative. Full narrative in `docs/dbt-raw-to-costed-lineage.md` + `docs/dbt-on-snowflake-tutorial.md`.
>
> Uses Snowflake-native dbt syntax (`snow dbt`, `EXECUTE DBT PROJECT`) — NOT local `dbt run`. In a Workspace omit `-c`; locally add `-c <your-connection>`.

**⚠️ How to run queries:** Use the `snowflake_sql_execute` tool, or `snow sql -q "..."` / `snow dbt`. **Do NOT run Python that calls `Session.builder...create()` or `snowflake.connector.connect()`** — in a Workspace / Streamlit-in-Snowflake that opens a second session and breaks the active connection. If Snowpark Python is genuinely required, reuse the session: `from snowflake.snowpark.context import get_active_session; session = get_active_session()`.

## Prerequisites (check first)
- Raw data present: `snow sql -q "SELECT COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.MATERIAL_LEDGER_DOC"` (>0). If it errors/0, run `sql/09_raw_sap.sql` + `sql/10_raw_sap_data.sql` (or `apc-deploy`) first.
- `snow dbt` available: `snow dbt --help` (Snowflake CLI with dbt support).

## Workflow

### Step 1 — Prompt for project variables

Auto-detect defaults from the active session, then **prompt the user** (using AskUserQuestion) to confirm or override each value:

1. Run: `snow sql -q "SELECT CURRENT_ACCOUNT() AS A, CURRENT_USER() AS U, CURRENT_ROLE() AS R, CURRENT_WAREHOUSE() AS W"`
2. Read `vars.yaml` for the database default.
3. Ask the user (single prompt with all fields, showing detected defaults):

| Variable | Default (auto-detected) | Used in |
|----------|------------------------|---------|
| **Database** | from `vars.yaml` → `APC_DEPLOY_DB` | `profiles.yml`, deploy target |
| **Warehouse** | from session → e.g. `APC_DEPLOY_WH` | `profiles.yml`, `dbt_project.yml` var |
| **Schema** | `DBT_ANALYTICS` | `profiles.yml`, deploy target |
| **Role** | from session → e.g. `ACCOUNTADMIN` | `profiles.yml` |
| **Account** | from session → e.g. `MYACCOUNT` | `profiles.yml` |
| **User** | from session → e.g. `YOUR_USER` | `profiles.yml` |

4. Write the confirmed values into `dbt/apc/profiles.yml` (overwrite the file).
5. If the warehouse differs from the `dbt_project.yml` default, update the `var('warehouse', '...')` default in `dbt_project.yml`.
6. If the database differs from `vars.yaml`, update `vars.yaml` too.

**Do not commit real account values to `main`** — keep this edit local, or on a `de/<summary>` feature branch (see `AGENTS.md` git discipline).

### Step 2 — Create the target schema
Using the database and schema confirmed in Step 1:
```bash
snow sql -q "CREATE SCHEMA IF NOT EXISTS <database>.<schema>"
```

### Step 2b — (Optional) External access integration
**Prompt the user:** "Does your dbt project need to call external endpoints (APIs, PyPI packages not in Snowflake's Anaconda channel)?"

If **yes**, invoke the `apc-external-integration` skill (or run inline):
1. Ask for: integration name (default `APC_EXTERNAL_ACCESS`), network rule name (default `APC_API_RULE`), allowed hosts (comma-separated `host:port`), database, schema.
2. Create the network rule and integration.
3. Pass the integration name to the deploy command below via `--external-access-integrations`.

If **no** (default for the stock APC project), skip — no external access needed.

### Step 3 — Deploy the project
```bash
# Without external access (default):
snow dbt deploy apc --source dbt/apc --database $DB --schema DBT_ANALYTICS

# With external access (if Step 2b was completed):
snow dbt deploy apc --source dbt/apc --database $DB --schema DBT_ANALYTICS \
  --external-access-integrations APC_EXTERNAL_ACCESS
```
Verify:
```bash
snow dbt list --in schema DBT_ANALYTICS --database APC_DEPLOY_DB
snow sql -q "SHOW VERSIONS IN DBT PROJECT APC_DEPLOY_DB.DBT_ANALYTICS.apc"
```

### Step 4 — Preview (optional, no objects created)
```bash
snow dbt execute --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc show --select mart_product_cost
```
> Connection flags (`-c`, `--database`, `--schema`) MUST come **before** the project name.

### Step 5 — Run the models
```bash
snow dbt execute --database $DB --schema DBT_ANALYTICS apc run
```
Verify output:
```bash
snow sql -q "SELECT * FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_PRODUCT_COST_MONTHLY ORDER BY PERIOD, MATERIAL_NUMBER LIMIT 15"
```

### Step 6 — Run the tests
```bash
snow dbt execute --database $DB --schema DBT_ANALYTICS apc test
```
(Or `apc build` to run + test together.)

### Step 7 — Generate docs / lineage
`docs generate` is NOT supported by `snow dbt execute` — use SQL:
```bash
snow sql -q "EXECUTE DBT PROJECT $DB.DBT_ANALYTICS.apc ARGS='docs generate'"
```

### Step 7b — Feature Store + Model Registry (REQUIRED for app)

After the dbt pipeline is built, run `feature_store.ipynb` to set up the ML Feature Store and register models. **This is REQUIRED** — the app's scenario forecast dropdowns (Sales Forecast + Smart Insights + Scenario Analysis) query `ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1"` directly.

Run the notebook in the workspace (requires container runtime with `snowflake-ml-python`), or execute inline:

```python
from snowflake.snowpark.context import get_active_session
from snowflake.ml.feature_store import FeatureStore, CreationMode, Entity, FeatureView

session = get_active_session()
session.sql("CREATE SCHEMA IF NOT EXISTS APC_DEPLOY_DB.ML_FEATURE_STORE").collect()

fs = FeatureStore(
    session=session,
    database="APC_DEPLOY_DB",
    name="ML_FEATURE_STORE",
    default_warehouse="APC_DEPLOY_WH",
    creation_mode=CreationMode.CREATE_IF_NOT_EXIST,
)

# Entities
material_entity = Entity(name="MATERIAL", join_keys=["MATERIAL_NUMBER"],
    desc="SAP material — join key for risk scores and forecasts")
fs.register_entity(material_entity)

cost_component_period_entity = Entity(name="COST_COMPONENT_PERIOD",
    join_keys=["COST_COMPONENT", "FISCAL_YEAR", "PERIOD"],
    desc="Cost component in a fiscal period — join key for anomaly detection")
fs.register_entity(cost_component_period_entity)
```

Then register the three feature views (see `feature_store.ipynb` for full SQL):
- **PRODUCT_RISK_FV** — variance slope, volatility, risk level per material
- **ANOMALY_DETECTION_FV** — statistical aggregates per component/period for Isolation Forest
- **VARIANCE_FORECAST_FV** — time-series features with `timestamp_col` for PIT-correct training

Generate versioned training datasets:
```python
# Example: generate anomaly training dataset
anomaly_spine_df = session.sql("SELECT DISTINCT COST_COMPONENT, FISCAL_YEAR, PERIOD FROM APC_DEPLOY_DB.ANALYTICS.COST_COMPONENT_DETAIL")
anomaly_ds = fs.generate_dataset(
    name="ANOMALY_TRAINING_DS", version="V1",
    spine_df=anomaly_spine_df, features=[registered_anomaly_fv],
    desc="Training dataset for Isolation Forest anomaly detection"
)
```

> Feature views materialise as Dynamic Tables (daily refresh). Training datasets are immutable snapshots — create new versions (V2, V3...) when retraining.
> Full notebook: `feature_store.ipynb` in the workspace root.

### Step 8 — (Optional) Schedule
```sql
CREATE OR REPLACE TASK APC_DEPLOY_DB.DBT_ANALYTICS.run_apc_daily
  WAREHOUSE = APC_DEPLOY_WH
  SCHEDULE = 'USING CRON 0 6 * * * UTC'
AS
EXECUTE DBT PROJECT APC_DEPLOY_DB.DBT_ANALYTICS.apc ARGS='build';
```
Remind the user the task starts SUSPENDED — `ALTER TASK ... RESUME` to activate.

## Iterating on the project
To change a model, edit the `.sql` in `dbt/apc/models/`, re-deploy (Step 3 — creates a new version), then `run`. If you change an **incremental** model's logic, you MUST `run --full-refresh`. Use a `de/<summary>` feature branch for committed changes (`main` is the template).

### Models & seeds (current)
- **Seeds (3):** `cost_component_map` (element→component, incl. **9 = Energy / Utilities**), `material_type_map`, `plant_energy_intensity` (plant→country→energy index→MWh/unit).
- **Staging:** `stg_ledger_postings`, `stg_material_master`, `stg_plant`, `stg_standard_price`, `stg_cost_components`, `stg_fx_rates`, `stg_sd_billing`, **`stg_energy_prices`** (sources `ENERGY_MARKET.ENERGY_PRICE_INDICES`).
- **Marts:** `mart_product_cost`, `mart_cost_budget`, `mart_cost_component_detail` (9 components), `mart_product_cost_monthly`, `mart_product_profitability`, `mart_cost_anomalies`, `mart_product_risk_scores`, `mart_variance_trend_with_forecast`, **`mart_energy_cost_bridge`** (energy price × plant intensity → energy $/unit — the external-index→costed-energy lineage).
- **Source swap-in:** to use real energy data, repoint the `energy_market` source (`sources.yml`) from the synthetic `ENERGY_MARKET.ENERGY_PRICE_INDICES` to the live LEBA `EOSE.*` Marketplace share — `stg_energy_prices` is unchanged.

### ⚠️ After reloading raw data — full-refresh is REQUIRED
If the raw/curated base tables are reloaded (re-running `sql/01/02/09/10/11`, which `CREATE OR REPLACE` them), the existing Dynamic Tables lose **incremental change-tracking**. A plain `apc build` then reports *"No configuration changes identified"* and **SKIPS** the unchanged-SQL marts → they serve **stale** data (classic symptom: `MART_COST_COMPONENT_DETAIL` shows 8 components, not 9). Always follow a reload with:
```bash
snow dbt execute --database $DB --schema DBT_ANALYTICS apc build --full-refresh
```
This `CREATE OR REPLACE`s every Dynamic Table on the new base tables. (Reconciliation tests can still PASS while a component mart is stale, because they compare totals, not per-component — so verify `COUNT(DISTINCT COST_COMPONENT) = 9` directly.)

## Stopping Points
- ✋ Step 1 — confirm profiles.yml identity before deploy
- ✋ Before Step 8 scheduling — confirm the user wants an automated task
- ✋ Before any cleanup/DROP

## Cleanup
```bash
snow sql -q "DROP DBT PROJECT IF EXISTS $DB.DBT_ANALYTICS.apc"
snow sql -q "DROP SCHEMA IF EXISTS $DB.DBT_ANALYTICS CASCADE"
```

## Output
The `apc` project deployed in `APC_DEPLOY_DB.DBT_ANALYTICS`, with staging / intermediate / mart layers materialised as **Dynamic Tables**, schema + **reconciliation tests** passing (parity with the curated `ANALYTICS` views), and docs generated — the raw-SAP → costed pipeline the app runs on.

## Troubleshooting
| Error | Fix |
|-------|-----|
| `Unsupported fields found: password` | Remove `password`/`authenticator` from `profiles.yml`. |
| `Env var required but not provided` | Replace any `env_var()` with literals in `profiles.yml`. |
| `command not supported` on docs | Use `EXECUTE DBT PROJECT ... ARGS='docs generate'` (plain string, not JSON array). |
| `APC_DEPLOY_DB.SAP_RAW ... does not exist` | Raw data not deployed — run `sql/09_raw_sap.sql` + `sql/10_raw_sap_data.sql` (or `apc-deploy`) first. |
| flags ignored / project-not-found | Put `-c/--database/--schema` BEFORE the project name. |
| `Change tracking not enabled / missing for the time range` on `ALTER DYNAMIC TABLE ... REFRESH`, or marts show stale data after a data reload | Base tables were recreated — run `apc build --full-refresh` to rebuild every DT on the new tables. |
| `ENERGY_MARKET ... does not exist` / `stg_energy_prices` empty | Run `sql/11_energy_market.sql` before the dbt build. |
