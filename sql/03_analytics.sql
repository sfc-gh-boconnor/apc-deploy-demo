-- =============================================================================
-- AI Product Costing Accelerator — Analytics Layer
-- =============================================================================
-- Creates the semantic view and Cortex Agent over the SAP BDC schema.
-- Run AFTER 01_setup.sql and 02_synthetic_data.sql.
-- =============================================================================

USE DATABASE {{ database }};
USE SCHEMA {{ database }}.ANALYTICS;

-- ── Product Costing Summary View ──────────────────────────────────────────────
CREATE OR REPLACE VIEW PRODUCT_COST_SUMMARY AS
SELECT
    ml.BWKEY                                            AS PLANT_CODE,
    p.NAME1                                             AS PLANT_NAME,
    p.LAND1                                             AS COUNTRY,
    ml.MATNR                                            AS MATERIAL_NUMBER,
    m.MAKTX                                             AS MATERIAL_DESCRIPTION,
    m.MTART                                             AS MATERIAL_TYPE,
    m.MATKL                                             AS MATERIAL_GROUP,
    ml.GJAHR                                            AS FISCAL_YEAR,
    ml.POPER                                            AS PERIOD,
    CONCAT(ml.GJAHR, '-P', ml.POPER)                   AS YEAR_PERIOD,
    ml.STPRS                                            AS STANDARD_COST_PER_UNIT,
    ml.PVPRS                                            AS ACTUAL_COST_PER_UNIT,
    b.BUDGET_COST                                       AS BUDGET_COST_PER_UNIT,
    ml.PVPRS - ml.STPRS                                AS COST_VARIANCE_ABS,
    ROUND((ml.PVPRS - ml.STPRS) / NULLIF(ml.STPRS, 0) * 100, 2) AS COST_VARIANCE_PCT,
    ml.PVPRS - b.BUDGET_COST                            AS BUDGET_VARIANCE_ABS,
    ROUND((ml.PVPRS - b.BUDGET_COST) / NULLIF(b.BUDGET_COST, 0) * 100, 2) AS BUDGET_VARIANCE_PCT,
    ml.MLBWP1                                           AS MATERIAL_PRICE_VARIANCE,
    ml.MLBWP2                                           AS OVERHEAD_VARIANCE,
    ml.LBKUM                                            AS TOTAL_STOCK_VALUE,
    ml.CURRENCY
FROM {{ database }}.SAP_BDC.MATERIAL_LEDGER ml
JOIN {{ database }}.SAP_BDC.MATERIAL_MASTER m  ON ml.MATNR = m.MATNR
JOIN {{ database }}.SAP_BDC.PLANT_MASTER    p  ON ml.BWKEY = p.WERKS
LEFT JOIN {{ database }}.SAP_BDC.COST_BUDGET b
       ON ml.MATNR = b.MATNR AND ml.BWKEY = b.BWKEY
      AND ml.GJAHR = b.GJAHR AND ml.POPER = b.POPER;

-- ── Cost Component Detail View ────────────────────────────────────────────────
CREATE OR REPLACE VIEW COST_COMPONENT_DETAIL AS
SELECT
    cs.MATNR                                            AS MATERIAL_NUMBER,
    m.MAKTX                                             AS MATERIAL_DESCRIPTION,
    m.MTART                                             AS MATERIAL_TYPE,
    cs.WERKS                                            AS PLANT_CODE,
    p.NAME1                                             AS PLANT_NAME,
    p.LAND1                                             AS COUNTRY,
    cs.GJAHR                                            AS FISCAL_YEAR,
    cs.POPER                                            AS PERIOD,
    cs.COST_COMPONENT,
    cs.STANDARD_COST,
    cs.ACTUAL_COST,
    cs.ACTUAL_COST - cs.STANDARD_COST                  AS COMPONENT_VARIANCE,
    ROUND((cs.ACTUAL_COST - cs.STANDARD_COST) / NULLIF(cs.STANDARD_COST, 0) * 100, 2) AS COMPONENT_VARIANCE_PCT,
    cs.CURRENCY
FROM {{ database }}.SAP_BDC.COST_COMPONENT_SPLIT cs
JOIN {{ database }}.SAP_BDC.MATERIAL_MASTER m  ON cs.MATNR = m.MATNR
JOIN {{ database }}.SAP_BDC.PLANT_MASTER    p  ON cs.WERKS = p.WERKS;

-- ── Cortex Search Service (optional — for semantic search) ───────────────────
-- Uncomment to enable after views are created:
-- CREATE OR REPLACE CORTEX SEARCH SERVICE {{ database }}.ANALYTICS.APC_SEARCH
--   ON MATERIAL_DESCRIPTION
--   WAREHOUSE = APC_DEPLOY_WH
--   TARGET_LAG = '1 hour'
-- AS (
--     SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, MATERIAL_TYPE,
--            PLANT_CODE, PLANT_NAME, COUNTRY, FISCAL_YEAR, PERIOD,
--            STANDARD_COST_PER_UNIT, ACTUAL_COST_PER_UNIT,
--            COST_VARIANCE_ABS, COST_VARIANCE_PCT
--     FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
-- );

-- ── Semantic View ─────────────────────────────────────────────────────────────
-- Created separately via APC_SV.yaml (see root of repo)
