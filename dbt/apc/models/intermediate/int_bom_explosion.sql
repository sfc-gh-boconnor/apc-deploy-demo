-- Intermediate: recursive multi-level BOM explosion with cumulative quantities and scrap.
-- Co-authored with CoCo

with recursive bom_tree as (
    -- Level 0: finished goods (anchor)
    select
        h.material_number   as root_material,
        h.plant_code,
        h.material_number   as parent_material,
        i.component_material,
        i.component_qty / nullif(h.base_quantity, 0)  as qty_per_parent,
        i.scrap_pct,
        -- Effective qty = qty_per * (1 + scrap/100) to account for scrap allowance
        (i.component_qty / nullif(h.base_quantity, 0))
            * (1 + i.scrap_pct / 100.0)              as effective_qty_per,
        1                                              as bom_level,
        i.item_category
    from {{ ref('stg_bom_header') }} h
    join {{ ref('stg_bom_items') }} i
        on h.bom_number = i.bom_number
    where h.material_number in (
        select material_number
        from {{ ref('stg_material_master') }}
        where material_type_code = 'FERT'
    )

    union all

    -- Recursive: explode sub-assemblies (HALB → ROH)
    select
        bt.root_material,
        bt.plant_code,
        bt.component_material  as parent_material,
        i.component_material,
        bt.effective_qty_per * (i.component_qty / nullif(h.base_quantity, 0))  as qty_per_parent,
        i.scrap_pct,
        bt.effective_qty_per
            * (i.component_qty / nullif(h.base_quantity, 0))
            * (1 + i.scrap_pct / 100.0)  as effective_qty_per,
        bt.bom_level + 1               as bom_level,
        i.item_category
    from bom_tree bt
    join {{ ref('stg_bom_header') }} h
        on bt.component_material = h.material_number
        and bt.plant_code = h.plant_code
    join {{ ref('stg_bom_items') }} i
        on h.bom_number = i.bom_number
    where bt.bom_level < 10  -- safety: max 10 levels
)

select
    root_material,
    plant_code,
    parent_material,
    component_material,
    mm.material_type_code  as component_type,
    mm.material_description as component_description,
    bom_level,
    qty_per_parent,
    scrap_pct,
    effective_qty_per,
    item_category
from bom_tree bt
left join {{ ref('stg_material_master') }} mm
    on bt.component_material = mm.material_number
