-- Mart: COGM evolution tracked by site/brand/country/TA over time.
-- Co-authored with CoCo

with costs as (
    select
        pc.material_number,
        pc.material_description,
        pc.plant_code,
        pc.fiscal_year,
        pc.period,
        pc.actual_cost_per_unit,
        pc.standard_cost_per_unit,
        pc.cost_variance_pct,
        pc.variance_flag
    from {{ ref('mart_product_cost') }} pc
    where pc.material_type = 'FERT'
),

-- Enrich with brand/TA/country dimensions from seed
dimensioned as (
    select
        c.material_number,
        c.material_description,
        c.plant_code,
        pl.plant_name,
        pl.country as country_code,
        bt.brand,
        bt.therapeutic_area,
        bt.country as market_country,
        bt.legal_entity,
        c.fiscal_year,
        c.period,
        c.actual_cost_per_unit,
        c.standard_cost_per_unit,
        c.cost_variance_pct,
        c.variance_flag,
        -- Period-over-period cost change
        c.actual_cost_per_unit - lag(c.actual_cost_per_unit) over (
            partition by c.material_number, c.plant_code
            order by c.fiscal_year, c.period
        ) as cost_change_vs_prior,
        -- Rolling 3-period average
        avg(c.actual_cost_per_unit) over (
            partition by c.material_number, c.plant_code
            order by c.fiscal_year, c.period
            rows between 2 preceding and current row
        ) as rolling_3m_avg_cost
    from costs c
    left join {{ ref('stg_plant') }} pl
        on c.plant_code = pl.plant_code
    left join {{ ref('brand_ta_mapping') }} bt
        on c.material_number = bt.material_number
)

select
    *,
    -- YoY comparison flag
    case
        when cost_change_vs_prior > 0 and cost_variance_pct > 5 then 'ESCALATING'
        when cost_change_vs_prior < 0 then 'IMPROVING'
        else 'STABLE'
    end as cost_trajectory
from dimensioned
