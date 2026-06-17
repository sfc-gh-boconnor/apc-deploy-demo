-- Staging: clean SD billing line items (VBRP/VBRK) — revenue per material/market/period.

select
    trim(MATNR)                  as material_number,
    trim(WERKS)                  as plant_code,
    trim(MARKET)                 as market,
    lpad(POPER, 3, '0')          as period,
    GJAHR                        as fiscal_year,
    FKMNG                        as billed_qty,
    NETPR                        as net_price,
    NETWR                        as net_revenue,
    coalesce(CURRENCY, 'USD')    as currency
from {{ source('sap_bdc', 'SD_BILLING') }}
where NETWR is not null
