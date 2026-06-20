import { querySnowflake } from "@/lib/snowflake"
import { DATABASE, WAREHOUSE } from "@/lib/config"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const { id, api_cost_change_pct, labour_cost_change_pct, volume_multiplier, fx_adjustment_pct, energy_cost_change_pct } = await req.json()
    if (!id) return Response.json({ error: "id required" }, { status: 400 })

    const api    = parseFloat(api_cost_change_pct)    ?? 0
    const labour = parseFloat(labour_cost_change_pct) ?? 0
    const vol    = parseFloat(volume_multiplier)      ?? 1
    const fx     = parseFloat(fx_adjustment_pct)      ?? 0
    const energy = parseFloat(energy_cost_change_pct) ?? 0

    if (isNaN(api) || isNaN(labour) || isNaN(vol) || isNaN(fx) || isNaN(energy) || vol <= 0) {
      return Response.json({ error: "Invalid parameter values" }, { status: 400 })
    }

    await querySnowflake(`
      UPDATE ${DATABASE}.ANALYTICS.SCENARIO_INPUTS
      SET API_COST_CHANGE_PCT    = ${api},
          LABOUR_COST_CHANGE_PCT = ${labour},
          VOLUME_MULTIPLIER      = ${vol},
          FX_ADJUSTMENT_PCT      = ${fx},
          ENERGY_COST_CHANGE_PCT = ${energy}
      WHERE SCENARIO_ID = ${parseInt(id)} AND IS_BASE = FALSE
    `)
    return Response.json({ ok: true })
  } catch (e) {
    console.error("[scenarios/save]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 500 })
  }
}
