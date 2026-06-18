-- Mart: activity rate movement tracking + alerts — flags unstable rates by cost centre.
-- Co-authored with CoCo

with validated as (
    select * from {{ ref('int_activity_rate_validation') }}
),

enriched as (
    select
        v.cost_centre,
        v.activity_type,
        v.plant_code,
        pl.plant_name,
        v.fiscal_year,
        v.current_rate,
        v.prior_rate,
        v.rate_change,
        v.rate_change_pct,
        v.stability_status,
        -- Impact estimate: rate change × typical volume (approx)
        case
            when v.stability_status = 'UNSTABLE' then 'ACTION_REQUIRED'
            when v.stability_status = 'WATCH' then 'MONITOR'
            else 'OK'
        end as recommended_action,
        -- Cost impact direction
        case
            when v.rate_change > 0 then 'COST_INCREASE'
            when v.rate_change < 0 then 'COST_DECREASE'
            else 'NO_CHANGE'
        end as impact_direction
    from validated v
    left join {{ ref('stg_plant') }} pl
        on v.plant_code = pl.plant_code
)

select * from enriched
