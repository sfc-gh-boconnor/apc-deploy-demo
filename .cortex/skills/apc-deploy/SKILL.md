---
name: apc-deploy
description: "Deploy the AI Product Costing accelerator to any Snowflake account. Sets up the raw SAP extract schema (SAP_RAW), the dbt medallion pipeline (DBT_ANALYTICS marts the app reads), analytics views, scenario analysis, profitability (CO-PA), ML predictions (Snowflake FORECAST), sales revenue/margin forecast, semantic model, and either the Next.js App Runtime app (snow CLI ≥ 3.19) or the Streamlit version (snow CLI < 3.19). Triggers: deploy product costing app, deploy APC, set up product costing demo, deploy to workshop account, rebuild APC accelerator."
---

# AI Product Costing Accelerator — Deploy Skill

Deploys the full AI Product Costing (APC) accelerator. **Two app deployment modes depending on snow CLI version** — check version first before deploying the app.

**App tabs (React):** Variance Analysis | Scenario Analysis | Profitability | **Sales Forecast** | Smart Insights | Ask Cortex AI | Data Engineering | Observability & Trust

> 🔗 **The app reads the dbt-engineered `APC_DEPLOY_DB.DBT_ANALYTICS` marts**, not the `ANALYTICS` views directly. You MUST deploy + build the dbt pipeline (Step 2b) before the app will show data.

> ⛔ **Connection guardrail (read before any step):** In a Snowsight Workspace, **never** open a new Snowflake connection from Python — no `snowflake.connector.connect(...)`, no `Session.builder...create()`. Doing so hijacks and **drops the active Workspace session**, breaking the deploy mid-flight (e.g. while uploading the semantic model). Run SQL with the `snowflake_sql_execute` tool or `snow sql`; when Python is required (the stage-upload workaround below), reuse the session via `from snowflake.snowpark.context import get_active_session; session = get_active_session()`.

## Prerequisites

- Active role: `ACCOUNTADMIN` (or equivalent with CREATE DATABASE, CREATE WAREHOUSE privileges)
- `snow` CLI must be available — the version determines which app to deploy

**Two deployment modes:**

| Mode | Environment | How it works |
|------|-------------|--------------|
| **Workspace** | Snowsight Workspace (AI_PRODUCT_COSTING) | Already authenticated via cloud agent, use relative paths. `snow` CLI is built-in. |
| **Local** | Local terminal with `snow` CLI | Requires a named connection (`-c <conn>`). Install via `pip install snowflake-cli`. |

---

## Deployment Workflow

### Step 0A — ⚠️ Check snow CLI availability and version (REQUIRED FIRST)

**Always run these first:**
```bash
which snow || echo "SNOW CLI NOT FOUND"
snow --version
```

**If `snow` is not found:**
- In a **Workspace**: This shouldn't happen — `snow` is built into Snowsight Workspaces via cloud agents. If missing, report as a bug.
- **Locally**: Install it with `pip install snowflake-cli` then retry.

**If `snow` is found, check the version number:**

| snow CLI version | App deployment method |
|---|---|
| **≥ 3.19** | Deploy the **React / App Runtime** app (`snow app deploy` from `app-ui/`) |
| **< 3.19** | Deploy the **Streamlit** app (`snow streamlit deploy` from `streamlit/`) |

**If version < 3.19**, ask the user:
> "Your snow CLI version is X.X.X which is below 3.19. The React/App Runtime deployment requires snow CLI ≥ 3.19. Would you like to deploy the Streamlit version instead? It has the core costing tabs and data, and works with any snow CLI version."

- If user says **yes** → follow **Step 5 (alt) — App Deployment: Streamlit** below
- If user says **no / they'll upgrade** → advise them to run `pip install snowflake-cli --upgrade` locally, then retry

### Step 0B — Read deployment variables

Before running any SQL, read `vars.yaml` to get the configured `database`, `warehouse`, and `warehouse_size`. These are the values used throughout all commands:

```bash
cat vars.yaml
```

All SQL scripts are Jinja2 templates. Use `python deploy.py` (which reads `vars.yaml` automatically) instead of `snow sql -f` directly. To override a value:
```bash
python deploy.py -D "database=MY_DB" -f sql/01_setup.sql
```

### Step 0C — Detect workspace vs local environment

Determine whether running in a **Workspace** or **Local** terminal:

- **Workspace:** No `-c` flag needed. Paths are relative to workspace root.
- **Local:** Requires `-c <connection>` on every `snow` command. Set repo root:
  ```bash
  REPO=$(pwd)  # or the path to your AI_PRODUCT_COSTING clone
  CONN=<connection_name>
  ```

### Step 1 — Verify session

**Workspace:**
```bash
snow sql -q "SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE()"
```

**Local:**
```bash
snow sql -c $CONN -q "SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE()"
```

### Step 2 — Run SQL setup scripts in order

**Workspace:**
```bash
python deploy.py -f sql/01_setup.sql
python deploy.py -f sql/02_synthetic_data.sql
python deploy.py -f sql/03_analytics.sql
python deploy.py -f sql/04_scenarios.sql
python deploy.py -f sql/05_profitability.sql
python deploy.py -f sql/09_raw_sap.sql
python deploy.py -f sql/10_raw_sap_data.sql
python deploy.py -f sql/11_energy_market.sql
```
> `06_ml_insights.sql` and `12_sales_forecast.sql` are **legacy** — replaced by the Feature Store notebook (`feature_store.ipynb`) which trains and registers models in the Model Registry. The old SQL scripts still work if you want the `SNOWFLAKE.ML.FORECAST` procedural path, but the app now reads from Feature Store views and registered models.
> `07_period_data.sql` is a **retired no-op** — skip it. `08_data_engineering.sql` is the **optional** hand-written Dynamic Table demo (`APC_DEPLOY_DB.ENGINEERING`) — not required by the app.
> `11_energy_market.sql` loads the LEBA-shaped energy price feed (`APC_DEPLOY_DB.ENERGY_MARKET.ENERGY_PRICE_INDICES`) that drives the **Energy / Utilities** cost component and the dbt energy bridge — **required**, and must run **before** the dbt build (Step 2b) since `stg_energy_prices` sources it.

**Local:**
```bash
python deploy.py -c $CONN -f $REPO/sql/01_setup.sql
python deploy.py -c $CONN -f $REPO/sql/02_synthetic_data.sql
python deploy.py -c $CONN -f $REPO/sql/03_analytics.sql
python deploy.py -c $CONN -f $REPO/sql/04_scenarios.sql
python deploy.py -c $CONN -f $REPO/sql/05_profitability.sql
python deploy.py -c $CONN -f $REPO/sql/09_raw_sap.sql
python deploy.py -c $CONN -f $REPO/sql/10_raw_sap_data.sql
python deploy.py -c $CONN -f $REPO/sql/11_energy_market.sql
```

> **Regenerating the synthetic data (optional):** the committed `sql/02`, `sql/10`, `sql/11` already contain the data. To regenerate from scratch: `python app/generate_data.py > sql/02_synthetic_data.sql` (curated), `python app/generate_raw_data.py > sql/10_raw_sap_data.sql` (raw — imports `generate_data`), `python app/generate_energy_data.py > sql/11_energy_market.sql` (LEBA-shaped energy — imports `generate_data`). All three share `generate_data`'s deterministic series so they reconcile.

**Expected outputs:**
| Script | Creates |
|--------|---------|
| `01_setup.sql` | `APC_DEPLOY_DB`, schemas (`SAP_BDC`, `SAP_RAW`, `ANALYTICS`), `APC_DEPLOY_WH`, `APC_DEPLOY_STAGE`, `APC_RAW_TEXT_FF`, `COST_BUDGET` table |
| `02_synthetic_data.sql` | RX-#### compounds × 5 sites × **FY2024+FY2025 monthly + FY2026 H1** (incl. `COST_BUDGET` = prior-year actual, annual standard reset). **9 cost components** incl. index-driven **Energy / Utilities** |
| `03_analytics.sql` | `PRODUCT_COST_SUMMARY` (3-way Actual/Budget/Standard) + `COST_COMPONENT_DETAIL` views |
| `04_scenarios.sql` | `SCENARIO_INPUTS` table (4 presets: Base, API Cost Shock +20%, Volume Drop 0.7×, **Energy Spike +40%**) + `SCENARIO_RESULTS` view (incl. `ENERGY_COST_CHANGE_PCT`) |
| `05_profitability.sql` | `SD_BILLING` table + `PRODUCT_PROFITABILITY` view (CO-PA) |
| `06_ml_insights.sql` | `SNOWFLAKE.ML.FORECAST` (monthly) + **backtest** (`FORECAST_ACCURACY`, `FORECAST_BACKTEST_DETAIL`), `PRODUCT_RISK_SCORES`, `COST_ANOMALIES` |
| `12_sales_forecast.sql` | `SALES_REVENUE_FORECAST_MODEL` + `SALES_VOLUME_FORECAST_MODEL` (ML.FORECAST on SD_BILLING, 9-month horizon) + `MARGIN_FORECAST_BRIDGE` + `MARGIN_COMPRESSION_SUMMARY` views |
| `09_raw_sap.sql` | `APC_DEPLOY_DB.SAP_RAW` raw-extract schema (messy: posting line items, local currency, eff-dated MBEW, coded KEPH incl. **element 9 = Energy / Utilities**, TCURR FX) |
| `10_raw_sap_data.sql` | Raw SAP extract data (≈50k rows; generated by `app/generate_raw_data.py`; reconciles to curated) |
| `11_energy_market.sql` | `APC_DEPLOY_DB.ENERGY_MARKET.ENERGY_PRICE_INDICES` — LEBA-shaped synthetic energy price feed (5 markets × 30 months). Mirrors the real `EOSE.*` Marketplace listings; swap the dbt `stg_energy_prices` source to the live share to use real data. |

### Step 2b — Deploy + build the dbt pipeline (REQUIRED — the app reads `DBT_ANALYTICS`)

The app's API routes read `APC_DEPLOY_DB.DBT_ANALYTICS` marts, so the dbt pipeline must be deployed and built before the app shows data. Fill `dbt/apc/profiles.yml` identity from the session, then:
```bash
# Get database from vars.yaml (or pass -D "database=MY_DB" to override)
DB=$(python -c "import yaml; print(yaml.safe_load(open('vars.yaml'))['database'])")
snow sql [-c $CONN] -q "CREATE SCHEMA IF NOT EXISTS $DB.DBT_ANALYTICS"
snow dbt deploy apc --source dbt/apc --database $DB --schema DBT_ANALYTICS [-c $CONN]
snow dbt execute [-c $CONN] --database $DB --schema DBT_ANALYTICS apc build   # seeds + Dynamic Tables + tests
```
> See `apc-dbt-demo` for the full dbt workflow (profiles identity, docs, schedule, reconciliation tests). `build` should report all tests passing, incl. the reconciliation tests vs the curated views.
> **3 seeds** load automatically: `cost_component_map` (element→component, incl. **9 = Energy / Utilities**), `material_type_map`, `plant_energy_intensity` (plant→country→energy index→MWh/unit — feeds `mart_energy_cost_bridge`, the external-index→costed-energy lineage). New energy models: `stg_energy_prices`, `mart_energy_cost_bridge`.
> ⚠️ **Fresh install: `build` is enough.** But if you later **re-run `09`/`10`/`11`** to reload raw data on an existing account, the recreated base tables **break the Dynamic Tables' incremental change-tracking** — a plain `build` then SKIPS unchanged-SQL marts and serves **stale** data (e.g. 8 cost components instead of 9). Recover with **`apc build --full-refresh`** (recreates every DT on the new base tables).

### Step 2c — Feature Store + Model Registry (ML pipeline — REQUIRED)

After the dbt build, run `feature_store.ipynb` (requires container runtime with `snowflake-ml-python`) to set up:
- Schema: `APC_DEPLOY_DB.ML_FEATURE_STORE`
- Entities: `MATERIAL`, `COST_COMPONENT_PERIOD`
- Feature Views (Dynamic Tables, daily refresh): `PRODUCT_RISK_FV`, `ANOMALY_DETECTION_FV`, `VARIANCE_FORECAST_FV`
- Training Datasets (immutable, versioned): `ANOMALY_TRAINING_DS`, `RISK_SCORING_DS`, `FORECAST_TRAINING_DS`
- Registered Models: `APC_ANOMALY_DETECTOR` (Isolation Forest), `APC_RISK_CLASSIFIER` (Gradient Boosting), `COST_VARIANCE_FORECAST_MODEL` (XGBoost), `SALES_REVENUE_FORECAST_MODEL` (XGBoost)

**This step is REQUIRED** — the app's Smart Insights, Scenario Analysis, and Sales Forecast tabs read from `ML_FEATURE_STORE."VARIANCE_FORECAST_FV$V1"` and `"PRODUCT_RISK_FV$V1"`. Without the Feature Store, the scenario forecast dropdowns and ML insights will fail.

> `sql/06_ml_insights.sql` and `sql/12_sales_forecast.sql` are legacy — they still populate the `ANALYTICS.PRODUCT_RISK_SCORES` and `ANALYTICS.VARIANCE_FORECAST` tables, but the app no longer reads from them for risk scores or scenario forecasting.

### Step 3 — Upload semantic model to stage

**Workspace (COPY FILES from workspace stage — preferred):**

Workspace files are accessible via `snow://workspace/` URIs. Use `COPY FILES` to copy directly to any internal stage — no S3 upload, no base64 encoding, no temp tables:

```sql
COPY FILES
  INTO @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/
  FROM 'snow://workspace/USER$<USERNAME>.PUBLIC."<WORKSPACE_NAME>"/versions/live/APC_SV.yaml';
```

> Replace `<USERNAME>` and `<WORKSPACE_NAME>` with actual values. Find them via:
> ```sql
> DESCRIBE WORKSPACE "<workspace_name>";  -- shows live_version_location_uri
> ```

> ⚠️ **Important:** The semantic model YAML uses `{{ database }}` Jinja placeholders. Before uploading, render them:
> ```python
> content = open('APC_SV.yaml').read().replace('{{ database }}', 'APC_DEPLOY_DB')
> open('APC_SV.yaml', 'w').write(content)  # write rendered version back
> ```
> Then run the COPY FILES command above.

**Local:**
```bash
snow sql -c $CONN -q "PUT file://$REPO/APC_SV.yaml @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE"
```

Verify:
```bash
snow sql -q "LIST @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE"
```

### Step 4 — Verify snowflake.yml is correctly configured

Check `app-ui/snowflake.yml` contains:
```yaml
definition_version: "2"
entities:
  AI_PRODUCT_COSTING:
    type: snowflake-app
    identifier:
      name: AI_PRODUCT_COSTING
      database: APC_DEPLOY_DB
      schema: ANALYTICS
    query_warehouse: APC_DEPLOY_WH
    build_compute_pool:
      name: SYSTEM_COMPUTE_POOL_CPU
    service_compute_pool:
      name: SYSTEM_COMPUTE_POOL_CPU
```

**Critical:** `database` must match `vars.yaml` (default `APC_DEPLOY_DB`) and `schema` must be `ANALYTICS`. Never use a personal database (`USER$...`).

### Step 5 — App Deployment: React / App Runtime (snow CLI ≥ 3.19)

**Workspace (COPY FILES + build + deploy):**

Since `snow app deploy` can't upload to S3 from a Workspace, use `COPY FILES` from the workspace stage to get files onto the app code stage, then trigger build and deploy separately:

```sql
-- 1. Create the app code stage (if it doesn't exist)
CREATE STAGE IF NOT EXISTS APC_DEPLOY_DB.ANALYTICS.AI_PRODUCT_COSTING_CODE;

-- 2. Copy all app-ui files from workspace to the code stage
COPY FILES
  INTO @APC_DEPLOY_DB.ANALYTICS.AI_PRODUCT_COSTING_CODE/
  FROM 'snow://workspace/USER$<USERNAME>.PUBLIC."<WORKSPACE_NAME>"/versions/live/app-ui/';
```

Then trigger the build and deploy phases (upload is already done):
```bash
cd app-ui && snow app deploy --build-only
cd app-ui && snow app deploy --deploy-only
```

**Local:**
```bash
cd $REPO/app-ui && snow app deploy -c $CONN
```

This uploads all source files, builds the Next.js app in Snowflake, and starts the App Runtime service.

Monitor build progress:
```bash
snow app events --last 50
```

### Step 5 (alt) — App Deployment: Streamlit (snow CLI < 3.19)

Use this path when snow CLI version is below 3.19.

**Check for EAI (needed for pyproject.toml):**
```bash
snow sql -q "SHOW EXTERNAL ACCESS INTEGRATIONS" | grep -i pypi
```
If none found:
```bash
snow sql -q "CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION PYPI_ACCESS_INTEGRATION ALLOWED_NETWORK_RULES = (snowflake.external_access.pypi_rule) ENABLED = true"
```

**Deploy:**

**Local:**
```bash
cd $REPO/streamlit && snow streamlit deploy apc_deploy_streamlit -c $CONN --replace
```

**Workspace (COPY FILES from workspace stage — preferred):**

Use `COPY FILES` to copy Streamlit files from the workspace directly to the deploy stage:

```sql
COPY FILES
  INTO @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/streamlit/
  FROM 'snow://workspace/USER$<USERNAME>.PUBLIC."<WORKSPACE_NAME>"/versions/live/streamlit/';
```

Then create the Streamlit object:
```bash
snow sql -f sql/12_streamlit.sql
```

This creates the container Streamlit and sets its live version. The SQL (`sql/12_streamlit.sql`) contains:
```sql
DROP STREAMLIT IF EXISTS APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STREAMLIT;

CREATE STREAMLIT APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STREAMLIT
  FROM '@APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/streamlit'
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = APC_DEPLOY_WH
  COMPUTE_POOL = SYSTEM_COMPUTE_POOL_CPU
  RUNTIME_NAME = 'SYSTEM$ST_CONTAINER_RUNTIME_PY3_11'
  EXTERNAL_ACCESS_INTEGRATIONS = (PYPI_ACCESS_INTEGRATION)
  COMMENT = 'AI Product Costing Accelerator — Streamlit dashboard';

-- CRITICAL: Set the live version — without this the app shows "Not implemented" bootstrap error.
ALTER STREAMLIT APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STREAMLIT ADD LIVE VERSION FROM LAST;
```

> ⚠️ **Key differences from legacy syntax:**
> - Uses `FROM '@stage/path'` — NOT `ROOT_LOCATION` (deprecated)
> - Requires `COMPUTE_POOL` + `RUNTIME_NAME` for container Streamlit
> - **MUST** run `ALTER STREAMLIT ... ADD LIVE VERSION FROM LAST` after creation — without this the app has no live version and fails with "Not implemented" bootstrap error

Streamlit app is then available at:
`Snowsight → Projects → Streamlit → APC_DEPLOY_STREAMLIT`

**Streamlit snowflake.yml** (`streamlit/snowflake.yml`):
```yaml
definition_version: "2"
entities:
  apc_deploy_streamlit:
    type: streamlit
    identifier:
      name: APC_DEPLOY_STREAMLIT
      database: APC_DEPLOY_DB
      schema: ANALYTICS
    query_warehouse: APC_DEPLOY_WH
    runtime_name: SYSTEM$ST_CONTAINER_RUNTIME_PY3_11
    compute_pool: SYSTEM_COMPUTE_POOL_CPU
    external_access_integrations:
      - PYPI_ACCESS_INTEGRATION
    main_file: streamlit_app.py
    artifacts:
      - streamlit_app.py
      - pyproject.toml
      - .streamlit/config.toml
```

### Step 6 — Get the URL

**React / App Runtime:**
```bash
snow app open --print-only
```
Or check Snowsight → Apps → AI_PRODUCT_COSTING.

**Streamlit:**
Snowsight → Projects → Streamlit → APC_DEPLOY_STREAMLIT

---

## What Gets Deployed

| Layer | Component | Details |
|-------|-----------|---------|
| **Database** | `APC_DEPLOY_DB.SAP_BDC` | 8 curated SAP BDC tables with real SAP field names (MATNR, WERKS, STPRS, PVPRS, POPER, GJAHR etc.): 7 from `01` (PLANT_MASTER, MATERIAL_MASTER, MATERIAL_VALUATION, COSTING_HEADER, COST_COMPONENT_SPLIT, MATERIAL_LEDGER, COST_BUDGET) + SD_BILLING from `05` |
| **Data** | Synthetic SAP | RX-#### pharma compounds, 5 sites (Macclesfield, Sodertälje, Dunboyne, Mount Vernon, Bangalore), FY2024+FY2025 monthly + FY2026 H1 (curated) + raw extracts in `SAP_RAW` |
| **Analytics** | `PRODUCT_COST_SUMMARY` | Standard vs actual cost variance by material/plant/period |
| **Analytics** | `COST_COMPONENT_DETAIL` | Cost breakdown by component (API, excipients, packaging, labour, overhead) |
| **Scenarios** | `SCENARIO_INPUTS` | 4 pre-seeded what-if scenarios: Base, API Cost Shock (+20%), Volume Drop (0.7×), **Energy Spike (+40%)**. Cards support **Reset-to-default** + **Revert**. |
| **Energy** | `ENERGY_MARKET.ENERGY_PRICE_INDICES` | LEBA-shaped synthetic energy price feed driving the **Energy / Utilities** cost component; swap `stg_energy_prices` to the real `EOSE.*` Marketplace share for live data |
| **Sales Forecast** | `SALES_REVENUE_FORECAST_MODEL` + `SALES_VOLUME_FORECAST_MODEL` | H2 FY2026 revenue + volume ML forecast; `MARGIN_FORECAST_BRIDGE` joins against cost forecast to show gross margin compression per product |
| **Profitability** | `PRODUCT_PROFITABILITY` | CO-PA style view: revenue + COGS + gross margin by product/market |
| **Profitability** | `SD_BILLING` | 120 synthetic SD billing rows (10 products x 4 markets x 3 periods) |
| **AI** | `@APC_DEPLOY_STAGE/APC_SV.yaml` | Semantic model for Cortex AI chat tab — covers PRODUCT_COST_SUMMARY, COST_COMPONENT_DETAIL, and PRODUCT_PROFITABILITY (margin metrics) |
| **App** | App Runtime (Next.js) | multi-tab dashboard (grouped **Live Demo**) reading `DBT_ANALYTICS` marts, deployed via `snow app deploy` — no Docker |

---

## Modifying the Semantic View (`APC_SV.yaml`)

The semantic view powers the **Ask Cortex AI** tab. To add tables, columns, metrics, or dimensions:

1. **Edit `APC_SV.yaml`** in the workspace root. The file structure is:
   - `tables:` — base tables the model can query (with primary keys)
   - `relationships:` — join paths between tables
   - `metrics:` — aggregate expressions (SUM, AVG, COUNT_IF etc.)
   - `dimensions:` — grouping/filter columns
   - `verified_queries:` — example Q&A pairs for grounding

2. **Re-upload to stage** (workspace — use COPY FILES from workspace stage):
```sql
COPY FILES
  INTO @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/
  FROM 'snow://workspace/USER$<USERNAME>.PUBLIC."<WORKSPACE_NAME>"/versions/live/APC_SV.yaml';
```

   Or **locally**: `snow sql -c $CONN -q "PUT file://$REPO/APC_SV.yaml @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE"`

3. **Verify**: `LIST @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE` — check `APC_SV.yaml` size/timestamp updated.

> The semantic view currently includes: `PRODUCT_COST_SUMMARY` (cost variance), `COST_COMPONENT_DETAIL` (component breakdown), and `PRODUCT_PROFITABILITY` (margin metrics — revenue, COGS, gross margin, margin variance).

---

## App Tabs

| Tab | What it shows |
|-----|---------------|
| **Overview** | SAP BDC architecture flow, KPI cards, Before vs After comparison table |
| **Variance Analysis** | Top 10 variance products, trend chart, cost component drill-down, detail table |
| **Scenario Analysis** | Interactive what-if sliders (API cost, labour, volume, FX, **energy price**), grouped bar chart comparing Base / API Shock / Volume Drop / **Energy Spike**, impact table. Each card has **Reset-to-default** + **Revert** controls. |
| **Profitability** | Revenue + gross margin by product and market, Budget vs Actual COGS impact on margin, CO-PA detail table |
| **Sales Forecast** | H2 FY2026 revenue + volume ML forecast, gross margin compression chart (cost-driven), product impact table ranked by margin at risk |
| **Smart Insights** | ML forecast trend, anomaly detection, product risk scores |
| **Ask Cortex AI** | Natural language Q&A over live SAP cost data via `SNOWFLAKE.CORTEX.COMPLETE` |
| **Data Engineering** | Raw-SAP → dbt medallion lineage (staging → intermediate → mart Dynamic Tables), reconciliation parity vs curated views |
| **Observability & Trust** | Dynamic-Table freshness / refresh health, data-quality & reconciliation trust signals, lineage |
| **Business Value** | ROI / value narrative — TCV & fully-ramped ACV story |
| **Cost Estimate** | Interactive Snowflake run-cost & 3-Year TCV calculator |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Stages cannot be created in a personal database` | `snowflake.yml` has wrong database — set `database: APC_DEPLOY_DB`, `schema: ANALYTICS` |
| `Missing warehouse` on `snow app setup` | Pass `--warehouse APC_DEPLOY_WH` |
| `APC_DEPLOY_DB does not exist or not authorized` | Run `sql/01_setup.sql` first |
| Build stuck on `PENDING` or `RUNNING` | Normal — first build takes 3-5 min. Run `snow app events --last 50` |
| Chat tab returns error | Check `APC_SV.yaml` is on stage: `LIST @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE` |
| `Extra inputs are not permitted` for `service_external_access_integrations` | Remove that field from `snowflake.yml` — it is not supported by App Runtime |
| Cortex AI chat unavailable | `SNOWFLAKE.CORTEX.COMPLETE` requires Cortex AI to be enabled on the account — check with `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-sonnet-4-5', 'test')` |
| PUT returns 403 Forbidden (workspace) | Use `COPY FILES INTO @stage/ FROM 'snow://workspace/...'` instead — workspace files are accessible via `snow://workspace/` URIs without S3 uploads. |
| `pyproject.toml` parse error (unexpected key) | File was uploaded with default CSV format which adds escape chars — re-upload using `FORMAT_NAME = 'APC_DEPLOY_DB.ANALYTICS.APC_RAW_TEXT_FF'` |
| `get_active_session()` fails with "No default Session" | Do NOT use Snowpark session in Cortex Code sandbox — use `snowflake_sql_execute` tool or `snow sql` commands instead |
| Streamlit "Not implemented" bootstrap error (workspace deploy) | `CREATE STREAMLIT ... FROM '@stage'` does NOT set a live version. Run `ALTER STREAMLIT APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STREAMLIT ADD LIVE VERSION FROM LAST` after creation. The `snow streamlit deploy` CLI does this automatically. |

---

## Re-deploying after code changes

**React / App Runtime (snow CLI ≥ 3.19):**

*Workspace:*
```sql
-- Re-copy updated files from workspace to app code stage
COPY FILES
  INTO @APC_DEPLOY_DB.ANALYTICS.AI_PRODUCT_COSTING_CODE/
  FROM 'snow://workspace/USER$<USERNAME>.PUBLIC."<WORKSPACE_NAME>"/versions/live/app-ui/';
```
```bash
cd app-ui && snow app deploy --build-only
cd app-ui && snow app deploy --deploy-only
```

*Local:*
```bash
cd $REPO/app-ui && snow app deploy -c $CONN
```

**Streamlit (snow CLI < 3.19):**

*Workspace:*
```sql
COPY FILES
  INTO @APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_STAGE/streamlit/
  FROM 'snow://workspace/USER$<USERNAME>.PUBLIC."<WORKSPACE_NAME>"/versions/live/streamlit/';
```
```bash
snow sql -f sql/12_streamlit.sql
```

*Local:*
```bash
cd $REPO/streamlit && snow streamlit deploy apc_deploy_streamlit -c $CONN --replace
```

Changes to SQL objects require re-running the relevant `.sql` file manually first.

> ⚠️ **Reloading raw/curated data on an existing account:** after re-running `01`/`02`/`09`/`10`/`11` (which `CREATE OR REPLACE` the base tables), the dbt Dynamic Tables lose incremental change-tracking. Always follow a data reload with **`snow dbt execute [-c $CONN] --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc build --full-refresh`**, otherwise the marts serve stale data. Also re-run `sql/04_scenarios.sql` to reset the scenario presets if the live app has edited them.
