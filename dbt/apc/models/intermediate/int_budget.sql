-- Intermediate: derive the budget + (for transparency) the annual standard reset.
--   Budget(year Y, period m) = actual_cost_usd(Y-1, m)  [prior-year same-month actual]
--   Derived standard(Y)      = avg(prior-year actual) * (1 + inflation if Y >= 2026)
-- Demonstrates the budget + standard-reset engineering in governed, tested SQL.

with actuals as (
    select * from {{ ref('int_period_actuals') }}
),

prior_year_avg as (
    select
        material_number,
        plant_code,
        fiscal_year + 1                       as for_fiscal_year,
        round(avg(actual_cost_usd), 4)         as prior_year_avg_actual
    from actuals
    group by 1, 2, 3
)

select
    cur.material_number,
    cur.plant_code,
    cur.fiscal_year,
    cur.period,
    cur.period_int,
    prev.actual_cost_usd                       as budget_cost_usd,
    round(
        pya.prior_year_avg_actual
        * (1 + case when cur.fiscal_year >= 2026
                    then {{ var('standard_inflation') }} else 0 end),
        2
    )                                          as derived_standard_usd
from actuals cur
left join actuals prev
       on prev.material_number = cur.material_number
      and prev.plant_code      = cur.plant_code
      and prev.fiscal_year     = cur.fiscal_year - 1
      and prev.period_int      = cur.period_int
left join prior_year_avg pya
       on pya.material_number  = cur.material_number
      and pya.plant_code       = cur.plant_code
      and pya.for_fiscal_year  = cur.fiscal_year
