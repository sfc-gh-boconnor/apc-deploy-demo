-- Staging: cost centre activity rates (KSPI/KP26 equivalent) — planned rate per activity type.
-- Co-authored with CoCo

select
    trim(KOSTL)          as cost_centre,
    trim(LSTAR)          as activity_type,
    GJAHR                as fiscal_year,
    trim(WERKS)          as plant_code,
    TARKZ                as rate_type,          -- 1=Plan, 4=Actual
    LST001               as fixed_rate,         -- fixed portion $/activity unit
    LST002               as variable_rate,      -- variable portion $/activity unit
    LST001 + LST002      as total_rate,
    trim(WAERS)          as currency
from {{ source('sap_raw', 'KSPI_RAW') }}
where TARKZ in (1, 4)  -- plan and actual rates
