-- Intermediate: value chain allocation — intercompany transfer pricing + step-by-step cost build.
-- Co-authored with CoCo

with chain_config as (
    select * from {{ ref('stg_value_chain') }}
),

-- Get base manufacturing cost (from the first step in the chain)
base_cost as (
    select
        material_number,
        plant_code,
        fiscal_year,
        period,
        actual_cost_per_unit  as mfg_cost_usd
    from {{ ref('mart_product_cost') }}
    where material_type = 'FERT'
),

-- Build cumulative cost along value chain steps
chain_steps as (
    select
        vc.material_number,
        vc.source_plant,
        vc.destination_plant,
        vc.chain_step,
        vc.step_type,
        vc.step_description,
        vc.interco_markup_pct,
        vc.transport_cost_per_unit,
        bc.fiscal_year,
        bc.period,
        bc.mfg_cost_usd,
        -- Transfer price = mfg cost × (1 + markup%)
        round(bc.mfg_cost_usd * (1 + vc.interco_markup_pct / 100.0), 2) as transfer_price_usd,
        -- Step cost = transfer price + transport
        round(bc.mfg_cost_usd * (1 + vc.interco_markup_pct / 100.0)
              + vc.transport_cost_per_unit, 2)  as step_landed_cost_usd,
        -- Interco profit
        round(bc.mfg_cost_usd * vc.interco_markup_pct / 100.0, 2) as interco_profit_usd
    from chain_config vc
    join base_cost bc
        on vc.material_number = bc.material_number
        and vc.source_plant = bc.plant_code
),

-- Add SCC adjustments per step
with_adjustments as (
    select
        cs.*,
        coalesce(adj.total_adjustment_usd, 0) as scc_adjustment_usd,
        cs.step_landed_cost_usd + coalesce(adj.total_adjustment_usd, 0) as adjusted_cost_usd
    from chain_steps cs
    left join (
        select
            material_number,
            plant_code,
            fiscal_year,
            period,
            sum(adjustment_amount) as total_adjustment_usd
        from {{ ref('stg_scc_adjustments') }}
        group by 1, 2, 3, 4
    ) adj
        on cs.material_number = adj.material_number
        and cs.destination_plant = adj.plant_code
        and cs.fiscal_year = adj.fiscal_year
        and cs.period = adj.period
)

select * from with_adjustments
