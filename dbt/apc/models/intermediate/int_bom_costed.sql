-- Intermediate: costed BOM — material cost + conversion cost per component at each level.
-- Co-authored with CoCo

with exploded as (
    select * from {{ ref('int_bom_explosion') }}
),

-- Material cost: standard price of each leaf component × effective qty
material_costs as (
    select
        e.root_material,
        e.plant_code,
        e.component_material,
        e.bom_level,
        e.effective_qty_per,
        sp.standard_price_local,
        fx.usd_per_unit,
        e.effective_qty_per * sp.standard_price_local * coalesce(fx.usd_per_unit, 1) as material_cost_usd
    from exploded e
    left join {{ ref('stg_standard_price') }} sp
        on e.component_material = sp.material_number
        and e.plant_code = sp.plant_code
    left join {{ ref('stg_plant') }} p
        on e.plant_code = p.plant_code
    left join {{ ref('stg_fx_rates') }} fx
        on p.local_currency = fx.from_currency
    where e.component_type in ('ROH', 'HALB')  -- raw + semi-finished
),

-- Conversion cost: sum ALL routing operations per material/plant into one total
-- (each product has multiple operations — Dispensing, Granulation, Forming, Packaging)
routing_op_costs as (
    select
        r.material_number,
        r.plant_code,
        sum(
            coalesce(r.activity_qty_1 / nullif(r.base_quantity, 0) * ar.total_rate, 0)
            + coalesce(r.activity_qty_2 / nullif(r.base_quantity, 0) * ar2.total_rate, 0)
        ) as total_conversion_cost_local
    from {{ ref('stg_routings') }} r
    left join {{ ref('stg_activity_rates') }} ar
        on r.cost_centre = ar.cost_centre
        and r.activity_type_1 = ar.activity_type
        and ar.rate_type = 1  -- plan rate
    left join {{ ref('stg_activity_rates') }} ar2
        on r.cost_centre = ar2.cost_centre
        and r.activity_type_2 = ar2.activity_type
        and ar2.rate_type = 1
    group by r.material_number, r.plant_code
),

-- One conversion cost per root material × plant (FX-converted)
conversion_costs as (
    select distinct
        e.root_material,
        e.plant_code,
        rc.total_conversion_cost_local,
        rc.total_conversion_cost_local * coalesce(fx.usd_per_unit, 1) as conversion_cost_usd
    from exploded e
    join routing_op_costs rc
        on e.root_material = rc.material_number
        and e.plant_code = rc.plant_code
    left join {{ ref('stg_plant') }} p
        on e.plant_code = p.plant_code
    left join {{ ref('stg_fx_rates') }} fx
        on p.local_currency = fx.from_currency
)

-- Material costs (one row per component)
select
    mc.root_material,
    mc.plant_code,
    mc.component_material,
    mc.bom_level,
    mc.effective_qty_per,
    mc.material_cost_usd,
    0 as conversion_cost_usd,
    mc.material_cost_usd as total_component_cost_usd,
    'material'  as cost_type
from material_costs mc

union all

-- Single conversion cost row per finished product (total of all routing operations)
select
    cc.root_material,
    cc.plant_code,
    cc.root_material as component_material,
    0 as bom_level,
    null as effective_qty_per,
    0 as material_cost_usd,
    cc.conversion_cost_usd,
    cc.conversion_cost_usd as total_component_cost_usd,
    'conversion' as cost_type
from conversion_costs cc
where cc.conversion_cost_usd > 0
