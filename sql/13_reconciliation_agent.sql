-- Deploy reconciliation semantic view and Cortex Agent for product cost driver analysis
-- Co-authored with CoCo

-- =============================================================================
-- APC Reconciliation Semantic View + Cortex Agent
-- Prerequisites: dbt pipeline built (sql/09, 10, 11 + snow dbt build)
--   - APC_DEPLOY_DB.DBT_ANALYTICS.MART_PRODUCT_COST
--   - APC_DEPLOY_DB.DBT_ANALYTICS.MART_RATE_STABILITY
--   - APC_DEPLOY_DB.DBT_ANALYTICS.MART_VOLUME_ALIGNMENT
--   - APC_DEPLOY_DB.DBT_ANALYTICS.MART_COGM_EVOLUTION
-- =============================================================================

USE DATABASE APC_DEPLOY_DB;
USE WAREHOUSE APC_DEPLOY_WH;

-- =============================================================================
-- PART 1: Semantic View (in DBT_ANALYTICS schema, alongside the marts it queries)
-- =============================================================================

USE SCHEMA DBT_ANALYTICS;

CREATE OR ALTER SEMANTIC VIEW APC_RECONCILIATION_SV
  COMMENT = 'AI Product Costing - Reconciliation and Driver Analysis. Answers why cost is over standard, which plants have rate instability, where demand is misaligned, and which product lines are escalating.'
  AS $$
name: APC_RECONCILIATION_SV
description: "AI Product Costing - Reconciliation and Driver Analysis. Answers why cost is over standard, which plants have rate instability, where demand is misaligned, and which product lines are escalating."
tables:
  - name: MART_PRODUCT_COST
    description: "Standard vs actual cost per material, plant, period. 3-way comparison with variance flags."
    base_table:
      database: APC_DEPLOY_DB
      schema: DBT_ANALYTICS
      table: MART_PRODUCT_COST
    dimensions:
      - name: COUNTRY
        description: Country of manufacturing site
        expr: COUNTRY
        data_type: VARCHAR(3)
      - name: FISCAL_YEAR
        description: Fiscal year
        expr: FISCAL_YEAR
        data_type: "NUMBER(38,0)"
      - name: MATERIAL_DESCRIPTION
        description: Product name
        expr: MATERIAL_DESCRIPTION
        data_type: VARCHAR(100)
      - name: MATERIAL_NUMBER
        description: SAP material number
        expr: MATERIAL_NUMBER
        data_type: VARCHAR(40)
      - name: PERIOD
        description: SAP posting period 001 through 012
        expr: PERIOD
        data_type: VARCHAR(16777216)
      - name: PLANT_CODE
        description: Manufacturing site code (PL01 through PL05)
        expr: PLANT_CODE
        data_type: VARCHAR(8)
      - name: PLANT_NAME
        description: Manufacturing site name
        expr: PLANT_NAME
        data_type: VARCHAR(100)
      - name: VARIANCE_FLAG
        description: "HIGH above 5 percent, MEDIUM 3 to 5 percent, LOW below 3 percent"
        expr: VARIANCE_FLAG
        data_type: VARCHAR(6)
        is_enum: true
    facts:
      - name: ACTUAL_COST_PER_UNIT
        description: Actual cost per unit in USD
        expr: ACTUAL_COST_PER_UNIT
        data_type: FLOAT
        access_modifier: public_access
      - name: COST_VARIANCE_PCT
        description: Variance percentage actual minus standard divided by standard
        expr: COST_VARIANCE_PCT
        data_type: FLOAT
        access_modifier: public_access
      - name: STANDARD_COST_PER_UNIT
        description: Standard cost per unit in USD
        expr: STANDARD_COST_PER_UNIT
        data_type: FLOAT
        access_modifier: public_access
    metrics:
      - name: AVG_VARIANCE_PCT
        description: Average cost variance percentage across portfolio
        expr: AVG(COST_VARIANCE_PCT)
        access_modifier: public_access
      - name: HIGH_VARIANCE_COUNT
        description: Count of products with variance greater than 5 percent
        expr: COUNT_IF(ABS(COST_VARIANCE_PCT) > 5)
        access_modifier: public_access

  - name: MART_RATE_STABILITY
    description: Activity rate movement tracking by cost centre. Flags UNSTABLE rates above 15 percent YoY change that drive cost escalation.
    base_table:
      database: APC_DEPLOY_DB
      schema: DBT_ANALYTICS
      table: MART_RATE_STABILITY
    dimensions:
      - name: ACTIVITY_TYPE
        description: MACHINE or LABOUR
        expr: ACTIVITY_TYPE
        data_type: VARCHAR(10)
        is_enum: true
      - name: COST_CENTRE
        description: "SAP cost centre. CC-MFG is manufacturing, CC-PKG is packaging."
        expr: COST_CENTRE
        data_type: VARCHAR(20)
      - name: RECOMMENDED_ACTION
        description: OK or MONITOR or ACTION_REQUIRED
        expr: RECOMMENDED_ACTION
        data_type: VARCHAR(15)
        is_enum: true
      - name: RS_FISCAL_YEAR
        description: Fiscal year
        expr: FISCAL_YEAR
        data_type: "NUMBER(4,0)"
      - name: RS_PLANT_CODE
        description: Plant code
        expr: PLANT_CODE
        data_type: VARCHAR(10)
      - name: RS_PLANT_NAME
        description: Plant name
        expr: PLANT_NAME
        data_type: VARCHAR(100)
      - name: STABILITY_STATUS
        description: STABLE or WATCH or UNSTABLE or NEW_RATE
        expr: STABILITY_STATUS
        data_type: VARCHAR(8)
        is_enum: true
    facts:
      - name: CURRENT_RATE
        description: Current year plan rate in dollars per hour
        expr: CURRENT_RATE
        data_type: "NUMBER(11,2)"
        access_modifier: public_access
      - name: PRIOR_RATE
        description: Prior year plan rate in dollars per hour
        expr: PRIOR_RATE
        data_type: "NUMBER(11,2)"
        access_modifier: public_access
      - name: RATE_CHANGE_PCT
        description: Year-over-year rate change percentage
        expr: RATE_CHANGE_PCT
        data_type: "NUMBER(24,1)"
        access_modifier: public_access

  - name: MART_VOLUME_ALIGNMENT
    description: Three-way volume reconciliation APO planned vs commercial forecast vs actual billing. Flags demand misalignment by plant.
    base_table:
      database: APC_DEPLOY_DB
      schema: DBT_ANALYTICS
      table: MART_VOLUME_ALIGNMENT
    dimensions:
      - name: ALIGNMENT_STATUS
        description: ALIGNED or MEDIUM_DEVIATION or HIGH_DEVIATION or UNPLANNED_DEMAND
        expr: ALIGNMENT_STATUS
        data_type: VARCHAR(16)
        is_enum: true
      - name: VA_FISCAL_YEAR
        description: Fiscal year
        expr: FISCAL_YEAR
        data_type: "NUMBER(38,0)"
      - name: VA_MATERIAL_NUMBER
        description: SAP material number
        expr: MATERIAL_NUMBER
        data_type: VARCHAR(20)
      - name: VA_PERIOD
        description: Period
        expr: PERIOD
        data_type: "NUMBER(38,0)"
      - name: VA_PLANT_CODE
        description: Plant code
        expr: PLANT_CODE
        data_type: VARCHAR(10)
    facts:
      - name: ACTUAL_BILLED_QTY
        description: Actual billed shipped quantity in units
        expr: ACTUAL_BILLED_QTY
        data_type: FLOAT
        access_modifier: public_access
      - name: PLANNED_PRODUCTION_QTY
        description: APO planned production volume in units
        expr: PLANNED_PRODUCTION_QTY
        data_type: "NUMBER(12,0)"
        access_modifier: public_access
      - name: PLAN_ACCURACY_PCT
        description: Plan accuracy percentage positive means over-planned
        expr: PLAN_ACCURACY_PCT
        data_type: FLOAT
        access_modifier: public_access
      - name: REVENUE_GAP_ESTIMATE
        description: Revenue impact of volume misalignment in dollars
        expr: REVENUE_GAP_ESTIMATE
        data_type: FLOAT
        access_modifier: public_access

  - name: MART_COGM_EVOLUTION
    description: Cost of goods manufactured by brand and therapeutic area over time. Shows cost trajectory for volume rebalancing decisions.
    base_table:
      database: APC_DEPLOY_DB
      schema: DBT_ANALYTICS
      table: MART_COGM_EVOLUTION
    dimensions:
      - name: BRAND
        description: Product brand name
        expr: BRAND
        data_type: VARCHAR(16777216)
      - name: CE_FISCAL_YEAR
        description: Fiscal year
        expr: FISCAL_YEAR
        data_type: "NUMBER(38,0)"
      - name: CE_MATERIAL_NUMBER
        description: SAP material number
        expr: MATERIAL_NUMBER
        data_type: VARCHAR(40)
      - name: CE_PERIOD
        description: Period
        expr: PERIOD
        data_type: VARCHAR(16777216)
      - name: CE_PLANT_CODE
        description: Plant code
        expr: PLANT_CODE
        data_type: VARCHAR(8)
      - name: COST_TRAJECTORY
        description: ESCALATING or IMPROVING or STABLE
        expr: COST_TRAJECTORY
        data_type: VARCHAR(10)
        is_enum: true
      - name: THERAPEUTIC_AREA
        description: Oncology or Respiratory or Cardiovascular or Gastroenterology
        expr: THERAPEUTIC_AREA
        data_type: VARCHAR(16777216)
        is_enum: true
    facts:
      - name: CE_ACTUAL_COST
        description: Actual cost per unit in USD
        expr: ACTUAL_COST_PER_UNIT
        data_type: FLOAT
        access_modifier: public_access
      - name: CE_STANDARD_COST
        description: Standard cost per unit in USD
        expr: STANDARD_COST_PER_UNIT
        data_type: FLOAT
        access_modifier: public_access
      - name: COST_CHANGE_VS_PRIOR
        description: Period-over-period cost change in dollars per unit
        expr: COST_CHANGE_VS_PRIOR
        data_type: FLOAT
        access_modifier: public_access
      - name: ROLLING_3M_AVG_COST
        description: Rolling 3-month average cost in dollars per unit
        expr: ROLLING_3M_AVG_COST
        data_type: FLOAT
        access_modifier: public_access

module_custom_instructions:
  sql_generation: |
    This semantic view supports product cost reconciliation for pharmaceutical manufacturing.
    Key context: PL03 (Dunboyne Ireland) has unstable activity rates driving 20-33% cost variance.
    PL05 (Bangalore India) has the lowest rates and spare capacity.
    When asked about cost drivers, check MART_RATE_STABILITY for rate changes and MART_VOLUME_ALIGNMENT for demand misalignment.
    When asked about savings or rebalancing, compare costs between PL03 and PL05 using MART_COGM_EVOLUTION.
    Respiratory products (Fasenra, Breztri, Symbicort, Saphnelo) and Oncology products (Enhertu, Tagrisso, Lynparza) are the key therapeutic areas.
    Always round monetary values to 2 decimal places and percentages to 1 decimal place.
  question_categorization: |
    If the question is about why costs are high or what is driving variance, this is a reconciliation question - answer it.
    If the question is about HR, salaries, or employee data, reject it as out of scope.
    If the question is about a specific plant without naming it, ask which plant they mean.

verified_queries:
  - name: PL03_RATE_INSTABILITY
    sql: "SELECT COST_CENTRE, ACTIVITY_TYPE, CURRENT_RATE, PRIOR_RATE, RATE_CHANGE_PCT, STABILITY_STATUS, RECOMMENDED_ACTION FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_RATE_STABILITY WHERE PLANT_CODE = 'PL03' AND STABILITY_STATUS = 'UNSTABLE' ORDER BY RATE_CHANGE_PCT DESC"
    question: Why are Dunboyne PL03 costs escalating?
    use_as_onboarding_question: true
  - name: VOLUME_MISALIGNMENT
    sql: "SELECT PLANT_CODE, ALIGNMENT_STATUS, COUNT(*) AS periods_flagged, ROUND(AVG(PLAN_ACCURACY_PCT), 1) AS avg_plan_accuracy, ROUND(SUM(REVENUE_GAP_ESTIMATE), 0) AS total_revenue_at_risk FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_VOLUME_ALIGNMENT WHERE ALIGNMENT_STATUS IN ('HIGH_DEVIATION', 'MEDIUM_DEVIATION') GROUP BY PLANT_CODE, ALIGNMENT_STATUS ORDER BY total_revenue_at_risk"
    question: Which plants have volume misalignment between plan and actual?
    use_as_onboarding_question: true
  - name: COST_BY_THERAPY
    sql: "SELECT THERAPEUTIC_AREA, PLANT_CODE, ROUND(AVG(ACTUAL_COST_PER_UNIT), 2) AS avg_cost, ROUND(AVG(COST_VARIANCE_PCT), 1) AS avg_variance, COUNT(CASE WHEN COST_TRAJECTORY = 'ESCALATING' THEN 1 END) AS escalating_periods FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_COGM_EVOLUTION WHERE FISCAL_YEAR = 2026 AND THERAPEUTIC_AREA IS NOT NULL GROUP BY THERAPEUTIC_AREA, PLANT_CODE ORDER BY avg_variance DESC"
    question: Which therapeutic areas are seeing cost escalation?
    use_as_onboarding_question: true
  - name: HIGHEST_VARIANCE
    sql: "SELECT MATERIAL_DESCRIPTION, PLANT_NAME, PERIOD, ROUND(ACTUAL_COST_PER_UNIT, 2) AS actual_cost, ROUND(STANDARD_COST_PER_UNIT, 2) AS standard_cost, ROUND(COST_VARIANCE_PCT, 1) AS variance_pct, VARIANCE_FLAG FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_PRODUCT_COST WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT' QUALIFY ROW_NUMBER() OVER (PARTITION BY MATERIAL_NUMBER, PLANT_CODE ORDER BY PERIOD DESC) = 1 ORDER BY ABS(COST_VARIANCE_PCT) DESC LIMIT 15"
    question: Which products have the highest cost variance?
    use_as_onboarding_question: false
$$;

-- =============================================================================
-- PART 2: Cortex Agent (in ANALYTICS schema, alongside other AI objects)
-- =============================================================================

USE SCHEMA ANALYTICS;

CREATE OR REPLACE AGENT APC_RECONCILIATION_AGENT
  COMMENT = 'Pharmaceutical product costing reconciliation assistant. Answers questions about cost variances, rate stability, volume alignment, and cost evolution using the APC dbt marts.'
  FROM SPECIFICATION $$
instructions:
  system: |
    You are a pharmaceutical product costing reconciliation assistant for the AI Product Costing accelerator.
    You help finance and supply chain teams understand cost variances, reconciliation gaps, rate stability, volume alignment, and cost evolution trends.
  response: |
    Be concise and data-driven. Use bullet points for lists. When showing variances, always include both the absolute and percentage values.
    Format currency values with 2 decimal places. Highlight any material flagged as HIGH variance.
  orchestration: |
    Use the reconciliation_analyst tool for ALL questions about product costs, variances, rate stability, volume alignment, cost components, or cost evolution.
  sample_questions:
    - question: "Which products have the highest cost variance in FY2026?"
    - question: "Show me rate stability issues at Dunboyne (PL03)"
    - question: "What is the volume alignment status for RX-9901?"
    - question: "Show the cost evolution trend for products with escalating costs"
    - question: "Break down cost components for the top variance product"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: reconciliation_analyst
      description: "Query pharmaceutical product costing data including three-way cost comparisons (actual vs standard vs budget), 9-component cost breakdowns, activity rate stability, demand vs production volume alignment, and cost-of-goods evolution with rolling trends."

tool_resources:
  reconciliation_analyst:
    semantic_view: APC_DEPLOY_DB.DBT_ANALYTICS.APC_RECONCILIATION_SV
    execution_environment:
      type: warehouse
      warehouse: APC_DEPLOY_WH
$$;
