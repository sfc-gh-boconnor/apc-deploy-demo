-- Mart: portfolio variance trend (actuals) + ML forecast. Parity with
-- {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.VARIANCE_TREND_WITH_FORECAST.
-- Actuals come from the dbt pipeline (mart_product_cost). The forecast rows come
-- from the procedural Snowflake ML model output (ANALYTICS.VARIANCE_FORECAST) —
-- ML model training is not a Dynamic Table, so dbt consumes its output here.

with actuals as (
    select
        date_from_parts(FISCAL_YEAR, cast(PERIOD as int), 1) as ts,
        round(avg(COST_VARIANCE_PCT), 2)                     as actual_variance
    from {{ ref('mart_product_cost') }}
    where MATERIAL_TYPE = 'FERT'
    group by 1
)

select
    ts                                                                   as TS,
    concat(year(ts), '-P', lpad(month(ts)::varchar, 3, '0'))             as PERIOD_LABEL,
    actual_variance                                                      as ACTUAL_VARIANCE,
    null::float                                                          as FORECAST_VARIANCE,
    null::float                                                          as FORECAST_LOWER,
    null::float                                                          as FORECAST_UPPER,
    'actual'                                                             as DATA_TYPE
from actuals

union all

select
    ts::date                                                             as TS,
    concat(year(ts::date), '-P', lpad(month(ts::date)::varchar, 3, '0')) as PERIOD_LABEL,
    null::float                                                          as ACTUAL_VARIANCE,
    round(FORECAST, 2)                                                   as FORECAST_VARIANCE,
    round(LOWER_BOUND, 2)                                                as FORECAST_LOWER,
    round(UPPER_BOUND, 2)                                                as FORECAST_UPPER,
    'forecast'                                                           as DATA_TYPE
from {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.VARIANCE_FORECAST
