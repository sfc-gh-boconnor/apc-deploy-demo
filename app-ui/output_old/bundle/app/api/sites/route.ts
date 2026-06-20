import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await querySnowflake(`
      SELECT DISTINCT PLANT_CODE || ' — ' || PLANT_NAME AS SITE_LABEL, PLANT_CODE
      FROM ${DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
      ORDER BY PLANT_CODE
    `)
    return Response.json({ sites: rows.map((r: any) => r.PLANT_CODE) })
  } catch (e) {
    return Response.json({ sites: [] }, { status: 500 })
  }
}
