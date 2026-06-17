-- Mart: cost component detail (standard vs actual by component) in USD.
-- Parity with {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.COST_COMPONENT_DETAIL.

select
    c.material_number,
    m.material_description,
    m.material_type_code                                   as material_type,
    c.plant_code,
    p.plant_name,
    p.country,
    c.fiscal_year,
    c.period,
    c.cost_component,
    c.standard_cost,
    c.actual_cost,
    round(c.actual_cost - c.standard_cost, 4)              as component_variance,
    round((c.actual_cost - c.standard_cost)
          / nullif(c.standard_cost, 0) * 100, 2)           as component_variance_pct,
    'USD'                                                  as currency
from {{ ref('int_cost_components') }} c
join {{ ref('stg_material_master') }} m on c.material_number = m.material_number
join {{ ref('stg_plant') }} p           on c.plant_code      = p.plant_code
