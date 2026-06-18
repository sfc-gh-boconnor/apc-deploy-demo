-- Test: every product with a value chain should have no missing steps (gaps in chain_step sequence).
-- Co-authored with CoCo

with chain_products as (
    select
        material_number,
        min(chain_step) as min_step,
        max(chain_step) as max_step,
        count(distinct chain_step) as actual_steps
    from {{ ref('stg_value_chain') }}
    group by material_number
)
select
    material_number,
    min_step,
    max_step,
    actual_steps,
    (max_step - min_step + 1) as expected_steps
from chain_products
where actual_steps < (max_step - min_step + 1)
