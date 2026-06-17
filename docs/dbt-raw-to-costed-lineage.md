# Raw SAP → Costed: the dbt-on-Snowflake pipeline

How genuinely raw SAP transactional data is engineered into the analysis-ready
product-costing model, entirely inside Snowflake using **dbt Projects on Snowflake**
materialized as **Dynamic Tables**.

## Lineage (DAG)

```
RAW SAP (APC_DEPLOY_DB.SAP_RAW)                    dbt medallion (APC_DEPLOY_DB.DBT_ANALYTICS, Dynamic Tables)
─────────────────────────                  ────────────────────────────────────────────────────
MATERIAL_LEDGER_DOC  ─┐
(posting line items)  │   staging              intermediate                marts
MBEW_RAW ─────────────┤   ─────────            ────────────                ─────
(eff-dated standard)  ├─► stg_ledger_postings ─► int_period_actuals ──┐
KEPH_RAW ─────────────┤   stg_standard_price ──► int_standard_by_period├─► mart_product_cost ─► mart_product_cost_monthly
(coded components)    │   stg_cost_components ─► int_cost_components   │   mart_cost_budget
MARA_RAW / T001W_RAW ─┤   stg_material_master                         └─► mart_cost_component_detail
(master, messy)       │   stg_plant            int_budget (prior-yr actual + std reset)
TCURR_RAW ────────────┘   stg_fx_rates
(FX, inverted date)       + seeds: cost_component_map, material_type_map
```

## SAP source objects → what they are

| Raw table | SAP origin | Grain |
|---|---|---|
| `MATERIAL_LEDGER_DOC` | CKMLCR / MLIT | posting line item (many per period) |
| `MBEW_RAW` | MBEW | standard price, effective-dated |
| `KEPH_RAW` | KEPH | cost component split, coded element |
| `MARA_RAW` / `T001W_RAW` | MARA / T001W | material / plant master |
| `TCURR_RAW` | TCURR | FX rates (FCURR→USD) |

## The transformations (the real engineering)

1. **De-duplicate** repeated extract rows on the document key (`MANDT, BELNR, BUZEI`).
2. **Filter** incomplete postings (null amount).
3. **Trim** trailing spaces on `MATNR`/`WERKS`; **zero-pad** `POPER` (int → `001`); parse `BUDAT`.
4. **Aggregate** posting line items to material × plant × period, **netting reversals** (BWART 102 / negative qty) → weighted-average unit cost = Σamount / Σquantity.
5. **FX-convert** local currency → USD: decode the SAP inverted `GDATU`, join the monthly `TCURR` rate (`usd = local × usd_per_unit`).
6. **Resolve the effective-dated standard** (`MBEW`): pick the price in force for each fiscal year; FX to USD.
7. **Decode coded fields** via seeds: `ELEMENT` → cost-component label, `MTART` → material-type description.
8. **Derive the budget** = prior-year same-month actual; derive the **annual standard reset** = prior-year average × (1 + inflation, FY2026+).
9. Assemble the **three-way variance** (Actual vs Budget vs Standard) in `mart_product_cost`.

## Materialization

Every staging / intermediate / mart model is a **Dynamic Table** (`APC_DEPLOY_DB.DBT_ANALYTICS`).
Staging + intermediate use `target_lag = downstream`; marts use `target_lag = '1 hour'`.
The chain stays fresh on `APC_DEPLOY_WH` with **no tasks, streams, or orchestration code**.

## Tests / governance

- Schema tests: `not_null`, `unique`, `accepted_values`, `relationships`.
- **Reconciliation singular tests** prove the raw→dbt pipeline reproduces the curated
  truth within an FX round-trip tolerance (±0.05):
  - `tests/assert_product_cost_reconciles.sql` vs `ANALYTICS.PRODUCT_COST_SUMMARY`
  - `tests/assert_budget_reconciles.sql` vs `SAP_BDC.COST_BUDGET`

## Run it (snow dbt)

```bash
# Deploy the project into Snowflake (auth from the session)
snow dbt deploy apc --source dbt/apc --database APC_DEPLOY_DB --schema DBT_ANALYTICS -c fsi-builders-london

# Build seeds + Dynamic Tables + run tests
snow dbt execute -c fsi-builders-london --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc build

# Generate documentation + lineage graph
snow dbt execute -c fsi-builders-london --database APC_DEPLOY_DB --schema DBT_ANALYTICS apc docs generate
```

The pipeline is the governed, version-controlled, tested path from raw SAP to the
costing model the app and Cortex Analyst consume.
