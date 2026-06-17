-- Singular test: the derived budget (prior-year actual, from raw) must match the
-- curated SAP_BDC.COST_BUDGET table within FX round-trip tolerance (±0.05).

with derived as (
    select material_number, plant_code, fiscal_year, period, budget_cost
    from {{ ref('mart_cost_budget') }}
),

src as (
    select trim(MATNR) as material_number, trim(BWKEY) as plant_code,
           GJAHR as fiscal_year, POPER as period, BUDGET_COST as budget_cost
    from {{ var('database', 'APC_DEPLOY_DB') }}.SAP_BDC.COST_BUDGET
)

select d.material_number, d.plant_code, d.fiscal_year, d.period,
       d.budget_cost as derived_budget, s.budget_cost as source_budget
from derived d
join src s
  on s.material_number = d.material_number
 and s.plant_code      = d.plant_code
 and s.fiscal_year     = d.fiscal_year
 and s.period          = d.period
where abs(d.budget_cost - s.budget_cost) > 0.05
