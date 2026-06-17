-- Mart: analysis-ready product cost — Actual vs Budget vs Standard per
-- material x plant x period. Parity with {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.PRODUCT_COST_SUMMARY,
-- but built entirely from RAW SAP via the dbt medallion pipeline.

with actuals as (
    select * from {{ ref('int_period_actuals') }}
),

standard as (
    select * from {{ ref('int_standard_by_period') }}
),

budget as (
    select * from {{ ref('int_budget') }}
),

material as (
    select * from {{ ref('stg_material_master') }}
),

plant as (
    select * from {{ ref('stg_plant') }}
)

select
    a.plant_code,
    p.plant_name,
    p.country,
    a.material_number,
    m.material_description,
    m.material_type_code                                       as material_type,
    m.material_group,
    a.fiscal_year,
    a.period,
    a.fiscal_year || '-P' || a.period                          as year_period,
    s.standard_cost_usd                                        as standard_cost_per_unit,
    a.actual_cost_usd                                          as actual_cost_per_unit,
    b.budget_cost_usd                                          as budget_cost_per_unit,
    round(a.actual_cost_usd - s.standard_cost_usd, 4)          as cost_variance_abs,
    round((a.actual_cost_usd - s.standard_cost_usd)
          / nullif(s.standard_cost_usd, 0) * 100, 2)           as cost_variance_pct,
    round(a.actual_cost_usd - b.budget_cost_usd, 4)            as budget_variance_abs,
    round((a.actual_cost_usd - b.budget_cost_usd)
          / nullif(b.budget_cost_usd, 0) * 100, 2)             as budget_variance_pct,
    case
        when abs((a.actual_cost_usd - s.standard_cost_usd)
                 / nullif(s.standard_cost_usd, 0) * 100) > 5 then 'HIGH'
        when abs((a.actual_cost_usd - s.standard_cost_usd)
                 / nullif(s.standard_cost_usd, 0) * 100) > 2 then 'MEDIUM'
        else 'LOW'
    end                                                        as variance_flag,
    'USD'                                                      as currency
from actuals a
left join standard s
       on s.material_number = a.material_number
      and s.plant_code      = a.plant_code
      and s.fiscal_year     = a.fiscal_year
left join budget b
       on b.material_number = a.material_number
      and b.plant_code      = a.plant_code
      and b.fiscal_year     = a.fiscal_year
      and b.period          = a.period
join material m on a.material_number = m.material_number
join plant    p on a.plant_code      = p.plant_code
