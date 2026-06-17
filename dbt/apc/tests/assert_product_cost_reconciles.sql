-- Singular test: the raw -> dbt pipeline must reproduce the curated costing truth.
-- Compares mart_product_cost (built from RAW SAP) to ANALYTICS.PRODUCT_COST_SUMMARY.
-- Returns rows ONLY on a mismatch beyond a small FX round-trip tolerance (±0.05).

with derived as (
    select material_number, plant_code, fiscal_year, period,
           actual_cost_per_unit, standard_cost_per_unit, budget_cost_per_unit
    from {{ ref('mart_product_cost') }}
),

curated as (
    select MATERIAL_NUMBER as material_number, PLANT_CODE as plant_code,
           FISCAL_YEAR as fiscal_year, PERIOD as period,
           ACTUAL_COST_PER_UNIT as actual_cost, STANDARD_COST_PER_UNIT as standard_cost,
           BUDGET_COST_PER_UNIT as budget_cost
    from {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.PRODUCT_COST_SUMMARY
)

select
    d.material_number, d.plant_code, d.fiscal_year, d.period,
    d.actual_cost_per_unit, c.actual_cost,
    d.standard_cost_per_unit, c.standard_cost,
    d.budget_cost_per_unit, c.budget_cost
from derived d
join curated c
  on c.material_number = d.material_number
 and c.plant_code      = d.plant_code
 and c.fiscal_year     = d.fiscal_year
 and c.period          = d.period
where abs(d.actual_cost_per_unit - c.actual_cost) > 0.05
   or abs(coalesce(d.standard_cost_per_unit, 0) - coalesce(c.standard_cost, 0)) > 0.05
   or abs(coalesce(d.budget_cost_per_unit, -999) - coalesce(c.budget_cost, -999)) > 0.05
