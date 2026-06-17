-- Staging: decode SAP FX rates (TCURR). Reverses the classic inverted GDATU date
-- and exposes a monthly FCURR -> USD rate. usd = local_amount * usd_per_unit.

select
    trim(FCURR)                                              as from_currency,
    trim(TCURR)                                              as to_currency,
    (99999999 - try_to_number(GDATU))                        as rate_date_int,
    floor((99999999 - try_to_number(GDATU)) / 10000)         as rate_year,
    floor(mod(99999999 - try_to_number(GDATU), 10000) / 100) as rate_month,
    UKURS                                                    as usd_per_unit
from {{ source('sap_raw', 'TCURR_RAW') }}
where trim(KURST) = 'M'
  and UKURS is not null
