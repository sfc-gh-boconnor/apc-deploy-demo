-- Staging: clean effective-dated standard prices (MBEW), in local currency.
-- One row per material x plant x valid-from; the valid-from year is used later
-- to pick the standard in force for each fiscal year.

select
    trim(MATNR)                          as material_number,
    trim(BWKEY)                          as plant_code,
    STPRS                                as standard_price_local,
    coalesce(PEINH, 1)                   as price_unit,
    trim(WAERS)                          as local_currency,
    try_to_date(VALID_FROM, 'YYYYMMDD')  as valid_from,
    year(try_to_date(VALID_FROM, 'YYYYMMDD')) as valid_from_year
from {{ source('sap_raw', 'MBEW_RAW') }}
where STPRS is not null
