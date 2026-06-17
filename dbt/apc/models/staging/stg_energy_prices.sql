-- Staging: clean the Marketplace-shaped energy price indices (LEBA shape).
-- Parses the YYYYMMDD integer DATE into year/month and exposes the volume-
-- weighted average price (WA, $/MWh) per market index. Swap the source to the
-- real EOSE.* share and this model is unchanged.

select
    "INDEX"                                          as energy_index,
    DELIVERY                                         as delivery,
    "DATE"                                           as price_date_int,
    floor("DATE" / 10000)                            as price_year,
    floor(mod("DATE", 10000) / 100)                  as price_month,
    lpad(floor(mod("DATE", 10000) / 100)::varchar, 3, '0') as period,
    WA                                               as price_per_mwh,
    VOLUME                                           as traded_volume,
    STATUS                                           as status_code,
    FLAG                                             as quality_flag
from {{ source('energy_market', 'ENERGY_PRICE_INDICES') }}
where WA is not null
