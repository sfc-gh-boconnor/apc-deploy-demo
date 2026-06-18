-- Test: APO planned volume should not deviate more than 20% from actual billing.
-- Co-authored with CoCo

select
    material_number,
    plant_code,
    fiscal_year,
    period,
    planned_production_qty,
    actual_billed_qty,
    plan_accuracy_pct,
    alignment_status
from {{ ref('int_volume_reconciliation') }}
where alignment_status = 'HIGH_DEVIATION'
