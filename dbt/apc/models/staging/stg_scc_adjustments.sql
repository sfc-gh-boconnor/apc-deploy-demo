-- Staging: SCC manual adjustments from SOAR — value chain markups, allocations, corrections.
-- Co-authored with CoCo

select
    trim(MATNR)           as material_number,
    trim(WERKS)           as plant_code,
    GJAHR                 as fiscal_year,
    POPER                 as period,
    trim(ADJ_TYPE)        as adjustment_type,     -- TP_MARKUP, ALLOC, REVAL, MANUAL
    trim(ADJ_REASON)      as adjustment_reason,
    ADJ_AMOUNT            as adjustment_amount,
    trim(WAERS)           as currency,
    trim(APPROVED_BY)     as approved_by,
    APPROVED_DATE::date   as approved_date,
    trim(STATUS)          as status               -- POSTED, PENDING, REVERSED
from {{ source('sap_raw', 'SCC_ADJUSTMENTS_RAW') }}
where trim(STATUS) = 'POSTED'  -- only posted adjustments
