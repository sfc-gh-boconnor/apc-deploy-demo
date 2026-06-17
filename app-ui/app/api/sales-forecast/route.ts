import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  // Revenue + margin trend: actual H1 + ML forecast H2, per product per month
  const trend = await querySnowflake(`
    SELECT
      TO_CHAR(TS, 'YYYY-MM-DD')   AS TS,
      MATERIAL_NUMBER,
      DATA_TYPE,
      ACTUAL_REVENUE,
      ACTUAL_VOLUME,
      ACTUAL_MARGIN_PCT,
      ACTUAL_GROSS_MARGIN,
      FORECAST_REVENUE,
      REVENUE_LOWER,
      REVENUE_UPPER,
      FORECAST_VOLUME,
      FORECAST_MARGIN_PCT,
      FORECAST_GROSS_MARGIN,
      COST_PER_UNIT
    FROM ${DATABASE}.DBT_ANALYTICS.MART_SALES_FORECAST
    ORDER BY MATERIAL_NUMBER, TS
  `)

  // Margin compression summary per product
  const compression = await querySnowflake(`
    WITH
    h1 AS (
      SELECT
        MATERIAL_NUMBER,
        ROUND(AVG(ACTUAL_MARGIN_PCT), 1)    AS H1_MARGIN_PCT,
        ROUND(SUM(ACTUAL_REVENUE), 0)       AS H1_REVENUE,
        ROUND(AVG(COST_PER_UNIT), 2)        AS AVG_COST_PER_UNIT
      FROM ${DATABASE}.DBT_ANALYTICS.MART_SALES_FORECAST
      WHERE DATA_TYPE = 'actual'
      GROUP BY MATERIAL_NUMBER
    ),
    h2 AS (
      SELECT
        MATERIAL_NUMBER,
        ROUND(AVG(FORECAST_MARGIN_PCT), 1)  AS H2_MARGIN_PCT,
        ROUND(SUM(FORECAST_REVENUE), 0)     AS H2_REVENUE
      FROM ${DATABASE}.DBT_ANALYTICS.MART_SALES_FORECAST
      WHERE DATA_TYPE = 'forecast'
      GROUP BY MATERIAL_NUMBER
    ),
    descr AS (
      SELECT DISTINCT MATERIAL_NUMBER, MATERIAL_DESCRIPTION
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
    )
    SELECT
      h1.MATERIAL_NUMBER,
      d.MATERIAL_DESCRIPTION,
      h1.H1_MARGIN_PCT,
      h2.H2_MARGIN_PCT,
      ROUND(h2.H2_MARGIN_PCT - h1.H1_MARGIN_PCT, 1)                          AS MARGIN_CHANGE_PTS,
      h1.H1_REVENUE,
      h2.H2_REVENUE,
      ROUND(h2.H2_REVENUE * (h1.H1_MARGIN_PCT - h2.H2_MARGIN_PCT) / 100.0, 0) AS REVENUE_AT_RISK,
      CASE
        WHEN h2.H2_MARGIN_PCT - h1.H1_MARGIN_PCT < -3 THEN 'HIGH'
        WHEN h2.H2_MARGIN_PCT - h1.H1_MARGIN_PCT < -1 THEN 'MEDIUM'
        ELSE 'LOW'
      END AS COMPRESSION_RISK
    FROM h1
    JOIN h2 ON h1.MATERIAL_NUMBER = h2.MATERIAL_NUMBER
    LEFT JOIN descr d ON d.MATERIAL_NUMBER = h1.MATERIAL_NUMBER
    ORDER BY MARGIN_CHANGE_PTS ASC
  `)

  // KPI summary
  const kpis = await querySnowflake(`
    SELECT
      ROUND(SUM(CASE WHEN DATA_TYPE = 'forecast' THEN FORECAST_REVENUE ELSE 0 END), 0)  AS TOTAL_H2_FORECAST_REVENUE,
      ROUND(AVG(CASE WHEN DATA_TYPE = 'actual'   THEN ACTUAL_MARGIN_PCT END), 1)         AS AVG_H1_MARGIN_PCT,
      ROUND(AVG(CASE WHEN DATA_TYPE = 'forecast' THEN FORECAST_MARGIN_PCT END), 1)       AS AVG_H2_MARGIN_PCT,
      COUNT(DISTINCT CASE
        WHEN DATA_TYPE = 'actual' THEN NULL
        ELSE MATERIAL_NUMBER
      END)                                                                                AS PRODUCTS_FORECAST
    FROM ${DATABASE}.DBT_ANALYTICS.MART_SALES_FORECAST
  `)

  return Response.json({ trend, compression, kpis: kpis[0] ?? {} })
}
