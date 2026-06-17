-- Mart: cost summary aggregated to material x period across all plants.

select
    material_number,
    material_description,
    material_type,
    fiscal_year,
    period,
    count(distinct plant_code)                              as plant_count,
    round(avg(standard_cost_per_unit), 2)                   as avg_standard_cost,
    round(avg(actual_cost_per_unit), 2)                     as avg_actual_cost,
    round(avg(budget_cost_per_unit), 2)                     as avg_budget_cost,
    round(avg(cost_variance_pct), 2)                        as avg_variance_pct,
    round(max(cost_variance_pct), 2)                        as max_variance_pct,
    sum(case when variance_flag = 'HIGH' then 1 else 0 end) as high_variance_plants
from {{ ref('mart_product_cost') }}
group by
    material_number,
    material_description,
    material_type,
    fiscal_year,
    period
