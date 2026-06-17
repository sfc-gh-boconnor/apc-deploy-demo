-- Mart: statistical cost anomalies (z-score of component variance within
-- component x year x period). Parity with {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.COST_ANOMALIES.

with comp as (
    select
        c.material_number,
        c.plant_code,
        c.fiscal_year,
        c.period,
        c.cost_component,
        c.standard_cost,
        c.actual_cost,
        round((c.actual_cost - c.standard_cost) / nullif(c.standard_cost, 0) * 100, 2) as variance_pct,
        m.material_description,
        p.plant_name
    from {{ ref('int_cost_components') }} c
    join {{ ref('stg_material_master') }} m on c.material_number = m.material_number
    join {{ ref('stg_plant') }} p           on c.plant_code      = p.plant_code
),

stats as (
    select
        cost_component, fiscal_year, period,
        avg(variance_pct)    as mean_var,
        stddev(variance_pct) as std_var
    from comp
    group by 1, 2, 3
)

select
    c.material_number                                              as MATERIAL_NUMBER,
    c.material_description                                         as MATERIAL_DESCRIPTION,
    c.plant_name                                                  as PLANT_NAME,
    c.cost_component                                              as COST_COMPONENT,
    c.fiscal_year                                                 as FISCAL_YEAR,
    c.period                                                      as PERIOD,
    round(c.actual_cost, 2)                                       as ACTUAL_COST,
    round(c.standard_cost, 2)                                     as STANDARD_COST,
    c.variance_pct                                                as VARIANCE_PCT,
    round((c.variance_pct - s.mean_var) / nullif(s.std_var, 0), 2) as Z_SCORE,
    abs((c.variance_pct - s.mean_var) / nullif(s.std_var, 0)) > 1.5 as IS_ANOMALY
from comp c
join stats s
  on c.cost_component = s.cost_component
 and c.fiscal_year    = s.fiscal_year
 and c.period         = s.period
