-- Intermediate: resolve the effective-dated standard price for each fiscal year,
-- then FX-convert to USD. For each material x plant x fiscal year, pick the MBEW
-- row with the latest valid_from_year <= that fiscal year (standard in force).

with standards as (
    select * from {{ ref('stg_standard_price') }}
),

fiscal_years as (
    select distinct fiscal_year from {{ ref('stg_ledger_postings') }}
),

resolved as (
    select
        s.material_number,
        s.plant_code,
        y.fiscal_year,
        s.standard_price_local,
        s.local_currency,
        s.valid_from_year,
        row_number() over (
            partition by s.material_number, s.plant_code, y.fiscal_year
            order by s.valid_from_year desc
        ) as _rn
    from standards s
    join fiscal_years y
      on s.valid_from_year <= y.fiscal_year
)

select
    r.material_number,
    r.plant_code,
    r.fiscal_year,
    r.standard_price_local,
    r.local_currency,
    round(r.standard_price_local * f.usd_per_unit, 4) as standard_cost_usd
from resolved r
left join {{ ref('stg_fx_rates') }} f
       on f.from_currency = r.local_currency
      and f.rate_year     = r.fiscal_year
      and f.rate_month    = 1            -- annual standard valued at start-of-year FX
where r._rn = 1
