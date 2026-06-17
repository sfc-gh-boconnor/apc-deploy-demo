-- Intermediate: FX-convert component values to USD and pivot the KEPH S/A record
-- types into standard vs actual per component.

with comp as (
    select
        c.material_number,
        c.plant_code,
        c.fiscal_year,
        c.period,
        c.period_int,
        c.cost_component,
        c.record_type,
        c.value_local * f.usd_per_unit as value_usd
    from {{ ref('stg_cost_components') }} c
    left join {{ ref('stg_fx_rates') }} f
           on f.from_currency = c.local_currency
          and f.rate_year     = c.fiscal_year
          and f.rate_month    = c.period_int
)

select
    material_number,
    plant_code,
    fiscal_year,
    period,
    period_int,
    cost_component,
    round(sum(case when record_type = 'S' then value_usd end), 4) as standard_cost,
    round(sum(case when record_type = 'A' then value_usd end), 4) as actual_cost
from comp
group by 1, 2, 3, 4, 5, 6
