-- Intermediate: activity rate stability validation — flags rates that shifted vs prior period.
-- Co-authored with CoCo

with current_rates as (
    select
        cost_centre,
        activity_type,
        plant_code,
        fiscal_year,
        total_rate,
        rate_type
    from {{ ref('stg_activity_rates') }}
    where rate_type = 1  -- plan rates
),

-- Prior year rate for comparison
prior_rates as (
    select
        cost_centre,
        activity_type,
        plant_code,
        fiscal_year + 1 as compare_to_year,
        total_rate as prior_rate
    from {{ ref('stg_activity_rates') }}
    where rate_type = 1
),

validated as (
    select
        c.cost_centre,
        c.activity_type,
        c.plant_code,
        c.fiscal_year,
        c.total_rate as current_rate,
        p.prior_rate,
        round(c.total_rate - coalesce(p.prior_rate, c.total_rate), 2) as rate_change,
        round(100.0 * (c.total_rate - coalesce(p.prior_rate, c.total_rate))
              / nullif(p.prior_rate, 0), 1) as rate_change_pct,
        case
            when p.prior_rate is null then 'NEW_RATE'
            when abs(c.total_rate - p.prior_rate) / nullif(p.prior_rate, 0) > 0.15 then 'UNSTABLE'
            when abs(c.total_rate - p.prior_rate) / nullif(p.prior_rate, 0) > 0.08 then 'WATCH'
            else 'STABLE'
        end as stability_status
    from current_rates c
    left join prior_rates p
        on c.cost_centre = p.cost_centre
        and c.activity_type = p.activity_type
        and c.plant_code = p.plant_code
        and c.fiscal_year = p.compare_to_year
)

select * from validated
