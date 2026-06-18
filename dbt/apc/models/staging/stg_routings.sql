-- Staging: production routings (PLKO/PLPO equivalent) — operations, work centres, activity types.
-- Co-authored with CoCo

select
    trim(MATNR)          as material_number,
    trim(WERKS)          as plant_code,
    trim(PLNTY)         as routing_type,       -- N=Standard, R=Reference
    PLNNR                as routing_number,
    VORNR                as operation_number,
    trim(ARBPL)         as work_centre,
    trim(KOSTL)         as cost_centre,
    trim(LTXA1)         as operation_desc,
    -- SAP stores up to 6 activity types per operation
    trim(LAR01)         as activity_type_1,
    VGW01                as activity_qty_1,     -- e.g. machine hours
    trim(VGE01)         as activity_uom_1,
    trim(LAR02)         as activity_type_2,
    VGW02                as activity_qty_2,     -- e.g. labour hours
    trim(VGE02)         as activity_uom_2,
    BMSCH                as base_quantity,
    trim(MEINH)         as base_uom
from {{ source('sap_raw', 'PLPO_RAW') }}
where trim(LOEKZ) is null or trim(LOEKZ) = ''  -- not deleted
