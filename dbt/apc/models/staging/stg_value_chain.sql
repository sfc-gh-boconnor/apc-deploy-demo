-- Staging: value chain configuration — site-to-site production flow (APO production data structure).
-- Co-authored with CoCo

select
    trim(MATNR)           as material_number,
    trim(LOCFR)           as source_plant,       -- manufacturing site
    trim(LOCTO)           as destination_plant,   -- receiving site
    PRESSION              as chain_step,          -- 1=API, 2=Formulation, 3=Packaging, 4=Distribution
    trim(PDSTYP)          as step_type,           -- MFG, PKG, QC, DIST
    trim(PDSTYP_DESC)     as step_description,
    coalesce(MARKUP_PCT, 0) as interco_markup_pct,  -- intercompany transfer price markup %
    coalesce(TRANSP_COST, 0) as transport_cost_per_unit,
    trim(WAERS)           as currency,
    DATEFROM::date        as valid_from,
    DATETO::date          as valid_to
from {{ source('sap_raw', 'VALUE_CHAIN_RAW') }}
where DATETO >= current_date() or DATETO is null  -- active chains only
