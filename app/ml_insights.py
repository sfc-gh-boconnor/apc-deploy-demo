# Forecasting and anomaly detection using Python ML libraries (replaces SQL ML functions).
# Co-authored with CoCo
"""
AI Product Costing — ML Smart Insights (Python)

Replaces sql/06_ml_insights.sql's SNOWFLAKE.ML.FORECAST and z-score anomaly
detection with Python-native implementations using statsmodels and scikit-learn.

Produces the same output tables the app reads:
  - VARIANCE_FORECAST        (6-month portfolio variance forecast)
  - VARIANCE_BACKTEST        (backtest predictions for FY2026 H1)
  - COST_ANOMALIES           (table replacing the SQL view)
  - PRODUCT_RISK_SCORES      (table replacing the SQL view)

Prerequisites:
  - sql/01 through sql/05 already run (curated data exists)
  - Views PORTFOLIO_VARIANCE_TS, PORTFOLIO_VARIANCE_TS_TRAIN,
    COST_COMPONENT_DETAIL, PRODUCT_COST_SUMMARY must exist.

Run:  python3 app/ml_insights.py
"""

import subprocess
import json
import pandas as pd
import numpy as np
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from sklearn.ensemble import IsolationForest


# ─── Helpers ──────────────────────────────────────────────────────────────────

DATABASE = "APC_DEPLOY_DB"
SCHEMA = "ANALYTICS"


def run_sql(sql: str, ignore_errors: bool = False) -> list[dict]:
    """Execute SQL via snow CLI and return rows as list of dicts."""
    result = subprocess.run(
        ["snow", "sql", "-q", sql, "--format", "json"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        if ignore_errors:
            return []
        raise RuntimeError(f"SQL failed: {result.stderr}")
    if not result.stdout.strip():
        return []
    return json.loads(result.stdout)


def query_df(sql: str) -> pd.DataFrame:
    """Run SQL and return a pandas DataFrame."""
    rows = run_sql(sql)
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def write_table(df: pd.DataFrame, table_name: str):
    """Write a DataFrame to a Snowflake table. Uses CSV file + COPY INTO for large datasets."""
    fq = f"{DATABASE}.{SCHEMA}.{table_name}"
    # Drop any existing object with same name (could be view or table)
    run_sql(f"DROP TABLE IF EXISTS {fq}", ignore_errors=True)
    run_sql(f"DROP VIEW IF EXISTS {fq}", ignore_errors=True)

    if len(df) <= 200:
        # Small datasets: direct INSERT
        cols_sql = ", ".join(
            f"{col} {'FLOAT' if df[col].dtype in ['float64', 'float32'] else 'VARCHAR' if df[col].dtype == 'object' else 'INT' if 'int' in str(df[col].dtype) else 'BOOLEAN' if df[col].dtype == 'bool' else 'VARCHAR'}"
            for col in df.columns
        )
        run_sql(f"CREATE OR REPLACE TABLE {fq} ({cols_sql})")

        for i in range(0, len(df), 50):
            chunk = df.iloc[i:i+50]
            values_list = []
            for _, row in chunk.iterrows():
                vals = []
                for col in df.columns:
                    v = row[col]
                    if pd.isna(v):
                        vals.append("NULL")
                    elif isinstance(v, (bool, np.bool_)):
                        vals.append("TRUE" if v else "FALSE")
                    elif isinstance(v, str):
                        vals.append(f"'{v.replace(chr(39), chr(39)+chr(39))}'")
                    else:
                        vals.append(str(v))
                values_list.append(f"({', '.join(vals)})")
            run_sql(f"INSERT INTO {fq} VALUES {', '.join(values_list)}")
    else:
        # Large datasets: write CSV locally, COPY FILES to stage, COPY INTO table
        import tempfile, os
        csv_path = f"/tmp/{table_name}.csv"
        df.to_csv(csv_path, index=False, header=True)

        # Create table structure
        cols_sql = ", ".join(
            f"{col} {'FLOAT' if df[col].dtype in ['float64', 'float32'] else 'VARCHAR' if df[col].dtype == 'object' else 'INT' if 'int' in str(df[col].dtype) else 'BOOLEAN' if df[col].dtype == 'bool' else 'VARCHAR'}"
            for col in df.columns
        )
        run_sql(f"CREATE OR REPLACE TABLE {fq} ({cols_sql})")

        # Use COPY FILES from workspace to a temp stage, then COPY INTO
        stage = f"@{DATABASE}.{SCHEMA}.APC_DEPLOY_STAGE/ml_tmp"
        # Upload via base64 temp table (reliable in workspace)
        import base64
        content = open(csv_path, "rb").read()
        b64 = base64.b64encode(content).decode()
        # Split into 40KB chunks for large files
        chunks = [b64[i:i+40000] for i in range(0, len(b64), 40000)]

        run_sql(f"CREATE OR REPLACE TEMPORARY TABLE {DATABASE}.{SCHEMA}.TMP_B64 (chunk_id INT, b64_chunk VARCHAR(16777216))")
        for i, chunk in enumerate(chunks):
            run_sql(f"INSERT INTO {DATABASE}.{SCHEMA}.TMP_B64 VALUES ({i}, '{chunk}')")

        run_sql(f"""
            CREATE OR REPLACE TEMPORARY TABLE {DATABASE}.{SCHEMA}.TMP_CSV_CONTENT AS
            SELECT BASE64_DECODE_STRING(LISTAGG(b64_chunk, '') WITHIN GROUP (ORDER BY chunk_id))::VARCHAR AS content
            FROM {DATABASE}.{SCHEMA}.TMP_B64
        """)

        run_sql(f"""
            COPY INTO {stage}/{table_name}.csv
            FROM {DATABASE}.{SCHEMA}.TMP_CSV_CONTENT
            FILE_FORMAT = (FORMAT_NAME = '{DATABASE}.{SCHEMA}.APC_RAW_TEXT_FF')
            SINGLE = TRUE OVERWRITE = TRUE HEADER = FALSE
        """)

        # Now COPY INTO the table from the CSV on stage
        run_sql(f"""
            COPY INTO {fq}
            FROM {stage}/{table_name}.csv
            FILE_FORMAT = (TYPE = CSV, SKIP_HEADER = 1, FIELD_OPTIONALLY_ENCLOSED_BY = '"', NULL_IF = (''))
            ON_ERROR = CONTINUE
        """)

        os.remove(csv_path)

    print(f"  ✓ {table_name}: {len(df)} rows written")


# ─── 1. FORECASTING (Holt-Winters Exponential Smoothing) ─────────────────────

def run_forecast():
    """
    Train a Holt-Winters model on the portfolio variance time series and
    produce a 6-month forward forecast with prediction intervals.
    Also runs a backtest: train through FY2025, predict FY2026 H1.
    """
    print("\n── Forecasting ──")

    # Full history: 30 monthly data points
    df = query_df(f"""
        SELECT TS, TARGET
        FROM {DATABASE}.{SCHEMA}.PORTFOLIO_VARIANCE_TS
        ORDER BY TS
    """)
    df["TS"] = pd.to_datetime(df["TS"])
    df["TARGET"] = df["TARGET"].astype(float)
    df = df.set_index("TS").asfreq("MS")

    # --- Full model (all 30 months) → forecast next 6 months ---
    model = ExponentialSmoothing(
        df["TARGET"],
        trend="add",
        seasonal="add",
        seasonal_periods=12,
    ).fit(optimized=True)

    forecast = model.forecast(6)
    # Prediction intervals (approximate using residual std)
    residual_std = model.resid.std()
    z = 1.96  # 95% CI

    forecast_df = pd.DataFrame({
        "TS": pd.date_range(df.index[-1] + pd.DateOffset(months=1), periods=6, freq="MS"),
        "FORECAST": forecast.values.round(4),
        "LOWER_BOUND": (forecast.values - z * residual_std).round(4),
        "UPPER_BOUND": (forecast.values + z * residual_std).round(4),
    })
    forecast_df["TS"] = forecast_df["TS"].dt.strftime("%Y-%m-%d")

    write_table(forecast_df, "VARIANCE_FORECAST")

    # --- Backtest: train through FY2025 (24 months), predict FY2026 H1 (6 months) ---
    train_df = df[df.index < "2026-01-01"]

    bt_model = ExponentialSmoothing(
        train_df["TARGET"],
        trend="add",
        seasonal="add",
        seasonal_periods=12,
    ).fit(optimized=True)

    bt_forecast = bt_model.forecast(6)
    bt_residual_std = bt_model.resid.std()

    backtest_df = pd.DataFrame({
        "TS": pd.date_range("2026-01-01", periods=6, freq="MS"),
        "FORECAST": bt_forecast.values.round(4),
        "LOWER_BOUND": (bt_forecast.values - z * bt_residual_std).round(4),
        "UPPER_BOUND": (bt_forecast.values + z * bt_residual_std).round(4),
    })
    backtest_df["TS"] = backtest_df["TS"].dt.strftime("%Y-%m-%d")

    write_table(backtest_df, "VARIANCE_BACKTEST")

    print("  ✓ Forecast + backtest complete (Holt-Winters Exponential Smoothing)")


# ─── 2. ANOMALY DETECTION (Isolation Forest on aggregated data) ───────────────

def run_anomaly_detection():
    """
    Use Isolation Forest on aggregated cost component data (per-component per-period)
    to identify anomalous cost patterns, then join back to detail for the output table.
    For 20K+ detail rows, we run the ML on aggregated data (~200 groups) and flag
    individual rows via SQL join.
    """
    print("\n── Anomaly Detection ──")

    # Aggregate to component × period level for ML (much smaller dataset)
    agg_df = query_df(f"""
        SELECT
            COST_COMPONENT, FISCAL_YEAR, PERIOD,
            AVG(COMPONENT_VARIANCE_PCT) AS AVG_VARIANCE,
            STDDEV(COMPONENT_VARIANCE_PCT) AS STD_VARIANCE,
            MAX(ABS(COMPONENT_VARIANCE_PCT)) AS MAX_ABS_VARIANCE,
            COUNT(*) AS N_RECORDS
        FROM {DATABASE}.{SCHEMA}.COST_COMPONENT_DETAIL
        GROUP BY 1, 2, 3
    """)

    agg_df["AVG_VARIANCE"] = agg_df["AVG_VARIANCE"].astype(float)
    agg_df["STD_VARIANCE"] = agg_df["STD_VARIANCE"].astype(float).fillna(0)
    agg_df["MAX_ABS_VARIANCE"] = agg_df["MAX_ABS_VARIANCE"].astype(float)

    # Train Isolation Forest on aggregated features
    features = agg_df[["AVG_VARIANCE", "STD_VARIANCE", "MAX_ABS_VARIANCE"]].fillna(0)
    iso = IsolationForest(n_estimators=100, contamination=0.1, random_state=42)
    agg_df["IS_ANOMALOUS_GROUP"] = iso.fit_predict(features) == -1

    # Get the anomalous groups (component × period combos)
    anomalous_groups = agg_df[agg_df["IS_ANOMALOUS_GROUP"]][
        ["COST_COMPONENT", "FISCAL_YEAR", "PERIOD"]
    ]

    # Build the COST_ANOMALIES table via SQL with z-scores and ML-flagged groups
    # Create a temp table with the anomalous group keys
    if len(anomalous_groups) > 0:
        values = ", ".join(
            f"('{row.COST_COMPONENT}', '{row.FISCAL_YEAR}', '{row.PERIOD}')"
            for _, row in anomalous_groups.iterrows()
        )
        run_sql(f"""
            CREATE OR REPLACE TEMPORARY TABLE {DATABASE}.{SCHEMA}.TMP_ANOMALY_GROUPS
            (COST_COMPONENT VARCHAR, FISCAL_YEAR VARCHAR, PERIOD VARCHAR)
        """)
        run_sql(f"INSERT INTO {DATABASE}.{SCHEMA}.TMP_ANOMALY_GROUPS VALUES {values}")
    else:
        run_sql(f"""
            CREATE OR REPLACE TEMPORARY TABLE {DATABASE}.{SCHEMA}.TMP_ANOMALY_GROUPS
            (COST_COMPONENT VARCHAR, FISCAL_YEAR VARCHAR, PERIOD VARCHAR)
        """)

    # Create the anomalies table via SQL join (fast, handles all 20K rows)
    run_sql(f"DROP TABLE IF EXISTS {DATABASE}.{SCHEMA}.COST_ANOMALIES", ignore_errors=True)
    run_sql(f"DROP VIEW IF EXISTS {DATABASE}.{SCHEMA}.COST_ANOMALIES", ignore_errors=True)
    run_sql(f"""
        CREATE TABLE {DATABASE}.{SCHEMA}.COST_ANOMALIES AS
        WITH stats AS (
            SELECT COST_COMPONENT, FISCAL_YEAR, PERIOD,
                   AVG(COMPONENT_VARIANCE_PCT) AS MEAN_VAR,
                   STDDEV(COMPONENT_VARIANCE_PCT) AS STD_VAR
            FROM {DATABASE}.{SCHEMA}.COST_COMPONENT_DETAIL
            GROUP BY 1, 2, 3
        )
        SELECT
            c.MATERIAL_NUMBER, c.MATERIAL_DESCRIPTION, c.PLANT_NAME,
            c.COST_COMPONENT, c.FISCAL_YEAR, c.PERIOD,
            ROUND(c.ACTUAL_COST, 2) AS ACTUAL_COST,
            ROUND(c.STANDARD_COST, 2) AS STANDARD_COST,
            ROUND(c.COMPONENT_VARIANCE_PCT, 2) AS VARIANCE_PCT,
            ROUND((c.COMPONENT_VARIANCE_PCT - s.MEAN_VAR) / NULLIF(s.STD_VAR, 0), 2) AS Z_SCORE,
            CASE
                WHEN ag.COST_COMPONENT IS NOT NULL
                     AND ABS((c.COMPONENT_VARIANCE_PCT - s.MEAN_VAR) / NULLIF(s.STD_VAR, 0)) > 1.0
                THEN TRUE
                ELSE FALSE
            END AS IS_ANOMALY
        FROM {DATABASE}.{SCHEMA}.COST_COMPONENT_DETAIL c
        JOIN stats s ON c.COST_COMPONENT = s.COST_COMPONENT
                    AND c.FISCAL_YEAR = s.FISCAL_YEAR AND c.PERIOD = s.PERIOD
        LEFT JOIN {DATABASE}.{SCHEMA}.TMP_ANOMALY_GROUPS ag
            ON c.COST_COMPONENT = ag.COST_COMPONENT
           AND c.FISCAL_YEAR::VARCHAR = ag.FISCAL_YEAR
           AND c.PERIOD = ag.PERIOD
        ORDER BY ABS(Z_SCORE) DESC
    """)

    # Count anomalies
    result = run_sql(f"SELECT COUNT(*) AS CNT FROM {DATABASE}.{SCHEMA}.COST_ANOMALIES WHERE IS_ANOMALY = TRUE")
    anomaly_count = result[0]["CNT"] if result else 0
    total = run_sql(f"SELECT COUNT(*) AS CNT FROM {DATABASE}.{SCHEMA}.COST_ANOMALIES")
    total_count = total[0]["CNT"] if total else 0

    print(f"  ✓ Isolation Forest + z-score: {anomaly_count} anomalies out of {total_count} records")


# ─── 3. PRODUCT RISK SCORES ──────────────────────────────────────────────────

def run_risk_scores():
    """
    Compute product risk scores from FY2026 H1 variance trajectory.
    Uses linear regression slope per product to project next-period risk.
    """
    print("\n── Product Risk Scores ──")

    df = query_df(f"""
        SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PERIOD, COST_VARIANCE_PCT
        FROM {DATABASE}.{SCHEMA}.PRODUCT_COST_SUMMARY
        WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
        ORDER BY MATERIAL_NUMBER, PERIOD
    """)

    df["COST_VARIANCE_PCT"] = df["COST_VARIANCE_PCT"].astype(float)
    df["PERIOD_NUM"] = df["PERIOD"].astype(int)

    results = []
    for (mat, desc), group in df.groupby(["MATERIAL_NUMBER", "MATERIAL_DESCRIPTION"]):
        if len(group) < 2:
            continue
        x = group["PERIOD_NUM"].values
        y = group["COST_VARIANCE_PCT"].values

        # Linear regression slope
        slope = np.polyfit(x, y, 1)[0]

        var_p001 = group.loc[group["PERIOD_NUM"] == 1, "COST_VARIANCE_PCT"].values
        var_p003 = group.loc[group["PERIOD_NUM"] == 3, "COST_VARIANCE_PCT"].values
        var_p006 = group.loc[group["PERIOD_NUM"] == 6, "COST_VARIANCE_PCT"].values

        var_p001 = round(float(var_p001[0]), 2) if len(var_p001) > 0 else None
        var_p003 = round(float(var_p003[0]), 2) if len(var_p003) > 0 else None
        var_p006 = round(float(var_p006[0]), 2) if len(var_p006) > 0 else None

        last_var = var_p006 if var_p006 is not None else (var_p003 or var_p001 or 0)
        estimated_p007 = round(last_var + slope, 2)

        # Risk classification
        if last_var > 8 or estimated_p007 > 10:
            risk = "HIGH"
        elif last_var > 5 or estimated_p007 > 7:
            risk = "MEDIUM"
        else:
            risk = "LOW"

        results.append({
            "MATERIAL_NUMBER": mat,
            "MATERIAL_DESCRIPTION": desc,
            "VAR_P001": var_p001,
            "VAR_P003": var_p003,
            "VAR_P006": var_p006,
            "SLOPE": round(slope, 4),
            "ESTIMATED_P007": estimated_p007,
            "RISK_LEVEL": risk
        })

    risk_df = pd.DataFrame(results).sort_values("SLOPE", key=abs, ascending=False)
    write_table(risk_df, "PRODUCT_RISK_SCORES")

    high = (risk_df["RISK_LEVEL"] == "HIGH").sum()
    med = (risk_df["RISK_LEVEL"] == "MEDIUM").sum()
    print(f"  ✓ Risk scores: {high} HIGH, {med} MEDIUM, {len(risk_df) - high - med} LOW")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("AI Product Costing — ML Smart Insights (Python)")
    print("=" * 70)
    print(f"\nTarget: {DATABASE}.{SCHEMA}")

    # Ensure the prerequisite views exist (from sql/06 setup portion)
    print("\n── Creating prerequisite views ──")
    run_sql(f"USE DATABASE {DATABASE}")
    run_sql(f"USE SCHEMA {DATABASE}.{SCHEMA}")

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.PORTFOLIO_VARIANCE_TS AS
        SELECT
          DATE_FROM_PARTS(FISCAL_YEAR, CAST(PERIOD AS INT), 1) AS TS,
          ROUND(AVG(COST_VARIANCE_PCT), 4) AS TARGET
        FROM {DATABASE}.{SCHEMA}.PRODUCT_COST_SUMMARY
        WHERE MATERIAL_TYPE = 'FERT'
        GROUP BY 1 ORDER BY 1
    """)

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.PORTFOLIO_VARIANCE_TS_TRAIN AS
        SELECT TS, TARGET
        FROM {DATABASE}.{SCHEMA}.PORTFOLIO_VARIANCE_TS
        WHERE TS < DATE '2026-01-01'
    """)

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.COMPONENT_COST_TS AS
        SELECT
          DATE_FROM_PARTS(FISCAL_YEAR, CAST(PERIOD AS INT), 1) AS TS,
          MATERIAL_NUMBER, COST_COMPONENT,
          ROUND(AVG(ACTUAL_COST), 4) AS ACTUAL_COST,
          ROUND(AVG(STANDARD_COST), 4) AS STANDARD_COST,
          ROUND(AVG(COMPONENT_VARIANCE_PCT), 4) AS VARIANCE_PCT
        FROM {DATABASE}.{SCHEMA}.COST_COMPONENT_DETAIL
        GROUP BY 1, 2, 3
    """)

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.PRODUCT_VARIANCE_TS AS
        SELECT
          DATE_FROM_PARTS(FISCAL_YEAR, CAST(PERIOD AS INT), 1) AS TS,
          MATERIAL_NUMBER,
          ROUND(AVG(COST_VARIANCE_PCT), 4) AS TARGET
        FROM {DATABASE}.{SCHEMA}.PRODUCT_COST_SUMMARY
        WHERE MATERIAL_TYPE = 'FERT'
        GROUP BY 1, 2
    """)

    print("  ✓ Prerequisite views created")

    # Run ML components
    run_forecast()
    run_anomaly_detection()
    run_risk_scores()

    # Recreate downstream views that depend on the tables we just wrote
    print("\n── Recreating downstream views ──")

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.FORECAST_BACKTEST_DETAIL AS
        SELECT
          a.TS,
          CONCAT('2026-P', LPAD(MONTH(a.TS)::VARCHAR, 3, '0')) AS PERIOD_LABEL,
          ROUND(a.TARGET, 2) AS ACTUAL_VARIANCE,
          ROUND(b.FORECAST, 2) AS FORECAST_VARIANCE,
          ROUND(b.LOWER_BOUND, 2) AS FORECAST_LOWER,
          ROUND(b.UPPER_BOUND, 2) AS FORECAST_UPPER,
          ROUND(ABS(a.TARGET - b.FORECAST), 2) AS ABS_ERROR_PP,
          (a.TARGET BETWEEN b.LOWER_BOUND AND b.UPPER_BOUND) AS WITHIN_CI
        FROM {DATABASE}.{SCHEMA}.PORTFOLIO_VARIANCE_TS a
        JOIN {DATABASE}.{SCHEMA}.VARIANCE_BACKTEST b
          ON a.TS = b.TS::DATE
        WHERE a.TS >= DATE '2026-01-01'
    """)

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.FORECAST_ACCURACY AS
        SELECT
          COUNT(*) AS PERIODS_TESTED,
          ROUND(AVG(ABS_ERROR_PP), 2) AS MAE_PP,
          ROUND(SQRT(AVG(ABS_ERROR_PP * ABS_ERROR_PP)), 2) AS RMSE_PP,
          ROUND(100.0 * AVG(IFF(WITHIN_CI, 1, 0)), 0) AS CI_COVERAGE_PCT,
          ROUND(100.0 - LEAST(100, AVG(ABS_ERROR_PP) * 10), 1) AS ACCURACY_SCORE
        FROM {DATABASE}.{SCHEMA}.FORECAST_BACKTEST_DETAIL
    """)

    run_sql(f"""
        CREATE OR REPLACE VIEW {DATABASE}.{SCHEMA}.VARIANCE_TREND_WITH_FORECAST AS
        SELECT TS, CONCAT(YEAR(TS), '-P', LPAD(MONTH(TS)::VARCHAR, 3, '0')) AS PERIOD_LABEL,
               ROUND(TARGET, 2) AS ACTUAL_VARIANCE,
               NULL::FLOAT AS FORECAST_VARIANCE, NULL::FLOAT AS FORECAST_LOWER,
               NULL::FLOAT AS FORECAST_UPPER, 'actual' AS DATA_TYPE
        FROM {DATABASE}.{SCHEMA}.PORTFOLIO_VARIANCE_TS
        UNION ALL
        SELECT TS::DATE, CONCAT(YEAR(TS::DATE), '-P', LPAD(MONTH(TS::DATE)::VARCHAR, 3, '0')) AS PERIOD_LABEL,
               NULL::FLOAT AS ACTUAL_VARIANCE, ROUND(FORECAST, 2) AS FORECAST_VARIANCE,
               ROUND(LOWER_BOUND, 2) AS FORECAST_LOWER, ROUND(UPPER_BOUND, 2) AS FORECAST_UPPER,
               'forecast' AS DATA_TYPE
        FROM {DATABASE}.{SCHEMA}.VARIANCE_FORECAST
        ORDER BY TS
    """)

    print("  ✓ Downstream views recreated")
    print("\n" + "=" * 70)
    print("Done. All ML tables written to {}.{}".format(DATABASE, SCHEMA))
    print("=" * 70)


if __name__ == "__main__":
    main()
