-- =============================================================================
-- AI Product Costing Accelerator — ML Smart Insights
-- =============================================================================
-- Uses Snowflake native ML (FORECAST + statistical anomaly detection) over the
-- full monthly history (FY2024 + FY2025 + FY2026 H1) to predict future cost
-- variance and flag anomalous cost components. Includes a BACKTEST that trains
-- only through FY2025 and predicts FY2026 H1 vs actuals -> real accuracy metrics
-- for the Observability tab.
--
-- Run AFTER 01_setup.sql through 05_profitability.sql.
-- Run with:  snow sql -c <connection> -f sql/06_ml_insights.sql
-- =============================================================================

USE DATABASE {{ database }};
USE SCHEMA {{ database }}.ANALYTICS;

-- ── Portfolio-level monthly variance time series (input for FORECAST) ─────────
-- One row per month — avg cost variance % across all finished goods.
-- Monthly mapping: TS = first of (GJAHR, POPER).
CREATE OR REPLACE VIEW PORTFOLIO_VARIANCE_TS AS
SELECT
  DATE_FROM_PARTS(FISCAL_YEAR, CAST(PERIOD AS INT), 1) AS TS,
  ROUND(AVG(COST_VARIANCE_PCT), 4)                     AS TARGET
FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
WHERE MATERIAL_TYPE = 'FERT'
GROUP BY 1
ORDER BY 1;

-- Training slice for the backtest: history through end of FY2025 only.
CREATE OR REPLACE VIEW PORTFOLIO_VARIANCE_TS_TRAIN AS
SELECT TS, TARGET
FROM {{ database }}.ANALYTICS.PORTFOLIO_VARIANCE_TS
WHERE TS < DATE '2026-01-01';

-- ── Per-product monthly variance time series ─────────────────────────────────
CREATE OR REPLACE VIEW PRODUCT_VARIANCE_TS AS
SELECT
  DATE_FROM_PARTS(FISCAL_YEAR, CAST(PERIOD AS INT), 1) AS TS,
  MATERIAL_NUMBER,
  ROUND(AVG(COST_VARIANCE_PCT), 4) AS TARGET
FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
WHERE MATERIAL_TYPE = 'FERT'
GROUP BY 1, 2;

-- ── Cost component monthly series for anomaly detection ──────────────────────
CREATE OR REPLACE VIEW COMPONENT_COST_TS AS
SELECT
  DATE_FROM_PARTS(FISCAL_YEAR, CAST(PERIOD AS INT), 1) AS TS,
  MATERIAL_NUMBER,
  COST_COMPONENT,
  ROUND(AVG(ACTUAL_COST), 4)    AS ACTUAL_COST,
  ROUND(AVG(STANDARD_COST), 4)  AS STANDARD_COST,
  ROUND(AVG(COMPONENT_VARIANCE_PCT), 4) AS VARIANCE_PCT
FROM {{ database }}.ANALYTICS.COST_COMPONENT_DETAIL
GROUP BY 1, 2, 3;

-- ── Train FORECAST model on the full monthly portfolio variance history ──────
-- 30 monthly points (FY2024 + FY2025 + FY2026 H1) — enough for trend + seasonal
-- signal detection. Forecasts the remaining 6 months of FY2026 (Jul-Dec).
CREATE OR REPLACE SNOWFLAKE.ML.FORECAST {{ database }}.ANALYTICS.VARIANCE_FORECAST_MODEL (
  INPUT_DATA        => SYSTEM$REFERENCE('VIEW', '{{ database }}.ANALYTICS.PORTFOLIO_VARIANCE_TS'),
  TIMESTAMP_COLNAME => 'TS',
  TARGET_COLNAME    => 'TARGET'
);

CREATE OR REPLACE TABLE {{ database }}.ANALYTICS.VARIANCE_FORECAST AS
SELECT * FROM TABLE(
  {{ database }}.ANALYTICS.VARIANCE_FORECAST_MODEL!FORECAST(FORECASTING_PERIODS => 6)
);

-- ── BACKTEST model: train through FY2025, predict FY2026 H1, compare to actuals
CREATE OR REPLACE SNOWFLAKE.ML.FORECAST {{ database }}.ANALYTICS.VARIANCE_BACKTEST_MODEL (
  INPUT_DATA        => SYSTEM$REFERENCE('VIEW', '{{ database }}.ANALYTICS.PORTFOLIO_VARIANCE_TS_TRAIN'),
  TIMESTAMP_COLNAME => 'TS',
  TARGET_COLNAME    => 'TARGET'
);

CREATE OR REPLACE TABLE {{ database }}.ANALYTICS.VARIANCE_BACKTEST AS
SELECT * FROM TABLE(
  {{ database }}.ANALYTICS.VARIANCE_BACKTEST_MODEL!FORECAST(FORECASTING_PERIODS => 6)
);

-- Backtest detail: predicted vs actual for FY2026 H1 (model never saw these).
CREATE OR REPLACE VIEW FORECAST_BACKTEST_DETAIL AS
SELECT
  a.TS,
  CONCAT('2026-P', LPAD(MONTH(a.TS)::VARCHAR, 3, '0')) AS PERIOD_LABEL,
  ROUND(a.TARGET, 2)                          AS ACTUAL_VARIANCE,
  ROUND(b.FORECAST, 2)                        AS FORECAST_VARIANCE,
  ROUND(b.LOWER_BOUND, 2)                     AS FORECAST_LOWER,
  ROUND(b.UPPER_BOUND, 2)                     AS FORECAST_UPPER,
  ROUND(ABS(a.TARGET - b.FORECAST), 2)        AS ABS_ERROR_PP,
  (a.TARGET BETWEEN b.LOWER_BOUND AND b.UPPER_BOUND) AS WITHIN_CI
FROM {{ database }}.ANALYTICS.PORTFOLIO_VARIANCE_TS a
JOIN {{ database }}.ANALYTICS.VARIANCE_BACKTEST b
  ON a.TS = b.TS::DATE
WHERE a.TS >= DATE '2026-01-01';

-- Backtest accuracy summary — the headline "model accuracy" observability metric.
CREATE OR REPLACE VIEW FORECAST_ACCURACY AS
SELECT
  COUNT(*)                                            AS PERIODS_TESTED,
  ROUND(AVG(ABS_ERROR_PP), 2)                         AS MAE_PP,
  ROUND(SQRT(AVG(ABS_ERROR_PP * ABS_ERROR_PP)), 2)    AS RMSE_PP,
  ROUND(100.0 * AVG(IFF(WITHIN_CI, 1, 0)), 0)         AS CI_COVERAGE_PCT,
  ROUND(100.0 - LEAST(100, AVG(ABS_ERROR_PP) * 10), 1) AS ACCURACY_SCORE
FROM {{ database }}.ANALYTICS.FORECAST_BACKTEST_DETAIL;

-- ── Statistical anomaly detection on cost components (z-score) ───────────────
CREATE OR REPLACE VIEW {{ database }}.ANALYTICS.COST_ANOMALIES AS
WITH stats AS (
  SELECT
    COST_COMPONENT,
    FISCAL_YEAR,
    PERIOD,
    AVG(COMPONENT_VARIANCE_PCT)    AS MEAN_VAR,
    STDDEV(COMPONENT_VARIANCE_PCT) AS STD_VAR
  FROM {{ database }}.ANALYTICS.COST_COMPONENT_DETAIL
  GROUP BY COST_COMPONENT, FISCAL_YEAR, PERIOD
)
SELECT
  c.MATERIAL_NUMBER,
  c.MATERIAL_DESCRIPTION,
  c.PLANT_NAME,
  c.COST_COMPONENT,
  c.FISCAL_YEAR,
  c.PERIOD,
  ROUND(c.ACTUAL_COST, 2)            AS ACTUAL_COST,
  ROUND(c.STANDARD_COST, 2)          AS STANDARD_COST,
  ROUND(c.COMPONENT_VARIANCE_PCT, 2) AS VARIANCE_PCT,
  ROUND((c.COMPONENT_VARIANCE_PCT - s.MEAN_VAR) / NULLIF(s.STD_VAR, 0), 2) AS Z_SCORE,
  ABS((c.COMPONENT_VARIANCE_PCT - s.MEAN_VAR) / NULLIF(s.STD_VAR, 0)) > 1.5 AS IS_ANOMALY
FROM {{ database }}.ANALYTICS.COST_COMPONENT_DETAIL c
JOIN stats s
  ON c.COST_COMPONENT = s.COST_COMPONENT AND c.FISCAL_YEAR = s.FISCAL_YEAR AND c.PERIOD = s.PERIOD
ORDER BY ABS(Z_SCORE) DESC;

-- ── Combined actuals + forecast view for the trend chart ─────────────────────
-- Full monthly history (actuals) + the 6-month FY2026 H2 forecast.
CREATE OR REPLACE VIEW VARIANCE_TREND_WITH_FORECAST AS
  SELECT
    TS,
    CONCAT(YEAR(TS), '-P', LPAD(MONTH(TS)::VARCHAR, 3, '0')) AS PERIOD_LABEL,
    ROUND(TARGET, 2)  AS ACTUAL_VARIANCE,
    NULL::FLOAT       AS FORECAST_VARIANCE,
    NULL::FLOAT       AS FORECAST_LOWER,
    NULL::FLOAT       AS FORECAST_UPPER,
    'actual'          AS DATA_TYPE
  FROM {{ database }}.ANALYTICS.PORTFOLIO_VARIANCE_TS

  UNION ALL

  SELECT
    TS::DATE,
    CONCAT(YEAR(TS::DATE), '-P', LPAD(MONTH(TS::DATE)::VARCHAR, 3, '0')) AS PERIOD_LABEL,
    NULL::FLOAT             AS ACTUAL_VARIANCE,
    ROUND(FORECAST, 2)      AS FORECAST_VARIANCE,
    ROUND(LOWER_BOUND, 2)   AS FORECAST_LOWER,
    ROUND(UPPER_BOUND, 2)   AS FORECAST_UPPER,
    'forecast'              AS DATA_TYPE
  FROM {{ database }}.ANALYTICS.VARIANCE_FORECAST

ORDER BY TS;

-- ── Product risk scoring view ────────────────────────────────────────────────
-- Scores each product by its FY2026 H1 trajectory (slope across P001-P006) and
-- projects the next period.
CREATE OR REPLACE VIEW PRODUCT_RISK_SCORES AS
WITH product_trend AS (
  SELECT
    MATERIAL_NUMBER,
    MATERIAL_DESCRIPTION,
    MAX(CASE WHEN PERIOD='001' THEN COST_VARIANCE_PCT END) AS VAR_P001,
    MAX(CASE WHEN PERIOD='003' THEN COST_VARIANCE_PCT END) AS VAR_P003,
    MAX(CASE WHEN PERIOD='006' THEN COST_VARIANCE_PCT END) AS VAR_P006,
    -- Slope: avg change in variance per period across FY2026 H1 (P001 -> P006).
    ((MAX(CASE WHEN PERIOD='006' THEN COST_VARIANCE_PCT END)
      - MAX(CASE WHEN PERIOD='001' THEN COST_VARIANCE_PCT END)) / 5) AS SLOPE_PER_PERIOD
  FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
  WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
  GROUP BY MATERIAL_NUMBER, MATERIAL_DESCRIPTION
)
SELECT
  t.MATERIAL_NUMBER,
  t.MATERIAL_DESCRIPTION,
  ROUND(t.VAR_P001, 2) AS VAR_P001,
  ROUND(t.VAR_P003, 2) AS VAR_P003,
  ROUND(t.VAR_P006, 2) AS VAR_P006,
  ROUND(t.SLOPE_PER_PERIOD, 2) AS SLOPE,
  ROUND(t.VAR_P006 + t.SLOPE_PER_PERIOD, 2) AS ESTIMATED_P007,
  CASE
    WHEN t.VAR_P006 > 8 OR (t.VAR_P006 + t.SLOPE_PER_PERIOD) > 10 THEN 'HIGH'
    WHEN t.VAR_P006 > 5 OR (t.VAR_P006 + t.SLOPE_PER_PERIOD) > 7  THEN 'MEDIUM'
    ELSE 'LOW'
  END AS RISK_LEVEL
FROM product_trend t
ORDER BY ABS(t.SLOPE_PER_PERIOD) DESC;
