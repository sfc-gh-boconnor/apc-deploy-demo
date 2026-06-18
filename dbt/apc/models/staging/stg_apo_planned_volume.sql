-- Staging: APO/IBP demand plan extract — planned production + commercial forecast volumes.
-- Co-authored with CoCo

select
    trim(MATNR)          as material_number,
    trim(WERKS)          as plant_code,
    GJAHR                as fiscal_year,
    POPER                as period,
    PLNMG                as planned_production_qty,   -- APO production plan
    CFMNG                as confirmed_qty,            -- confirmed/committed
    FCMNG                as commercial_forecast_qty,  -- S&OP / demand plan
    trim(VERSN)          as plan_version,             -- 000=Active, 001=Simulation
    trim(MEINS)          as uom
from {{ source('sap_raw', 'APO_DEMAND_RAW') }}
where trim(VERSN) = '000'  -- active plan version only
