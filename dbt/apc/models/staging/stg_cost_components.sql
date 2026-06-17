-- Staging: clean KEPH cost component split. Decode the coded element number to a
-- business label (cost_component_map seed); zero-pad the period. Values are in
-- local currency (converted to USD downstream). Carries standard (S) + actual (A).

select
    trim(k.MATNR)                        as material_number,
    trim(k.WERKS)                        as plant_code,
    k.GJAHR                              as fiscal_year,
    lpad(k.POPER::varchar, 3, '0')       as period,
    cast(k.POPER as int)                 as period_int,
    k.ELEMENT                            as element,
    cm.cost_component,
    trim(k.RECTYPE)                      as record_type,
    k.WERTN                              as value_local,
    trim(k.WAERS)                        as local_currency
from {{ source('sap_raw', 'KEPH_RAW') }} k
left join {{ ref('cost_component_map') }} cm
       on k.ELEMENT = cm.element
where k.WERTN is not null
