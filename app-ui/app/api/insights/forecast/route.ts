import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  const [trend, riskScores] = await Promise.all([
    querySnowflake(`
      SELECT PERIOD_LABEL, ACTUAL_VARIANCE, FORECAST_VARIANCE, FORECAST_LOWER, FORECAST_UPPER, DATA_TYPE
      FROM ${DATABASE}.DBT_ANALYTICS.MART_VARIANCE_TREND_WITH_FORECAST
      ORDER BY TS
    `),
    querySnowflake(`
      SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION,
             VAR_P001, VAR_P003, VAR_P006,
             VARIANCE_SLOPE AS SLOPE,
             ESTIMATED_NEXT_PERIOD AS ESTIMATED_P004,
             RISK_LEVEL
      FROM ${DATABASE}.ML_FEATURE_STORE."PRODUCT_RISK_FV$V1"
      ORDER BY ABS(VARIANCE_SLOPE) DESC
    `),
  ])

  // Portfolio-level KPIs
  const forecastRows = (trend as any[]).filter(r => r.DATA_TYPE === 'forecast')
  const p004Forecast = forecastRows[0]?.FORECAST_VARIANCE ?? 0
  const p004Lower    = forecastRows[0]?.FORECAST_LOWER   ?? 0
  const p004Upper    = forecastRows[0]?.FORECAST_UPPER   ?? 0
  const highRisk     = (riskScores as any[]).filter(r => r.RISK_LEVEL === 'HIGH').length
  const medRisk      = (riskScores as any[]).filter(r => r.RISK_LEVEL === 'MEDIUM').length

  return Response.json({ trend, riskScores, kpis: { p004Forecast, p004Lower, p004Upper, highRisk, medRisk } })
}
