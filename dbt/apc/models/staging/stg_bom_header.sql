-- Staging: BOM header (STKO equivalent) — one row per BOM for each finished/semi-finished material.
-- Co-authored with CoCo

select
    trim(MATNR)          as material_number,
    trim(WERKS)          as plant_code,
    trim(STLNR)         as bom_number,
    trim(STLAN)         as bom_usage,          -- 1=Production, 2=Engineering
    DATEFROM::date       as valid_from,
    DATETO::date         as valid_to,
    trim(STLST)         as bom_status,         -- 01=Active, 02=Inactive
    BMENG                as base_quantity,
    trim(BMEIN)         as base_uom
from {{ source('sap_raw', 'STKO_RAW') }}
where trim(STLAN) = '1'  -- production BOMs only
  and trim(STLST) = '01' -- active only
