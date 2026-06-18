-- Staging: BOM line items (STPO equivalent) — components, quantities, scrap allowances.
-- Co-authored with CoCo

select
    trim(STLNR)         as bom_number,
    POSNR                as item_number,
    trim(IDNRK)         as component_material,
    trim(POSTP)         as item_category,      -- L=Stock, R=Variable-size, T=Text
    MENGE                as component_qty,      -- quantity per base qty of parent
    trim(MEINS)         as component_uom,
    coalesce(AUSCH, 0)  as scrap_pct,          -- assembly scrap %
    coalesce(KZAUS, 0)  as co_product_flag,    -- 1 = co-product/by-product
    trim(POTX1)         as item_text
from {{ source('sap_raw', 'STPO_RAW') }}
where trim(POSTP) in ('L', 'R')  -- stock items only (exclude text items)
