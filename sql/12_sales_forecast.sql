-- =============================================================================
-- AI Product Costing Accelerator — Sales Forecast
-- =============================================================================
-- Projects H2 FY2026 revenue + volume using the trend observed in H1 (Jan-Mar)
-- and bridges against month-by-month cost escalation to show gross margin
-- compression. Uses geometric trend extrapolation (CAGR from H1) rather than
-- ML.FORECAST because only 3 billing periods exist — too few for the model to
-- detect a trend.
--
-- Run AFTER sql/06_ml_insights.sql.
-- Run with:  snow sql -c <connection> -f sql/12_sales_forecast.sql
-- =============================================================================

USE DATABASE {{ database }};
USE SCHEMA {{ database }}.ANALYTICS;

-- ── H1 monthly revenue + volume per product ──────────────────────────────────
CREATE OR REPLACE VIEW REVENUE_TS AS
SELECT
  DATE_FROM_PARTS(GJAHR, CAST(POPER AS INT), 1) AS TS,
  MATNR                                          AS SERIES_ID,
  ROUND(SUM(NETWR), 2)                           AS REVENUE,
  ROUND(SUM(FKMNG), 0)                           AS VOLUME
FROM {{ database }}.SAP_BDC.SD_BILLING
GROUP BY 1, 2
ORDER BY 2, 1;

-- ── Trend parameters from H1 ──────────────────────────────────────────────────
-- Monthly geometric growth rate: (Mar / Jan) ^ 0.5 - 1
-- Falls back to 0% growth if Jan = 0.
CREATE OR REPLACE VIEW H1_TRENDS AS
SELECT
  SERIES_ID                                       AS MATERIAL_NUMBER,
  MAX(CASE WHEN MONTH(TS) = 1 THEN REVENUE END)   AS REV_JAN,
  MAX(CASE WHEN MONTH(TS) = 3 THEN REVENUE END)   AS REV_MAR,
  MAX(CASE WHEN MONTH(TS) = 1 THEN VOLUME  END)   AS VOL_JAN,
  MAX(CASE WHEN MONTH(TS) = 3 THEN VOLUME  END)   AS VOL_MAR,
  -- Compound monthly growth rate from Jan to Mar (2 steps)
  ROUND(POWER(MAX(CASE WHEN MONTH(TS) = 3 THEN REVENUE END)
              / NULLIF(MAX(CASE WHEN MONTH(TS) = 1 THEN REVENUE END), 0),
              0.5) - 1, 4)                         AS MONTHLY_REV_GROWTH,
  ROUND(POWER(MAX(CASE WHEN MONTH(TS) = 3 THEN VOLUME END)
              / NULLIF(MAX(CASE WHEN MONTH(TS) = 1 THEN VOLUME END), 0),
              0.5) - 1, 4)                         AS MONTHLY_VOL_GROWTH
FROM {{ database }}.ANALYTICS.REVENUE_TS
GROUP BY SERIES_ID;

-- ── Future months: Apr – Dec 2026 (9 periods) ────────────────────────────────
-- SEQ4() generator — N_STEPS = months forward from March (1 = Apr, 9 = Dec).
CREATE OR REPLACE VIEW FUTURE_MONTHS AS
SELECT
  VALUE::INT                                      AS N_STEPS,
  DATE_FROM_PARTS(2026, 3 + VALUE::INT, 1)        AS TS
FROM TABLE(FLATTEN(INPUT => ARRAY_GENERATE_RANGE(1, 10)));

-- ── Revenue + volume forecast ────────────────────────────────────────────────
-- Projects Mar actuals forward using the H1 monthly growth rate.
-- Confidence band: ±(8% + 1% per step) widening interval.
CREATE OR REPLACE TABLE {{ database }}.ANALYTICS.SALES_REVENUE_FORECAST AS
SELECT
  f.TS                                                                       AS TS,
  t.MATERIAL_NUMBER                                                          AS SERIES,
  ROUND(t.REV_MAR * POWER(1 + t.MONTHLY_REV_GROWTH, f.N_STEPS), 2)         AS FORECAST,
  ROUND(t.REV_MAR * POWER(1 + t.MONTHLY_REV_GROWTH, f.N_STEPS)
        * (1 - 0.08 - 0.01 * f.N_STEPS), 2)                                AS LOWER_BOUND,
  ROUND(t.REV_MAR * POWER(1 + t.MONTHLY_REV_GROWTH, f.N_STEPS)
        * (1 + 0.08 + 0.01 * f.N_STEPS), 2)                                AS UPPER_BOUND
FROM {{ database }}.ANALYTICS.FUTURE_MONTHS f
CROSS JOIN {{ database }}.ANALYTICS.H1_TRENDS t;

CREATE OR REPLACE TABLE {{ database }}.ANALYTICS.SALES_VOLUME_FORECAST AS
SELECT
  f.TS                                                                       AS TS,
  t.MATERIAL_NUMBER                                                          AS SERIES,
  ROUND(GREATEST(t.VOL_MAR * POWER(1 + t.MONTHLY_VOL_GROWTH, f.N_STEPS), 0), 0) AS FORECAST
FROM {{ database }}.ANALYTICS.FUTURE_MONTHS f
CROSS JOIN {{ database }}.ANALYTICS.H1_TRENDS t;

-- ── Combined actuals + forecast: revenue ─────────────────────────────────────
CREATE OR REPLACE VIEW SALES_REVENUE_TREND AS
SELECT
  TS, SERIES_ID AS MATERIAL_NUMBER, REVENUE, NULL::FLOAT AS FORECAST_REVENUE,
  NULL::FLOAT AS LOWER_BOUND, NULL::FLOAT AS UPPER_BOUND, 'actual' AS DATA_TYPE
FROM {{ database }}.ANALYTICS.REVENUE_TS
UNION ALL
SELECT
  TS, SERIES AS MATERIAL_NUMBER, NULL::FLOAT AS REVENUE,
  ROUND(FORECAST, 2), ROUND(LOWER_BOUND, 2), ROUND(UPPER_BOUND, 2), 'forecast' AS DATA_TYPE
FROM {{ database }}.ANALYTICS.SALES_REVENUE_FORECAST
ORDER BY MATERIAL_NUMBER, TS;

-- ── Cost trend: monthly compounding drift ────────────────────────────────────
-- Uses the per-product H1 average cost variance % as a monthly cost escalator.
CREATE OR REPLACE VIEW COST_TREND AS
SELECT
  MATERIAL_NUMBER,
  AVG(ACTUAL_COST_PER_UNIT)     AS H1_AVG_COST_PER_UNIT,
  -- Monthly cost drift = avg variance % / 100, capped at ±15%
  ROUND(LEAST(GREATEST(AVG(COST_VARIANCE_PCT) / 100.0, -0.15), 0.15), 5) AS MONTHLY_COST_DRIFT
FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
WHERE FISCAL_YEAR = 2026
GROUP BY MATERIAL_NUMBER;

-- ── Margin forecast bridge ────────────────────────────────────────────────────
-- Actuals (H1) from SD_BILLING × actual cost. Forecast (H2) from trend
-- projection × compounding cost escalation — margin compresses month by month.
CREATE OR REPLACE VIEW MARGIN_FORECAST_BRIDGE AS
WITH

cost_by_period AS (
  SELECT MATERIAL_NUMBER, PERIOD, FISCAL_YEAR,
         AVG(ACTUAL_COST_PER_UNIT) AS COST_PER_UNIT
  FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
  WHERE FISCAL_YEAR = 2026
  GROUP BY MATERIAL_NUMBER, PERIOD, FISCAL_YEAR
),

actuals AS (
  SELECT
    DATE_FROM_PARTS(b.GJAHR, CAST(b.POPER AS INT), 1)            AS TS,
    b.MATNR                                                       AS MATERIAL_NUMBER,
    SUM(b.NETWR)                                                  AS ACTUAL_REVENUE,
    SUM(b.FKMNG)                                                  AS ACTUAL_VOLUME,
    AVG(c.COST_PER_UNIT)                                          AS COST_PER_UNIT,
    ROUND(SUM(b.NETWR) - AVG(c.COST_PER_UNIT) * SUM(b.FKMNG), 2) AS ACTUAL_GROSS_MARGIN,
    ROUND(100.0 * (SUM(b.NETWR) - AVG(c.COST_PER_UNIT) * SUM(b.FKMNG))
                / NULLIF(SUM(b.NETWR), 0), 1)                    AS ACTUAL_MARGIN_PCT
  FROM {{ database }}.SAP_BDC.SD_BILLING b
  LEFT JOIN cost_by_period c
    ON c.MATERIAL_NUMBER = b.MATNR AND c.FISCAL_YEAR = b.GJAHR AND c.PERIOD = b.POPER
  GROUP BY 1, 2
),

forecast_combined AS (
  SELECT
    rf.TS,
    rf.SERIES                                                                  AS MATERIAL_NUMBER,
    ROUND(rf.FORECAST, 2)                                                      AS FORECAST_REVENUE,
    ROUND(rf.LOWER_BOUND, 2)                                                   AS REVENUE_LOWER,
    ROUND(rf.UPPER_BOUND, 2)                                                   AS REVENUE_UPPER,
    ROUND(GREATEST(vf.FORECAST, 0), 0)                                         AS FORECAST_VOLUME,
    -- Cost compounds month-by-month: higher each period as cost pressures build
    ROUND(ct.H1_AVG_COST_PER_UNIT
          * POWER(1 + ct.MONTHLY_COST_DRIFT,
                  DATEDIFF('month', DATE '2026-03-01', rf.TS)), 2)             AS FORECAST_COST_PER_UNIT,
    ROUND(GREATEST(vf.FORECAST, 0)
          * ct.H1_AVG_COST_PER_UNIT
          * POWER(1 + ct.MONTHLY_COST_DRIFT,
                  DATEDIFF('month', DATE '2026-03-01', rf.TS)), 2)             AS FORECAST_COST_TOTAL
  FROM {{ database }}.ANALYTICS.SALES_REVENUE_FORECAST rf
  JOIN {{ database }}.ANALYTICS.SALES_VOLUME_FORECAST vf
    ON rf.SERIES = vf.SERIES AND rf.TS = vf.TS
  LEFT JOIN {{ database }}.ANALYTICS.COST_TREND ct
    ON ct.MATERIAL_NUMBER = rf.SERIES
)

SELECT
  TS, MATERIAL_NUMBER,
  ACTUAL_REVENUE, ACTUAL_VOLUME, COST_PER_UNIT, ACTUAL_GROSS_MARGIN, ACTUAL_MARGIN_PCT,
  NULL::FLOAT AS FORECAST_REVENUE, NULL::FLOAT AS REVENUE_LOWER, NULL::FLOAT AS REVENUE_UPPER,
  NULL::FLOAT AS FORECAST_VOLUME, NULL::FLOAT AS FORECAST_COST_PER_UNIT,
  NULL::FLOAT AS FORECAST_GROSS_MARGIN, NULL::FLOAT AS FORECAST_MARGIN_PCT, 'actual' AS DATA_TYPE
FROM actuals

UNION ALL

SELECT
  TS, MATERIAL_NUMBER,
  NULL::FLOAT, NULL::FLOAT, FORECAST_COST_PER_UNIT, NULL::FLOAT, NULL::FLOAT,
  FORECAST_REVENUE, REVENUE_LOWER, REVENUE_UPPER, FORECAST_VOLUME, FORECAST_COST_PER_UNIT,
  ROUND(FORECAST_REVENUE - FORECAST_COST_TOTAL, 2) AS FORECAST_GROSS_MARGIN,
  ROUND(100.0 * (FORECAST_REVENUE - FORECAST_COST_TOTAL)
               / NULLIF(FORECAST_REVENUE, 0), 1)   AS FORECAST_MARGIN_PCT,
  'forecast' AS DATA_TYPE
FROM forecast_combined
ORDER BY MATERIAL_NUMBER, TS;

-- ── Margin compression summary per product ───────────────────────────────────
CREATE OR REPLACE VIEW MARGIN_COMPRESSION_SUMMARY AS
WITH
h1 AS (
  SELECT MATERIAL_NUMBER,
         ROUND(AVG(ACTUAL_MARGIN_PCT), 1) AS H1_MARGIN_PCT,
         ROUND(SUM(ACTUAL_REVENUE), 0)    AS H1_REVENUE
  FROM {{ database }}.ANALYTICS.MARGIN_FORECAST_BRIDGE
  WHERE DATA_TYPE = 'actual' GROUP BY MATERIAL_NUMBER
),
h2 AS (
  SELECT MATERIAL_NUMBER,
         ROUND(AVG(FORECAST_MARGIN_PCT), 1) AS H2_MARGIN_PCT,
         ROUND(SUM(FORECAST_REVENUE), 0)    AS H2_REVENUE
  FROM {{ database }}.ANALYTICS.MARGIN_FORECAST_BRIDGE
  WHERE DATA_TYPE = 'forecast' GROUP BY MATERIAL_NUMBER
),
descr AS (
  SELECT DISTINCT MATERIAL_NUMBER, MATERIAL_DESCRIPTION
  FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
)
SELECT
  h1.MATERIAL_NUMBER, d.MATERIAL_DESCRIPTION,
  h1.H1_MARGIN_PCT, h2.H2_MARGIN_PCT,
  ROUND(h2.H2_MARGIN_PCT - h1.H1_MARGIN_PCT, 1)                           AS MARGIN_CHANGE_PTS,
  h1.H1_REVENUE, h2.H2_REVENUE,
  ROUND(h2.H2_REVENUE * (h1.H1_MARGIN_PCT - h2.H2_MARGIN_PCT) / 100.0, 0) AS REVENUE_AT_RISK,
  CASE
    WHEN h2.H2_MARGIN_PCT - h1.H1_MARGIN_PCT < -3 THEN 'HIGH'
    WHEN h2.H2_MARGIN_PCT - h1.H1_MARGIN_PCT < -1 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS COMPRESSION_RISK
FROM h1
JOIN h2     ON h1.MATERIAL_NUMBER = h2.MATERIAL_NUMBER
LEFT JOIN descr d ON d.MATERIAL_NUMBER = h1.MATERIAL_NUMBER
ORDER BY MARGIN_CHANGE_PTS ASC;
