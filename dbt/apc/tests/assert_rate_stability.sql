-- Test: activity rates should not shift more than 15% year-over-year.
-- Co-authored with CoCo

select
    cost_centre,
    activity_type,
    plant_code,
    fiscal_year,
    current_rate,
    prior_rate,
    rate_change_pct,
    stability_status
from {{ ref('int_activity_rate_validation') }}
where stability_status = 'UNSTABLE'
