-- Intermediate: derive period actual unit cost from raw postings.
--   1. Aggregate line items to material x plant x period (Σqty, Σamount) — this
--      nets out reversals (BWART 102 negative rows).
--   2. Weighted-average unit cost = Σamount / Σqty (in local currency).
--   3. FX-convert to USD using the monthly TCURR rate for the posting period.
-- This is the core "raw transactions -> analysis-ready actual cost" transform.

with postings as (
    select * from {{ ref('stg_ledger_postings') }}
),

agg as (
    select
        material_number,
        plant_code,
        company_code,
        fiscal_year,
        period,
        period_int,
        local_currency,
        sum(quantity)     as net_quantity,
        sum(amount_local) as net_amount_local
    from postings
    group by 1, 2, 3, 4, 5, 6, 7
),

fx as (
    select from_currency, rate_year, rate_month, usd_per_unit
    from {{ ref('stg_fx_rates') }}
)

select
    a.material_number,
    a.plant_code,
    a.company_code,
    a.fiscal_year,
    a.period,
    a.period_int,
    a.local_currency,
    a.net_quantity,
    a.net_amount_local,
    a.net_amount_local / nullif(a.net_quantity, 0)                             as unit_cost_local,
    round(a.net_amount_local / nullif(a.net_quantity, 0) * f.usd_per_unit, 4)  as actual_cost_usd
from agg a
left join fx f
       on f.from_currency = a.local_currency
      and f.rate_year     = a.fiscal_year
      and f.rate_month    = a.period_int
where a.net_quantity <> 0
