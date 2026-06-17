-- =============================================================================
-- AI Product Costing Accelerator — Data Engineering Layer (Dynamic Tables)
-- =============================================================================
-- Demonstrates a typical pharmaceutical data-engineering workflow in a Snowflake
-- Workspace: take RAW SAP BDC data products and engineer them into
-- analysis-ready tables using a medallion pipeline built on DYNAMIC TABLES.
--
--   RAW  ({{ database }}.SAP_BDC)  ──►  STAGING  ──►  CURATED  ──►  MART
--   (SAP-named tables)         (cleaned)     (business     (aggregated,
--                                             logic)        analysis-ready)
--                                               └─► DQ (data quality checks)
--
-- Dynamic Tables auto-refresh on a declared TARGET_LAG and chain together via
-- TARGET_LAG = 'DOWNSTREAM', so the whole pipeline stays fresh with no
-- orchestration code, no tasks, no streams.
--
-- Run AFTER 01_setup.sql + 02_synthetic_data.sql (raw SAP_BDC must be populated).
-- Run with:  snow sql -c <connection> -f sql/08_data_engineering.sql
-- =============================================================================

USE DATABASE {{ database }};
CREATE SCHEMA IF NOT EXISTS {{ database }}.ENGINEERING
  COMMENT = 'Engineered medallion layer (staging/curated/mart) built on Dynamic Tables.';
USE SCHEMA {{ database }}.ENGINEERING;

-- =============================================================================
-- STAGING LAYER — clean + conform raw SAP tables
-- =============================================================================
-- Standardise keys (trim, zero-pad periods), filter incomplete rows, and rename
-- cryptic SAP fields to business-friendly columns. INCREMENTAL refresh means
-- only changed raw rows are reprocessed.

CREATE OR REPLACE DYNAMIC TABLE STG_MATERIAL_LEDGER
  TARGET_LAG   = '1 hour'
  WAREHOUSE    = {{ warehouse }}
  REFRESH_MODE = INCREMENTAL
  INITIALIZE   = ON_CREATE
  COMMENT      = 'Staging: cleaned CKMLCR material-ledger period actuals (standard vs actual cost per material/plant/period).'
AS
SELECT
    TRIM(ml.MATNR)                          AS MATERIAL_NUMBER,
    TRIM(ml.BWKEY)                          AS PLANT_CODE,
    ml.GJAHR                                AS FISCAL_YEAR,
    LPAD(ml.POPER, 3, '0')                  AS PERIOD,
    'P' || LPAD(ml.POPER, 3, '0')           AS PERIOD_LABEL,
    ml.STPRS                                AS STANDARD_COST,
    ml.PVPRS                                AS ACTUAL_COST,
    ml.MLBWP1                               AS MATERIAL_PRICE_VARIANCE,
    ml.MLBWP2                               AS OVERHEAD_VARIANCE,
    ml.LBKUM                                AS STOCK_VALUE,
    COALESCE(ml.CURRENCY, 'GBP')            AS CURRENCY
FROM {{ database }}.SAP_BDC.MATERIAL_LEDGER ml
WHERE ml.PVPRS IS NOT NULL
  AND ml.STPRS IS NOT NULL;

CREATE OR REPLACE DYNAMIC TABLE STG_COST_COMPONENTS
  TARGET_LAG   = '1 hour'
  WAREHOUSE    = {{ warehouse }}
  REFRESH_MODE = INCREMENTAL
  INITIALIZE   = ON_CREATE
  COMMENT      = 'Staging: cleaned cost component split (KEPH/CKMLCR) — standard vs actual by cost component.'
AS
SELECT
    TRIM(cs.MATNR)                          AS MATERIAL_NUMBER,
    TRIM(cs.WERKS)                          AS PLANT_CODE,
    cs.GJAHR                                AS FISCAL_YEAR,
    LPAD(cs.POPER, 3, '0')                  AS PERIOD,
    INITCAP(TRIM(cs.COST_COMPONENT))        AS COST_COMPONENT,
    cs.STANDARD_COST,
    cs.ACTUAL_COST,
    COALESCE(cs.CURRENCY, 'GBP')            AS CURRENCY
FROM {{ database }}.SAP_BDC.COST_COMPONENT_SPLIT cs
WHERE cs.STANDARD_COST IS NOT NULL;

-- =============================================================================
-- CURATED LAYER — business logic + enrichment
-- =============================================================================
-- Join staging to master data (material + plant), compute variances, and add a
-- business variance flag. TARGET_LAG = 'DOWNSTREAM' means this table refreshes
-- automatically whenever its upstream staging tables refresh — no schedule to
-- maintain.

CREATE OR REPLACE DYNAMIC TABLE CURATED_PRODUCT_COST
  TARGET_LAG   = 'DOWNSTREAM'
  WAREHOUSE    = {{ warehouse }}
  REFRESH_MODE = INCREMENTAL
  INITIALIZE   = ON_CREATE
  COMMENT      = 'Curated: enriched product cost variance per material/plant/period, with business variance flag.'
AS
SELECT
    s.MATERIAL_NUMBER,
    m.MAKTX                                 AS MATERIAL_DESCRIPTION,
    m.MTART                                 AS MATERIAL_TYPE,
    m.MATKL                                 AS MATERIAL_GROUP,
    s.PLANT_CODE,
    p.NAME1                                 AS PLANT_NAME,
    p.LAND1                                 AS COUNTRY,
    s.FISCAL_YEAR,
    s.PERIOD,
    s.PERIOD_LABEL,
    s.STANDARD_COST,
    s.ACTUAL_COST,
    s.ACTUAL_COST - s.STANDARD_COST         AS COST_VARIANCE_ABS,
    ROUND((s.ACTUAL_COST - s.STANDARD_COST)
          / NULLIF(s.STANDARD_COST, 0) * 100, 2) AS COST_VARIANCE_PCT,
    CASE
        WHEN ABS((s.ACTUAL_COST - s.STANDARD_COST)
                 / NULLIF(s.STANDARD_COST, 0) * 100) > 5 THEN 'HIGH'
        WHEN ABS((s.ACTUAL_COST - s.STANDARD_COST)
                 / NULLIF(s.STANDARD_COST, 0) * 100) > 2 THEN 'MEDIUM'
        ELSE 'LOW'
    END                                     AS VARIANCE_FLAG,
    s.CURRENCY
FROM STG_MATERIAL_LEDGER s
JOIN {{ database }}.SAP_BDC.MATERIAL_MASTER m ON s.MATERIAL_NUMBER = m.MATNR
JOIN {{ database }}.SAP_BDC.PLANT_MASTER    p ON s.PLANT_CODE      = p.WERKS;

-- =============================================================================
-- MART LAYER — aggregated, analysis-ready
-- =============================================================================
-- Portfolio view aggregated to material x period across all sites. This is the
-- table an analyst, BI tool, or semantic model would query.

CREATE OR REPLACE DYNAMIC TABLE MART_PRODUCT_COST_MONTHLY
  TARGET_LAG   = 'DOWNSTREAM'
  WAREHOUSE    = {{ warehouse }}
  REFRESH_MODE = AUTO
  INITIALIZE   = ON_CREATE
  COMMENT      = 'Mart: analysis-ready product cost summary aggregated to material x period across all plants.'
AS
SELECT
    MATERIAL_NUMBER,
    MATERIAL_DESCRIPTION,
    MATERIAL_TYPE,
    FISCAL_YEAR,
    PERIOD,
    PERIOD_LABEL,
    COUNT(DISTINCT PLANT_CODE)              AS PLANT_COUNT,
    ROUND(AVG(STANDARD_COST), 2)            AS AVG_STANDARD_COST,
    ROUND(AVG(ACTUAL_COST), 2)              AS AVG_ACTUAL_COST,
    ROUND(AVG(COST_VARIANCE_PCT), 2)        AS AVG_VARIANCE_PCT,
    ROUND(MAX(COST_VARIANCE_PCT), 2)        AS MAX_VARIANCE_PCT,
    SUM(CASE WHEN VARIANCE_FLAG = 'HIGH' THEN 1 ELSE 0 END) AS HIGH_VARIANCE_PLANTS
FROM CURATED_PRODUCT_COST
GROUP BY MATERIAL_NUMBER, MATERIAL_DESCRIPTION, MATERIAL_TYPE,
         FISCAL_YEAR, PERIOD, PERIOD_LABEL;

-- =============================================================================
-- DATA QUALITY LAYER — automated checks over the curated data
-- =============================================================================
-- A single DT that returns one row per check with a FAIL_ROWS count. Any row
-- with FAIL_ROWS > 0 is an exception the engineer should investigate. FULL
-- refresh because it scans the whole curated table with UNION ALL.

CREATE OR REPLACE DYNAMIC TABLE DQ_PRODUCT_COST_CHECKS
  TARGET_LAG   = 'DOWNSTREAM'
  WAREHOUSE    = {{ warehouse }}
  REFRESH_MODE = FULL
  INITIALIZE   = ON_CREATE
  COMMENT      = 'Data quality: one row per rule; FAIL_ROWS > 0 indicates an exception in the curated layer.'
AS
SELECT 'null_standard_cost'        AS CHECK_NAME,
       'Curated rows with NULL standard cost'                 AS DESCRIPTION,
       COUNT(*)                    AS FAIL_ROWS
FROM CURATED_PRODUCT_COST WHERE STANDARD_COST IS NULL
UNION ALL
SELECT 'negative_actual_cost',
       'Curated rows with negative actual cost',
       COUNT(*)
FROM CURATED_PRODUCT_COST WHERE ACTUAL_COST < 0
UNION ALL
SELECT 'extreme_variance_gt_50pct',
       'Curated rows with absolute variance over 50%',
       COUNT(*)
FROM CURATED_PRODUCT_COST WHERE ABS(COST_VARIANCE_PCT) > 50
UNION ALL
SELECT 'orphan_material_no_master',
       'Ledger rows with no matching material master record',
       COUNT(*)
FROM STG_MATERIAL_LEDGER s
LEFT JOIN {{ database }}.SAP_BDC.MATERIAL_MASTER m ON s.MATERIAL_NUMBER = m.MATNR
WHERE m.MATNR IS NULL;

-- =============================================================================
-- MONITORING — verify the pipeline (run these after creation)
-- =============================================================================
-- Row counts at each layer:
--   SELECT 'STG_MATERIAL_LEDGER' lyr, COUNT(*) rows FROM STG_MATERIAL_LEDGER
--   UNION ALL SELECT 'CURATED_PRODUCT_COST', COUNT(*) FROM CURATED_PRODUCT_COST
--   UNION ALL SELECT 'MART_PRODUCT_COST_MONTHLY', COUNT(*) FROM MART_PRODUCT_COST_MONTHLY;
--
-- Refresh history (state, duration, incremental vs full):
--   SELECT NAME, STATE, REFRESH_ACTION, DATA_TIMESTAMP, REFRESH_START_TIME,
--          REFRESH_END_TIME
--   FROM TABLE(INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY())
--   WHERE SCHEMA_NAME = 'ENGINEERING'
--   ORDER BY REFRESH_START_TIME DESC;
--
-- Dependency graph (lag, scheduling state, target lag type):
--   SELECT * FROM TABLE(INFORMATION_SCHEMA.DYNAMIC_TABLE_GRAPH_HISTORY());
--
-- Outstanding data quality exceptions:
--   SELECT * FROM DQ_PRODUCT_COST_CHECKS WHERE FAIL_ROWS > 0;
--
-- Force an immediate refresh of the whole chain (normally automatic):
--   ALTER DYNAMIC TABLE MART_PRODUCT_COST_MONTHLY REFRESH;
-- =============================================================================
