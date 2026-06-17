---
name: apc-cleanup
description: "Remove the AI Product Costing accelerator — drops the app, database, warehouse, and all associated objects. Use to fully clean up the APC demo from an account. Triggers: clean up APC, remove product costing, tear down APC, delete APC, uninstall product costing, drop APC."
---

# AI Product Costing Accelerator — Cleanup Skill

Removes all APC objects from the account. **This is destructive and irreversible.**

## Before running

**Read `vars.yaml` first** to get the configured database and warehouse names:
```bash
cat vars.yaml
# Sets: database (default APC_DEPLOY_DB), warehouse (default APC_DEPLOY_WH)
```
Use these values in all commands below. Override at any time with `-D "database=MY_DB"`.

⚠️ **Always confirm with the user before executing any DROP commands.**

Ask: "This will permanently remove the AI Product Costing app, database (APC_DEPLOY_DB), warehouse (APC_DEPLOY_WH), and all data. Are you sure you want to proceed?"

- If user says **yes** → proceed with cleanup
- If user says **no** → abort

---

## Cleanup Workflow

### Step 0 — Check snow CLI and environment

```bash
which snow || echo "SNOW CLI NOT FOUND"
snow --version
```

Determine workspace vs local (same rules as apc-deploy):
- **Workspace:** No `-c` flag needed
- **Local:** Requires `-c <connection>` on every `snow` command

### Step 1 — Tear down App Runtime app (if snow CLI ≥ 3.19)

**Check if the app exists first:**
```sql
SHOW STAGES LIKE 'AI_PRODUCT_COSTING%' IN SCHEMA APC_DEPLOY_DB.ANALYTICS;
```

If stages `AI_PRODUCT_COSTING_CODE` and/or `AI_PRODUCT_COSTING_REPO` exist, the React app was deployed.

**Workspace:**
```bash
cd app-ui && snow app teardown --force --cascade
```

**Local:**
```bash
cd $REPO/app-ui && snow app teardown -c $CONN --force --cascade
```

### Step 2 — Remove Streamlit app (if deployed)

```sql
DROP STREAMLIT IF EXISTS <database>.ANALYTICS.APC_DEPLOY_STREAMLIT;
```

### Step 3 — Drop the ML models + dbt project (optional; `DROP DATABASE ... CASCADE` also removes these)

```sql
DROP SNOWFLAKE.ML.FORECAST IF EXISTS <database>.ANALYTICS.VARIANCE_FORECAST_MODEL;
DROP SNOWFLAKE.ML.FORECAST IF EXISTS <database>.ANALYTICS.VARIANCE_BACKTEST_MODEL;
DROP DBT PROJECT IF EXISTS <database>.DBT_ANALYTICS.apc;
```

### Step 4 — Drop the database (removes all schemas, tables, views, stages)

```sql
DROP DATABASE IF EXISTS <database> CASCADE;
```

This single command removes everything in `<database>`:
- All schemas (`SAP_BDC`, `SAP_RAW`, `ANALYTICS`, `DBT_ANALYTICS`, `ENGINEERING`)
- The **raw SAP extract** tables (`SAP_RAW.MATERIAL_LEDGER_DOC`, `MBEW_RAW`, `KEPH_RAW`, `MARA_RAW`, `T001W_RAW`, `TCURR_RAW`) + curated SAP tables + `COST_BUDGET`
- The **dbt project** object (`DBT_ANALYTICS.apc`) and all its **Dynamic Table marts** (`MART_*`) + seeds
- The optional `ENGINEERING` Dynamic Tables
- All `ANALYTICS` views, the `FORECAST`/backtest models, `SCENARIO_*`
- All stages (`APC_DEPLOY_STAGE`, `AI_PRODUCT_COSTING_CODE`, `AI_PRODUCT_COSTING_REPO`)

### Step 5 — Drop the warehouse

```sql
DROP WAREHOUSE IF EXISTS <warehouse>;
```

### Step 6 — Verify cleanup

```sql
SHOW DATABASES LIKE '<database>';
SHOW WAREHOUSES LIKE '<warehouse>';
SHOW APPLICATIONS LIKE '%PRODUCT_COSTING%';
```

All three should return no rows.

---

## Summary of what gets removed

| Object | Type |
|--------|------|
| `APC_DEPLOY_DB` | Database (and all contents) |
| `APC_DEPLOY_WH` | Warehouse |
| `AI_PRODUCT_COSTING` | App Runtime app (if deployed) |
| `APC_DEPLOY_STREAMLIT` | Streamlit app (if deployed) |
| `VARIANCE_FORECAST_MODEL` | ML Forecast model |
| `VARIANCE_BACKTEST_MODEL` | ML Forecast backtest model |
| `DBT_ANALYTICS.apc` + `MART_*` | dbt project + Dynamic Table marts (inside APC_DEPLOY_DB) |

---

## Partial cleanup

If the user only wants to remove certain parts:

**Remove just the app (keep data):**
```bash
cd app-ui && snow app teardown --force --cascade
```

**Remove just the data (keep app):**
```sql
TRUNCATE TABLE APC_DEPLOY_DB.SAP_BDC.MATERIAL_LEDGER;
TRUNCATE TABLE APC_DEPLOY_DB.SAP_BDC.COST_COMPONENT_SPLIT;
TRUNCATE TABLE APC_DEPLOY_DB.SAP_BDC.SD_BILLING;
-- etc.
```

**Remove just the ML objects:**
```sql
DROP SNOWFLAKE.ML.FORECAST IF EXISTS APC_DEPLOY_DB.ANALYTICS.VARIANCE_FORECAST_MODEL;
DROP TABLE IF EXISTS APC_DEPLOY_DB.ANALYTICS.VARIANCE_FORECAST;
DROP VIEW IF EXISTS APC_DEPLOY_DB.ANALYTICS.COST_ANOMALIES;
DROP VIEW IF EXISTS APC_DEPLOY_DB.ANALYTICS.PRODUCT_RISK_SCORES;
DROP VIEW IF EXISTS APC_DEPLOY_DB.ANALYTICS.VARIANCE_TREND_WITH_FORECAST;
```
