-- =============================================================================
-- AI Product Costing Accelerator — Scenario Analysis Setup
-- =============================================================================
-- Creates the SCENARIO_INPUTS table (named what-if scenarios with assumption
-- parameters) and the SCENARIO_RESULTS view (applies parameters to SAP BDC
-- cost component data to compute adjusted costs per scenario).
--
-- Run AFTER 01_setup.sql, 02_synthetic_data.sql, and 03_analytics.sql.
-- Run with:  snow sql -c <connection> -f sql/04_scenarios.sql
-- =============================================================================

USE DATABASE {{ database }};
USE SCHEMA {{ database }}.ANALYTICS;

-- ── Scenario Parameters Table ─────────────────────────────────────────────────
CREATE OR REPLACE TABLE SCENARIO_INPUTS (
  SCENARIO_ID              NUMBER AUTOINCREMENT PRIMARY KEY,
  SCENARIO_NAME            VARCHAR(50)  NOT NULL,
  DESCRIPTION              VARCHAR(200),
  API_COST_CHANGE_PCT      FLOAT DEFAULT 0    COMMENT '+/- % change applied to API / Drug Substance components',
  LABOUR_COST_CHANGE_PCT   FLOAT DEFAULT 0    COMMENT '+/- % change applied to Labour components',
  VOLUME_MULTIPLIER        FLOAT DEFAULT 1.0  COMMENT 'Multiplier on demand volume — affects overhead absorption per unit',
  FX_ADJUSTMENT_PCT        FLOAT DEFAULT 0    COMMENT '+/- % change applied to remaining components (packaging, excipients, etc.)',
  ENERGY_COST_CHANGE_PCT   FLOAT DEFAULT 0    COMMENT '+/- % change applied to the Energy / Utilities component (e.g. wholesale power/gas price shock)',
  IS_BASE                  BOOLEAN DEFAULT FALSE COMMENT 'TRUE = reference scenario, parameters locked'
) COMMENT = 'Named what-if scenarios for product costing sensitivity analysis. Non-base scenarios can be edited via the Scenario Analysis tab.';

-- ── Seed Scenarios ────────────────────────────────────────────────────────────
INSERT INTO SCENARIO_INPUTS
  (SCENARIO_NAME, DESCRIPTION, API_COST_CHANGE_PCT, LABOUR_COST_CHANGE_PCT, VOLUME_MULTIPLIER, FX_ADJUSTMENT_PCT, ENERGY_COST_CHANGE_PCT, IS_BASE)
VALUES
  ('Base',
   'Current standard cost — no changes to assumptions',
   0, 0, 1.0, 0, 0, TRUE),

  ('API Cost Shock',
    'CMO API price increase of +20% — supply chain pressure scenario. Realistic for pharma given single-source biologics APIs.',
   20, 0, 1.0, 0, 0, FALSE),

  ('Volume Drop',
   'Demand falls 30% post-patent cliff — overhead spreads across fewer units, increasing cost per unit.',
   0, 0, 0.7, 0, 0, FALSE),

  ('Energy Spike',
   'Wholesale power/gas price surge of +40% — energy-intensive sites (API, biologics) hit hardest. Driven by the LEBA energy index.',
   0, 0, 1.0, 0, 40, FALSE);

-- ── Scenario Results View ─────────────────────────────────────────────────────
-- Applies scenario parameters to each cost component from COST_COMPONENT_DETAIL.
-- API/Drug Substance components → scaled by API_COST_CHANGE_PCT
-- Labour components             → scaled by LABOUR_COST_CHANGE_PCT
-- Overhead components           → divided by VOLUME_MULTIPLIER (fewer units = higher per-unit overhead)
-- Energy / Utilities component  → scaled by ENERGY_COST_CHANGE_PCT
-- Everything else               → scaled by FX_ADJUSTMENT_PCT
CREATE OR REPLACE VIEW SCENARIO_RESULTS AS
WITH component_scenarios AS (
  SELECT
    s.SCENARIO_ID,
    s.SCENARIO_NAME,
    s.IS_BASE,
    c.MATERIAL_NUMBER,
    c.MATERIAL_DESCRIPTION,
    c.PLANT_CODE,
    c.PLANT_NAME,
    c.PERIOD,
    c.COST_COMPONENT,
    c.STANDARD_COST,
    CASE
      WHEN c.COST_COMPONENT ILIKE '%API%' OR c.COST_COMPONENT ILIKE '%Drug Substance%'
        THEN c.STANDARD_COST * (1 + s.API_COST_CHANGE_PCT / 100)
      WHEN c.COST_COMPONENT ILIKE '%Labour%'
        THEN c.STANDARD_COST * (1 + s.LABOUR_COST_CHANGE_PCT / 100)
      WHEN c.COST_COMPONENT ILIKE '%Overhead%'
        THEN c.STANDARD_COST / NULLIF(s.VOLUME_MULTIPLIER, 0)
      WHEN c.COST_COMPONENT ILIKE '%Energy%'
        THEN c.STANDARD_COST * (1 + s.ENERGY_COST_CHANGE_PCT / 100)
      ELSE c.STANDARD_COST * (1 + s.FX_ADJUSTMENT_PCT / 100)
    END AS SCENARIO_COMPONENT_COST
  FROM {{ database }}.ANALYTICS.COST_COMPONENT_DETAIL c
  CROSS JOIN {{ database }}.ANALYTICS.SCENARIO_INPUTS s
  WHERE c.FISCAL_YEAR = 2026
)
SELECT
  SCENARIO_ID,
  SCENARIO_NAME,
  IS_BASE,
  MATERIAL_NUMBER,
  MATERIAL_DESCRIPTION,
  PLANT_CODE,
  PLANT_NAME,
  PERIOD,
  ROUND(SUM(STANDARD_COST), 4)           AS BASE_COST,
  ROUND(SUM(SCENARIO_COMPONENT_COST), 4) AS SCENARIO_COST,
  ROUND(SUM(SCENARIO_COMPONENT_COST) - SUM(STANDARD_COST), 4) AS COST_DELTA,
  ROUND(
    (SUM(SCENARIO_COMPONENT_COST) - SUM(STANDARD_COST))
    / NULLIF(SUM(STANDARD_COST), 0) * 100, 2
  ) AS COST_DELTA_PCT
FROM component_scenarios
GROUP BY SCENARIO_ID, SCENARIO_NAME, IS_BASE,
         MATERIAL_NUMBER, MATERIAL_DESCRIPTION,
         PLANT_CODE, PLANT_NAME, PERIOD;
