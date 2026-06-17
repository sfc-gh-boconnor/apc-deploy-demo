-- Mart: product profitability (CO-PA style) — SD revenue vs CO-PC cost, by
-- material x market x period. Parity with {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.PRODUCT_PROFITABILITY.
-- COGS_BUDGET uses the (annual) standard cost; COGS_ACTUAL uses the actual.

with billing as (
    select * from {{ ref('stg_sd_billing') }}
    where fiscal_year = 2026
),

cost as (
    select
        MATERIAL_NUMBER,
        MATERIAL_DESCRIPTION,
        PERIOD,
        avg(ACTUAL_COST_PER_UNIT)   as avg_actual_cost,
        avg(STANDARD_COST_PER_UNIT) as avg_budget_cost
    from {{ ref('mart_product_cost') }}
    where FISCAL_YEAR = 2026 and MATERIAL_TYPE = 'FERT'
    group by 1, 2, 3
)

select
    b.material_number                                                   as MATERIAL_NUMBER,
    c.MATERIAL_DESCRIPTION                                              as MATERIAL_DESCRIPTION,
    b.market                                                            as MARKET,
    b.period                                                            as PERIOD,
    b.fiscal_year                                                       as FISCAL_YEAR,
    sum(b.net_revenue)                                                  as REVENUE,
    sum(b.billed_qty)                                                   as VOLUME_UNITS,
    avg(b.net_price)                                                    as AVG_NET_PRICE,
    sum(b.billed_qty * c.avg_actual_cost)                              as COGS_ACTUAL,
    sum(b.billed_qty * c.avg_budget_cost)                              as COGS_BUDGET,
    sum(b.net_revenue) - sum(b.billed_qty * c.avg_actual_cost)         as GROSS_PROFIT_ACTUAL,
    sum(b.net_revenue) - sum(b.billed_qty * c.avg_budget_cost)         as GROSS_PROFIT_BUDGET,
    round((sum(b.net_revenue) - sum(b.billed_qty * c.avg_actual_cost))
          / nullif(sum(b.net_revenue), 0) * 100, 1)                    as GROSS_MARGIN_PCT_ACTUAL,
    round((sum(b.net_revenue) - sum(b.billed_qty * c.avg_budget_cost))
          / nullif(sum(b.net_revenue), 0) * 100, 1)                    as GROSS_MARGIN_PCT_BUDGET,
    round(
        (sum(b.net_revenue) - sum(b.billed_qty * c.avg_actual_cost)) / nullif(sum(b.net_revenue), 0) * 100
        - (sum(b.net_revenue) - sum(b.billed_qty * c.avg_budget_cost)) / nullif(sum(b.net_revenue), 0) * 100
    , 1)                                                                as MARGIN_VARIANCE_PPS
from billing b
join cost c
  on b.material_number = c.MATERIAL_NUMBER
 and b.period          = c.PERIOD
group by 1, 2, 3, 4, 5
