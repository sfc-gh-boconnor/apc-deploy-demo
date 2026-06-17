-- Mart: energy cost bridge — the live "external market index -> costed energy"
-- lineage. Joins the Marketplace-shaped energy price feed (WA $/MWh) to each
-- plant's energy intensity (MWh per produced unit) to derive an energy cost per
-- unit by plant and period. This is the data-sharing story: a real Marketplace
-- energy share would flow through here unchanged.

select
    i.plant_code,
    i.country,
    i.energy_index,
    e.price_year                                     as fiscal_year,
    e.period,
    e.delivery,
    e.price_per_mwh,
    i.mwh_per_unit,
    round(e.price_per_mwh * i.mwh_per_unit, 4)        as energy_cost_per_unit
from {{ ref('stg_energy_prices') }} e
join {{ ref('plant_energy_intensity') }} i
  on i.energy_index = e.energy_index
