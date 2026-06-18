-- Mart: FMC reported cost vs BOM-exploded cost — variance highlights data quality gaps.
-- Co-authored with CoCo

with bom_cost as (
    select
        material_number,
        plant_code,
        bom_total_cost_usd,
        fully_loaded_cost_usd,
        component_count,
        max_bom_depth
    from {{ ref('mart_bom_cost_buildup') }}
),

-- Latest FMC cost (from the standard price in the existing pipeline)
fmc_cost as (
    select
        material_number,
        plant_code,
        standard_cost_per_unit  as fmc_standard_cost_usd
    from {{ ref('mart_product_cost') }}
    where fiscal_year = (select max(fiscal_year) from {{ ref('mart_product_cost') }})
    qualify row_number() over (
        partition by material_number, plant_code
        order by period desc
    ) = 1
),

comparison as (
    select
        coalesce(b.material_number, f.material_number) as material_number,
        coalesce(b.plant_code, f.plant_code)           as plant_code,
        f.fmc_standard_cost_usd,
        b.bom_total_cost_usd,
        b.fully_loaded_cost_usd,
        b.component_count,
        b.max_bom_depth,
        -- Variance: BOM build-up vs FMC reported
        round(coalesce(b.fully_loaded_cost_usd, 0)
              - coalesce(f.fmc_standard_cost_usd, 0), 2) as cost_variance_usd,
        round(100.0 * (coalesce(b.fully_loaded_cost_usd, 0)
                       - coalesce(f.fmc_standard_cost_usd, 0))
              / nullif(f.fmc_standard_cost_usd, 0), 1)   as cost_variance_pct,
        -- Gap classification
        case
            when b.bom_total_cost_usd is null then 'MISSING_BOM'
            when f.fmc_standard_cost_usd is null then 'MISSING_FMC'
            when abs(coalesce(b.fully_loaded_cost_usd, 0)
                     - coalesce(f.fmc_standard_cost_usd, 0))
                 / nullif(f.fmc_standard_cost_usd, 0) > 0.10 then 'HIGH_VARIANCE'
            when abs(coalesce(b.fully_loaded_cost_usd, 0)
                     - coalesce(f.fmc_standard_cost_usd, 0))
                 / nullif(f.fmc_standard_cost_usd, 0) > 0.05 then 'MEDIUM_VARIANCE'
            else 'RECONCILED'
        end as reconciliation_status
    from bom_cost b
    full outer join fmc_cost f
        on b.material_number = f.material_number
        and b.plant_code = f.plant_code
)

select * from comparison
