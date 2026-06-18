-- Mart: value chain P&L — CO-PA by value chain step (manufacturing → packaging → distribution).
-- Co-authored with CoCo

with chain as (
    select * from {{ ref('int_value_chain_allocation') }}
),

-- Revenue from billing at the final destination (market-facing) plant
revenue as (
    select
        material_number,
        fiscal_year,
        cast(period as int) as period,
        sum(net_revenue)    as total_revenue,
        sum(billed_qty)     as total_volume
    from {{ ref('stg_sd_billing') }}
    group by 1, 2, 3
),

-- Aggregate by material × period × chain step
step_pnl as (
    select
        c.material_number,
        mm.material_description,
        c.fiscal_year,
        c.period,
        c.chain_step,
        c.step_type,
        c.step_description,
        c.source_plant,
        c.destination_plant,
        c.mfg_cost_usd,
        c.transfer_price_usd,
        c.interco_profit_usd,
        c.transport_cost_per_unit,
        c.scc_adjustment_usd,
        c.adjusted_cost_usd,
        -- Only the final step gets revenue attribution
        case
            when c.chain_step = (
                select max(chain_step)
                from {{ ref('stg_value_chain') }} vc2
                where vc2.material_number = c.material_number
            ) then r.total_revenue
            else null
        end as attributed_revenue,
        -- Margin at each step
        c.interco_profit_usd as step_margin_usd,
        round(100.0 * c.interco_profit_usd
              / nullif(c.transfer_price_usd, 0), 1) as step_margin_pct,
        -- Cumulative cost transparency
        c.adjusted_cost_usd as cumulative_cost_to_step
    from chain c
    left join {{ ref('stg_material_master') }} mm
        on c.material_number = mm.material_number
    left join revenue r
        on c.material_number = r.material_number
        and c.fiscal_year = r.fiscal_year
        and c.period = r.period
)

select
    material_number,
    material_description,
    fiscal_year,
    period,
    chain_step,
    step_type,
    step_description,
    source_plant,
    destination_plant,
    mfg_cost_usd,
    transfer_price_usd,
    interco_profit_usd,
    transport_cost_per_unit,
    scc_adjustment_usd,
    adjusted_cost_usd,
    attributed_revenue,
    step_margin_usd,
    step_margin_pct,
    cumulative_cost_to_step,
    -- End-to-end margin (only meaningful on final step)
    case
        when attributed_revenue is not null
        then round(100.0 * (attributed_revenue - cumulative_cost_to_step)
                   / nullif(attributed_revenue, 0), 1)
        else null
    end as end_to_end_margin_pct
from step_pnl
