-- Intermediate: three-way volume reconciliation — APO planned vs commercial forecast vs actual billing.
-- Co-authored with CoCo

with planned as (
    select
        material_number,
        plant_code,
        fiscal_year,
        period,
        planned_production_qty,
        confirmed_qty,
        commercial_forecast_qty
    from {{ ref('stg_apo_planned_volume') }}
),

actual_billing as (
    select
        material_number,
        fiscal_year,
        cast(period as int)  as period,
        sum(billed_qty)      as actual_billed_qty,
        sum(net_revenue)     as actual_revenue
    from {{ ref('stg_sd_billing') }}
    group by 1, 2, 3
),

reconciled as (
    select
        coalesce(p.material_number, a.material_number)  as material_number,
        p.plant_code,
        coalesce(p.fiscal_year, a.fiscal_year)          as fiscal_year,
        coalesce(p.period, a.period)                    as period,
        -- The three volumes
        p.planned_production_qty,
        p.commercial_forecast_qty,
        a.actual_billed_qty,
        -- APO vs Commercial gap (planning misalignment)
        coalesce(p.planned_production_qty, 0)
            - coalesce(p.commercial_forecast_qty, 0)    as apo_vs_commercial_gap,
        -- Plan vs Actual gap (forecast accuracy)
        coalesce(p.planned_production_qty, 0)
            - coalesce(a.actual_billed_qty, 0)          as plan_vs_actual_gap,
        -- Percentage deviations
        round(100.0 * (coalesce(p.planned_production_qty, 0) - coalesce(a.actual_billed_qty, 0))
              / nullif(p.planned_production_qty, 0), 1) as plan_accuracy_pct,
        -- Flags
        case
            when a.actual_billed_qty is null and p.planned_production_qty > 0
                then 'NO_BILLING'
            when p.planned_production_qty is null and a.actual_billed_qty > 0
                then 'UNPLANNED_DEMAND'
            when abs(coalesce(p.planned_production_qty, 0) - coalesce(a.actual_billed_qty, 0))
                 / nullif(p.planned_production_qty, 0) > 0.20
                then 'HIGH_DEVIATION'
            when abs(coalesce(p.planned_production_qty, 0) - coalesce(a.actual_billed_qty, 0))
                 / nullif(p.planned_production_qty, 0) > 0.10
                then 'MEDIUM_DEVIATION'
            else 'ALIGNED'
        end as alignment_status
    from planned p
    full outer join actual_billing a
        on p.material_number = a.material_number
        and p.fiscal_year = a.fiscal_year
        and p.period = a.period
)

select * from reconciled
