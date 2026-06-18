-- Test: BOM roll-up cost should be within 10% of FMC standard cost.
-- Co-authored with CoCo

select
    material_number,
    plant_code,
    fmc_standard_cost_usd,
    fully_loaded_cost_usd,
    cost_variance_pct,
    reconciliation_status
from {{ ref('mart_fmc_vs_bom') }}
where reconciliation_status = 'HIGH_VARIANCE'
  and fmc_standard_cost_usd > 0
  and fully_loaded_cost_usd > 0
