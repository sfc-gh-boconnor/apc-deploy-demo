-- =============================================================================
-- AI Product Costing Accelerator — Snowflake Setup
-- =============================================================================
-- Simulates what SAP BDC Connect surfaces as a Catalog-Linked Database.
-- Table and field names match real SAP BDC data products so the demo
-- illustrates the actual integration pattern.
--
-- Run with:  snow sql -c <connection> -f sql/01_setup.sql
-- =============================================================================

-- ── Database + schema ─────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS {{ database }};
CREATE SCHEMA  IF NOT EXISTS {{ database }}.SAP_BDC;    -- simulates SAP BDC Connect CLD
CREATE SCHEMA  IF NOT EXISTS {{ database }}.ANALYTICS;   -- semantic layer + agent
USE DATABASE {{ database }};

-- ── Warehouse ─────────────────────────────────────────────────────────────────
CREATE WAREHOUSE IF NOT EXISTS {{ warehouse }}
  WAREHOUSE_SIZE = '{{ warehouse_size }}'
  AUTO_SUSPEND   = 60
  AUTO_RESUME    = TRUE
  INITIALLY_SUSPENDED = TRUE;

-- ── Stage for semantic model YAML ────────────────────────────────────────────
-- Stores APC_SV.yaml for Cortex Analyst Q&A in the Ask Cortex AI tab.
CREATE STAGE IF NOT EXISTS {{ database }}.ANALYTICS.APC_DEPLOY_STAGE
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');

-- ── File format for stage uploads ───────────────────────────────────────────
-- Used by the deploy skill to COPY INTO @stage from temp tables.
-- Preserves file content exactly (no CSV quoting, no escape chars, no enclosure).
CREATE FILE FORMAT IF NOT EXISTS {{ database }}.ANALYTICS.APC_RAW_TEXT_FF
  TYPE = CSV
  FIELD_DELIMITER = NONE
  COMPRESSION = NONE
  ESCAPE_UNENCLOSED_FIELD = NONE
  FIELD_OPTIONALLY_ENCLOSED_BY = NONE;

-- NOTE: Snowflake App Runtime uses SYSTEM_COMPUTE_POOL_CPU automatically.
-- No image repository or compute pool setup required.

-- =============================================================================
-- SAP BDC SCHEMA — simulates data products exposed by SAP Business Data Cloud
-- via zero-copy integration (no ETL, no data movement)
-- =============================================================================
USE SCHEMA {{ database }}.SAP_BDC;

-- ── T001W — Plant Master ──────────────────────────────────────────────────────
-- SAP table: Plants/Branches. One row per manufacturing site.
CREATE OR REPLACE TABLE PLANT_MASTER (
    WERKS   VARCHAR(4)   NOT NULL COMMENT 'Plant code (SAP: WERKS)',
    NAME1   VARCHAR(100) NOT NULL COMMENT 'Plant name (SAP: NAME1)',
    LAND1   VARCHAR(3)   NOT NULL COMMENT 'Country code (SAP: LAND1)',
    ORT01   VARCHAR(50)           COMMENT 'City (SAP: ORT01)',
    REGIO   VARCHAR(3)            COMMENT 'Region/state (SAP: REGIO)',
    PRIMARY KEY (WERKS)
) COMMENT = 'SAP BDC: Plant master data (T001W). Sourced via SAP BDC Connect — zero-copy, no ETL.';

-- ── MARA — Material Master (General) ─────────────────────────────────────────
CREATE OR REPLACE TABLE MATERIAL_MASTER (
    MATNR   VARCHAR(18)  NOT NULL COMMENT 'Material number (SAP: MATNR)',
    MAKTX   VARCHAR(100)          COMMENT 'Material description (SAP: MAKTX)',
    MTART   VARCHAR(4)   NOT NULL COMMENT 'Material type: FERT=finished, HALB=semi-finished, ROH=raw (SAP: MTART)',
    MATKL   VARCHAR(9)            COMMENT 'Material group (SAP: MATKL)',
    MEINS   VARCHAR(3)            COMMENT 'Base unit of measure (SAP: MEINS)',
    BRGEW   FLOAT                 COMMENT 'Gross weight kg (SAP: BRGEW)',
    PRIMARY KEY (MATNR)
) COMMENT = 'SAP BDC: Material master general data (MARA). Sourced via SAP BDC Connect.';

-- ── MBEW — Material Valuation ─────────────────────────────────────────────────
-- Standard price and moving average price per material per plant.
CREATE OR REPLACE TABLE MATERIAL_VALUATION (
    MATNR   VARCHAR(18)  NOT NULL COMMENT 'Material number (SAP: MATNR)',
    BWKEY   VARCHAR(4)   NOT NULL COMMENT 'Valuation area = Plant (SAP: BWKEY)',
    BWTAR   VARCHAR(10)           COMMENT 'Valuation type (SAP: BWTAR)',
    STPRS   FLOAT        NOT NULL COMMENT 'Standard price (SAP: STPRS)',
    VERPR   FLOAT                 COMMENT 'Moving average price (SAP: VERPR)',
    PEINH   INTEGER               COMMENT 'Price unit (SAP: PEINH)',
    BKLAS   VARCHAR(4)            COMMENT 'Valuation class (SAP: BKLAS)',
    LAEPR   DATE                  COMMENT 'Date of last price change (SAP: LAEPR)',
    PRIMARY KEY (MATNR, BWKEY)
) COMMENT = 'SAP BDC: Material valuation / standard price (MBEW). Sourced via SAP BDC Connect.';

-- ── KEKO — Product Costing Header ─────────────────────────────────────────────
CREATE OR REPLACE TABLE COSTING_HEADER (
    KALNR   VARCHAR(12)  NOT NULL COMMENT 'Costing run number (SAP: KALNR)',
    MATNR   VARCHAR(18)  NOT NULL COMMENT 'Material number (SAP: MATNR)',
    WERKS   VARCHAR(4)   NOT NULL COMMENT 'Plant (SAP: WERKS)',
    TVERS   VARCHAR(2)            COMMENT 'Costing version (SAP: TVERS)',
    KADKY   DATE                  COMMENT 'Costing date key (SAP: KADKY)',
    KADAT   DATE                  COMMENT 'Costing valid from (SAP: KADAT)',
    GSGES   FLOAT                 COMMENT 'Total cost (SAP: GSGES)',
    EKGES   FLOAT                 COMMENT 'Total material cost (SAP: EKGES)',
    FKGES   FLOAT                 COMMENT 'Total overhead cost (SAP: FKGES)',
    LGGES   FLOAT                 COMMENT 'Total labour cost (SAP: LGGES)',
    CURRENCY VARCHAR(3)           COMMENT 'Currency key (SAP: WAERS)',
    PRIMARY KEY (KALNR)
) COMMENT = 'SAP BDC: Product costing header — budgeted standard cost per material/plant (KEKO). Sourced via SAP BDC Connect.';

-- ── Cost Component Split (KEPH-style) ─────────────────────────────────────────
CREATE OR REPLACE TABLE COST_COMPONENT_SPLIT (
    KALNR          VARCHAR(12)  NOT NULL COMMENT 'Costing run (SAP: KALNR)',
    MATNR          VARCHAR(18)  NOT NULL COMMENT 'Material number',
    WERKS          VARCHAR(4)   NOT NULL COMMENT 'Plant',
    GJAHR          INTEGER      NOT NULL COMMENT 'Fiscal year (SAP: GJAHR)',
    POPER          VARCHAR(3)   NOT NULL COMMENT 'Posting period (SAP: POPER)',
    COST_COMPONENT VARCHAR(30)  NOT NULL COMMENT 'Cost component label',
    STANDARD_COST  FLOAT                 COMMENT 'Budgeted cost for this component',
    ACTUAL_COST    FLOAT                 COMMENT 'Actual cost (from Material Ledger CKMLCR)',
    CURRENCY       VARCHAR(3)            COMMENT 'Currency',
    PRIMARY KEY (KALNR, GJAHR, POPER, COST_COMPONENT)
) COMMENT = 'SAP BDC: Cost component split — standard vs actual by component (KEPH/CKMLCR). Sourced via SAP BDC Connect.';

-- ── CKMLCR — Material Ledger (Period Actuals) ─────────────────────────────────
CREATE OR REPLACE TABLE MATERIAL_LEDGER (
    BWKEY   VARCHAR(4)   NOT NULL COMMENT 'Valuation area = Plant (SAP: BWKEY)',
    MATNR   VARCHAR(18)  NOT NULL COMMENT 'Material number (SAP: MATNR)',
    GJAHR   INTEGER      NOT NULL COMMENT 'Fiscal year (SAP: GJAHR)',
    POPER   VARCHAR(3)   NOT NULL COMMENT 'Posting period 001-012 (SAP: POPER)',
    PVPRS   FLOAT                 COMMENT 'Periodic unit price — actual cost (SAP: PVPRS)',
    STPRS   FLOAT                 COMMENT 'Standard price for period (SAP: STPRS)',
    PEINH   INTEGER               COMMENT 'Price unit (SAP: PEINH)',
    MLBWP1  FLOAT                 COMMENT 'Price variance — material (SAP: MLBWP1)',
    MLBWP2  FLOAT                 COMMENT 'Price variance — overhead (SAP: MLBWP2)',
    LBKUM   FLOAT                 COMMENT 'Total stock value (SAP: LBKUM)',
    CURRENCY VARCHAR(3)           COMMENT 'Currency',
    PRIMARY KEY (BWKEY, MATNR, GJAHR, POPER)
) COMMENT = 'SAP BDC: Material ledger period actuals — actual cost per unit per period (CKMLCR). Sourced via SAP BDC Connect.';

-- ── Cost Budget (Plan) — prior-year actuals carried as the period budget ─────
-- Enables a three-way variance: Actual (CKMLCR) vs Budget (prior-year) vs
-- Standard (annual plan). Budget for year Y = actual for the same month in Y-1.
CREATE OR REPLACE TABLE COST_BUDGET (
    MATNR        VARCHAR(18)  NOT NULL COMMENT 'Material number (SAP: MATNR)',
    BWKEY        VARCHAR(4)   NOT NULL COMMENT 'Valuation area = Plant (SAP: BWKEY)',
    GJAHR        INTEGER      NOT NULL COMMENT 'Fiscal year (SAP: GJAHR)',
    POPER        VARCHAR(3)   NOT NULL COMMENT 'Posting period 001-012 (SAP: POPER)',
    BUDGET_COST  FLOAT                 COMMENT 'Budgeted unit cost (prior-year actual)',
    CURRENCY     VARCHAR(3)            COMMENT 'Currency',
    PRIMARY KEY (MATNR, BWKEY, GJAHR, POPER)
) COMMENT = 'Period budget = prior-year actual unit cost. Derived from Material Ledger; used for Actual vs Budget vs Standard variance.';
