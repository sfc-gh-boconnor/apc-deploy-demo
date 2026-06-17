-- Mart: product risk scores — FY2026 H1 variance trajectory (slope P001->P006)
-- and next-period projection. Parity with {{ var('database', 'APC_DEPLOY_DB') }}.ANALYTICS.PRODUCT_RISK_SCORES.

with trend as (
    select
        MATERIAL_NUMBER,
        MATERIAL_DESCRIPTION,
        max(case when PERIOD = '001' then COST_VARIANCE_PCT end) as var_p001,
        max(case when PERIOD = '003' then COST_VARIANCE_PCT end) as var_p003,
        max(case when PERIOD = '006' then COST_VARIANCE_PCT end) as var_p006
    from {{ ref('mart_product_cost') }}
    where FISCAL_YEAR = 2026 and MATERIAL_TYPE = 'FERT'
    group by 1, 2
)

select
    MATERIAL_NUMBER,
    MATERIAL_DESCRIPTION,
    round(var_p001, 2)                              as VAR_P001,
    round(var_p003, 2)                              as VAR_P003,
    round(var_p006, 2)                              as VAR_P006,
    round((var_p006 - var_p001) / 5, 2)             as SLOPE,
    round(var_p006 + (var_p006 - var_p001) / 5, 2)  as ESTIMATED_P007,
    case
        when var_p006 > 8 or (var_p006 + (var_p006 - var_p001) / 5) > 10 then 'HIGH'
        when var_p006 > 5 or (var_p006 + (var_p006 - var_p001) / 5) > 7  then 'MEDIUM'
        else 'LOW'
    end                                             as RISK_LEVEL
from trend
