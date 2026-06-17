import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

// Each block is independently guarded so one access failure (e.g. ACCOUNT_USAGE
// grants) does not blank the whole Observability tab.
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch { return fallback }
}

export async function GET() {
  // ── 1. Data quality (live, against the costing data the app serves) ─────────
  const dataQuality = await safe(async () => {
    const rows = await querySnowflake(`
      SELECT
        COUNT(*)                                                        AS TOTAL_ROWS,
        COUNT(DISTINCT MATERIAL_NUMBER)                                 AS MATERIALS,
        COUNT(DISTINCT PLANT_CODE)                                      AS PLANTS,
        MAX(YEAR_PERIOD)                                                AS LATEST_PERIOD,
        ROUND(100.0 * COUNT(ACTUAL_COST_PER_UNIT) / NULLIF(COUNT(*),0), 1)        AS PCT_ACTUAL_POPULATED,
        ROUND(100.0 * COUNT(BUDGET_COST_PER_UNIT) / NULLIF(COUNT(*),0), 1)        AS PCT_BUDGET_POPULATED,
        ROUND(100.0 * COUNT_IF(ABS(COST_VARIANCE_PCT) <= 5) / NULLIF(COUNT(*),0), 1) AS PCT_WITHIN_TOLERANCE
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
    `)
    const dupes = await querySnowflake(`
      SELECT COUNT(*) AS DUPLICATE_KEYS FROM (
        SELECT BWKEY, MATNR, GJAHR, POPER, COUNT(*) c
        FROM ${DATABASE}.SAP_BDC.MATERIAL_LEDGER
        GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
      )
    `)
    return { ...rows[0], DUPLICATE_KEYS: dupes[0]?.DUPLICATE_KEYS ?? 0 }
  }, null)

  // ── 2. Model accuracy / drift (live backtest: train ≤FY2025, predict FY26 H1)
  const modelAccuracy = await safe(async () => {
    const acc = await querySnowflake(`SELECT * FROM ${DATABASE}.ANALYTICS.FORECAST_ACCURACY`)
    const detail = await querySnowflake(`
      SELECT PERIOD_LABEL, ACTUAL_VARIANCE, FORECAST_VARIANCE, ABS_ERROR_PP, WITHIN_CI
      FROM ${DATABASE}.ANALYTICS.FORECAST_BACKTEST_DETAIL ORDER BY TS
    `)
    return { summary: acc[0] ?? null, detail }
  }, null)

  // ── 3. Consumption cost (live; ACCOUNT_USAGE may be access-gated -> fallback)
  const compute = await safe(async () => {
    const rows = await querySnowflake(`
      SELECT
        ROUND(SUM(IFF(NAME ILIKE '${WAREHOUSE}', CREDITS_USED, 0)), 2) AS ${WAREHOUSE}_CREDITS,
        ROUND(SUM(CREDITS_USED), 2)                              AS ACCOUNT_CREDITS,
        COUNT(DISTINCT NAME)                                     AS SERVICES
      FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
      WHERE START_TIME >= DATEADD('day', -14, CURRENT_TIMESTAMP())
    `)
    return rows[0] ?? null
  }, null)

  const cortex = await safe(async () => {
    const rows = await querySnowflake(`
      SELECT
        COALESCE(ROUND(SUM(TOKEN_CREDITS), 4), 0) AS CORTEX_CREDITS,
        COALESCE(SUM(TOKENS), 0)                  AS CORTEX_TOKENS,
        COUNT(*)                                  AS CALLS
      FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY
      WHERE START_TIME >= DATEADD('day', -14, CURRENT_TIMESTAMP())
    `)
    return rows[0] ?? null
  }, null)

  return Response.json({
    dataQuality,
    modelAccuracy,
    cost: { compute, cortex },
    meteringAvailable: compute !== null,
    cortexMetered: cortex !== null && Number(cortex.CALLS) > 0,
  })
}
