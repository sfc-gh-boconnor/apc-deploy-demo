-- Mart: period budget (prior-year actual) per material x plant x period.
-- Parity with {{ var('database', 'APC_DEPLOY_DB') }}.SAP_BDC.COST_BUDGET, derived from raw via the pipeline.

select
    material_number,
    plant_code,
    fiscal_year,
    period,
    budget_cost_usd as budget_cost,
    'USD'           as currency
from {{ ref('int_budget') }}
where budget_cost_usd is not null
