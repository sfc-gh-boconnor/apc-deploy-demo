-- Mart: full costed BOM roll-up per finished product — material + conversion + overhead by level.
-- Co-authored with CoCo

with costed as (
    select * from {{ ref('int_bom_costed') }}
),

-- Roll up to root material level
product_rollup as (
    select
        root_material,
        plant_code,
        sum(case when cost_type = 'material' then total_component_cost_usd else 0 end)   as total_material_cost_usd,
        sum(case when cost_type = 'conversion' then total_component_cost_usd else 0 end) as total_conversion_cost_usd,
        sum(total_component_cost_usd)                                                     as bom_total_cost_usd,
        max(bom_level)                                                                    as max_bom_depth,
        count(distinct component_material)                                                as component_count
    from costed
    group by root_material, plant_code
),

-- Add material master attributes
enriched as (
    select
        pr.root_material     as material_number,
        mm.material_description,
        pr.plant_code,
        pl.plant_name,
        pr.total_material_cost_usd,
        pr.total_conversion_cost_usd,
        pr.bom_total_cost_usd,
        -- Overhead estimate: 15% of conversion (typical pharma)
        round(pr.total_conversion_cost_usd * 0.15, 2)  as estimated_overhead_usd,
        pr.bom_total_cost_usd
            + round(pr.total_conversion_cost_usd * 0.15, 2) as fully_loaded_cost_usd,
        pr.max_bom_depth,
        pr.component_count,
        round(100.0 * pr.total_material_cost_usd
              / nullif(pr.bom_total_cost_usd, 0), 1)    as material_pct,
        round(100.0 * pr.total_conversion_cost_usd
              / nullif(pr.bom_total_cost_usd, 0), 1)    as conversion_pct
    from product_rollup pr
    left join {{ ref('stg_material_master') }} mm
        on pr.root_material = mm.material_number
    left join {{ ref('stg_plant') }} pl
        on pr.plant_code = pl.plant_code
)

select * from enriched
