-- Staging: clean material master. Trim trailing spaces from MATNR and decode the
-- SAP material-type code (MTART) via the material_type_map seed.

select
    trim(m.MATNR)                       as material_number,
    trim(m.MAKTX)                       as material_description,
    trim(m.MTART)                       as material_type_code,
    coalesce(t.material_type_desc, trim(m.MTART)) as material_type_desc,
    trim(m.MATKL)                       as material_group,
    trim(m.MEINS)                       as base_uom
from {{ source('sap_raw', 'MARA_RAW') }} m
left join {{ ref('material_type_map') }} t
       on trim(m.MTART) = t.mtart
