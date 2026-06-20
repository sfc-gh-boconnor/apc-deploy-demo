import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await querySnowflake(`
      SELECT CURRENT_ORGANIZATION_NAME() AS ORG, CURRENT_ACCOUNT_NAME() AS ACCT
    `)
    const { ORG, ACCT } = rows[0] as any
    const snowsightUrl = `https://app.snowflake.com/${ORG.toLowerCase()}/${ACCT.toLowerCase()}`
    return Response.json({ snowsightUrl })
  } catch (e) {
    return Response.json({ snowsightUrl: "" }, { status: 500 })
  }
}
