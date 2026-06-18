-- Test: every FERT (finished product) should have at least one BOM component.
-- Co-authored with CoCo

select
    mm.material_number,
    mm.material_description
from {{ ref('stg_material_master') }} mm
left join {{ ref('int_bom_explosion') }} bom
    on mm.material_number = bom.root_material
where mm.material_type_code = 'FERT'
  and bom.root_material is null
