-- Mart: sales revenue trend (actuals) + ML forecast + margin compression bridge.
-- Actuals (H1 FY2026) come from the SAP_BDC.SD_BILLING source via stg_sd_billing.
-- Forecast rows (H2 FY2026) come from the procedural ML model outputs in ANALYTICS
-- (SALES_REVENUE_FORECAST, SALES_VOLUME_FORECAST — ML training is not a Dynamic Table).
-- Cost is sourced from mart_product_cost to ensure dbt-pipeline values.

with billing_actuals as (
    select
        date_from_parts(fiscal_year, cast(period as int), 1)  as ts,
        material_number,
        sum(net_revenue)                                       as actual_revenue,
        sum(billed_qty)                                        as actual_volume,
        avg(net_price)                                         as avg_net_price
    from {{ ref('stg_sd_billing') }}
    group by 1, 2
),

cost_actuals as (
    select
        material_number,
        material_description,
        period,
        fiscal_year,
        avg(actual_cost_per_unit)   as cost_per_unit
    from {{ ref('mart_product_cost') }}
    where fiscal_year = 2026 and material_type = 'FERT'
    group by 1, 2, 3, 4
),

h1_unit_cost as (
    select
        material_number,
        avg(actual_cost_per_unit) as avg_cost_per_unit
    from {{ ref('mart_product_cost') }}
    where fiscal_year = 2026 and material_type = 'FERT'
    group by 1
),

cost_trend as (
    select
        material_number,
        avg(cost_variance_pct) / 100.0 as monthly_cost_drift
    from {{ ref('mart_product_cost') }}
    where fiscal_year = 2026 and material_type = 'FERT'
    group by 1
),

actuals_with_margin as (
    select
        b.ts,
        b.material_number,
        c.material_description,
        b.actual_revenue,
        b.actual_volume,
        c.cost_per_unit,
        round(b.actual_revenue - c.cost_per_unit * b.actual_volume, 2)         as actual_gross_margin,
        round(100.0 * (b.actual_revenue - c.cost_per_unit * b.actual_volume)
                    / nullif(b.actual_revenue, 0), 1)                           as actual_margin_pct,
        null::float                                                              as forecast_revenue,
        null::float                                                              as revenue_lower,
        null::float                                                              as revenue_upper,
        null::float                                                              as forecast_volume,
        null::float                                                              as forecast_cost_per_unit,
        null::float                                                              as forecast_gross_margin,
        null::float                                                              as forecast_margin_pct,
        'actual'                                                                 as data_type
    from billing_actuals b
    left join cost_actuals c
        on  c.material_number = b.material_number
        and c.fiscal_year     = year(b.ts)
        and cast(c.period as int)       = month(b.ts)
),

forecast_rows as (
    select
        rf.ts::date                                                              as ts,
        rf.series                                                                as material_number,
        null::float                                                              as actual_revenue,
        null::float                                                              as actual_volume,
        round(uc.avg_cost_per_unit * (1 + coalesce(ct.monthly_cost_drift, 0)), 2) as cost_per_unit,
        null::float                                                              as actual_gross_margin,
        null::float                                                              as actual_margin_pct,
        round(rf.forecast, 2)                                                    as forecast_revenue,
        round(rf.lower_bound, 2)                                                 as revenue_lower,
        round(rf.upper_bound, 2)                                                 as revenue_upper,
        round(greatest(vf.forecast, 0), 0)                                      as forecast_volume,
        round(uc.avg_cost_per_unit * (1 + coalesce(ct.monthly_cost_drift, 0)), 2) as forecast_cost_per_unit,
        round(rf.forecast
              - greatest(vf.forecast, 0)
                * uc.avg_cost_per_unit
                * (1 + coalesce(ct.monthly_cost_drift, 0)), 2)                   as forecast_gross_margin,
        round(100.0 * (rf.forecast
                       - greatest(vf.forecast, 0)
                         * uc.avg_cost_per_unit
                         * (1 + coalesce(ct.monthly_cost_drift, 0)))
                     / nullif(rf.forecast, 0), 1)                                as forecast_margin_pct,
        'forecast'                                                               as data_type
    from {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.SALES_REVENUE_FORECAST rf
    join {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.SALES_VOLUME_FORECAST vf
        on rf.series = vf.series and rf.ts = vf.ts
    left join h1_unit_cost uc  on uc.material_number = rf.series
    left join cost_trend ct    on ct.material_number = rf.series
)

select
    a.ts                    as TS,
    a.material_number       as MATERIAL_NUMBER,
    null::varchar           as MATERIAL_DESCRIPTION,
    a.actual_revenue        as ACTUAL_REVENUE,
    a.actual_volume         as ACTUAL_VOLUME,
    a.cost_per_unit         as COST_PER_UNIT,
    a.actual_gross_margin   as ACTUAL_GROSS_MARGIN,
    a.actual_margin_pct     as ACTUAL_MARGIN_PCT,
    a.forecast_revenue      as FORECAST_REVENUE,
    a.revenue_lower         as REVENUE_LOWER,
    a.revenue_upper         as REVENUE_UPPER,
    a.forecast_volume       as FORECAST_VOLUME,
    a.forecast_cost_per_unit as FORECAST_COST_PER_UNIT,
    a.forecast_gross_margin as FORECAST_GROSS_MARGIN,
    a.forecast_margin_pct   as FORECAST_MARGIN_PCT,
    a.data_type             as DATA_TYPE
from actuals_with_margin a

union all

select
    f.ts,
    f.material_number,
    null::varchar,
    f.actual_revenue,
    f.actual_volume,
    f.cost_per_unit,
    f.actual_gross_margin,
    f.actual_margin_pct,
    f.forecast_revenue,
    f.revenue_lower,
    f.revenue_upper,
    f.forecast_volume,
    f.forecast_cost_per_unit,
    f.forecast_gross_margin,
    f.forecast_margin_pct,
    f.data_type
from forecast_rows f
