-- Staging: clean material-ledger posting line items.
--   * Drop incomplete postings (null amount).
--   * De-duplicate repeated extract rows on the document key (MANDT, BELNR, BUZEI).
--   * Trim trailing spaces on MATNR / WERKS, zero-pad the period, parse BUDAT.
-- Reversals (negative MENGE / BWART 102) are KEPT — they net out in aggregation.

with deduped as (
    select
        *,
        row_number() over (
            partition by MANDT, BELNR, BUZEI
            order by BUDAT
        ) as _rn
    from {{ source('sap_raw', 'MATERIAL_LEDGER_DOC') }}
    where DMBTR is not null
)

select
    trim(MATNR)                          as material_number,
    trim(WERKS)                          as plant_code,
    trim(BUKRS)                          as company_code,
    GJAHR                                as fiscal_year,
    lpad(POPER::varchar, 3, '0')         as period,
    cast(POPER as int)                   as period_int,
    trim(BWART)                          as movement_type,
    MENGE                                as quantity,
    DMBTR                                as amount_local,
    trim(WAERS)                          as local_currency,
    try_to_date(BUDAT, 'YYYYMMDD')       as posting_date
from deduped
where _rn = 1
