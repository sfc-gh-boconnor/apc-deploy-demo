-- Mart: volume alignment dashboard — APO / commercial / billing reconciliation by product × period.
-- Co-authored with CoCo

with recon as (
    select * from {{ ref('int_volume_reconciliation') }}
),

summary as (
    select
        r.material_number,
        mm.material_description,
        r.plant_code,
        r.fiscal_year,
        r.period,
        r.planned_production_qty,
        r.commercial_forecast_qty,
        r.actual_billed_qty,
        r.apo_vs_commercial_gap,
        r.plan_vs_actual_gap,
        r.plan_accuracy_pct,
        r.alignment_status,
        -- Revenue impact of volume gap (avg price × gap qty)
        round(r.plan_vs_actual_gap * coalesce(
            a.actual_revenue / nullif(a.actual_billed_qty, 0), 0
        ), 0) as revenue_gap_estimate
    from recon r
    left join {{ ref('stg_material_master') }} mm
        on r.material_number = mm.material_number
    left join (
        select
            material_number,
            fiscal_year,
            cast(period as int) as period,
            sum(net_revenue)    as actual_revenue,
            sum(billed_qty)     as actual_billed_qty
        from {{ ref('stg_sd_billing') }}
        group by 1, 2, 3
    ) a
        on r.material_number = a.material_number
        and r.fiscal_year = a.fiscal_year
        and r.period = a.period
)

select * from summary
