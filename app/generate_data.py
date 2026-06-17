#!/usr/bin/env python3
"""
generate_data.py — Generate synthetic SAP product costing data for APC demo.

Produces INSERT statements for all SAP BDC tables using realistic pharma
field values (RX-XXXX compound codes, real SAP field names, plausible cost
structures). All data is entirely synthetic.

Modelling notes (pharma product costing — NOT retail seasonality):
  Standard cost is set once per fiscal year and held flat; variance accrues
  against it from operational drivers:
    * input-cost inflation drift vs the frozen annual standard (dominant)
    * planned maintenance shutdown -> overhead under-absorption spike
    * yield / scrap noise
    * a small, honest winter energy uplift on the overhead component
    * GENUINE winter demand seasonality only for tagged respiratory products
      (high winter volume -> better absorption -> lower unit cost)
  History spans FY2024 + FY2025 (12 monthly periods each) + FY2026 H1 (P001-P006,
  carrying the API-shock -> yield-crisis -> recovery narrative). Prior-year
  actuals become each year's BUDGET; standards reset annually from prior-year
  actual averages. 24+ months lets SNOWFLAKE.ML.FORECAST learn the seasonal signal.

Usage:
    python3 app/generate_data.py > sql/02_synthetic_data.sql
    snow sql -c <connection> -f sql/02_synthetic_data.sql
"""

import hashlib
import math
import random

random.seed(42)

# ── Configuration ─────────────────────────────────────────────────────────────

PLANTS = [
    ("PL01", "Macclesfield API Plant",      "GBR", "Macclesfield",  "ENG"),
    ("PL02", "Södertälje Formulation",       "SWE", "Södertälje",    "AB"),
    ("PL03", "Dunboyne Biologics",           "IRL", "Dunboyne",      "MH"),
    ("PL04", "Mount Vernon API",             "USA", "Mount Vernon",   "NY"),
    ("PL05", "Bangalore API & Formulation",  "IND", "Bangalore",     "KA"),
]

# Pharma compounds — anonymised AZD codes (realistic format)
FINISHED_PRODUCTS = [
    ("RX-1234-FIN", "AZD1234 Tablets 10mg",        "FERT", "TABLET",  "EA"),
    ("RX-2891-FIN", "AZD2891 Capsules 25mg",        "FERT", "CAPSULE", "EA"),
    ("RX-4567-FIN", "AZD4567 Injection 50mg/mL",    "FERT", "INJECT",  "ML"),
    ("RX-6103-FIN", "AZD6103 Tablets 5mg",          "FERT", "TABLET",  "EA"),
    ("RX-7890-FIN", "AZD7890 Oral Solution 2mg/mL", "FERT", "ORAL",    "ML"),
    ("RX-3312-FIN", "AZD3312 Biologics 100mg",      "FERT", "BIOLOG",  "EA"),
    ("RX-5521-FIN", "AZD5521 Patches 15mg/24h",     "FERT", "PATCH",   "EA"),
    ("RX-8834-FIN", "AZD8834 Tablets 20mg",         "FERT", "TABLET",  "EA"),
    ("RX-9901-FIN", "AZD9901 Inhaler 90mcg",        "FERT", "INHALE",  "EA"),
    ("RX-1156-FIN", "AZD1156 IV Infusion 200mg",    "FERT", "INJECT",  "ML"),
]

SEMI_FINISHED = [
    ("RX-1234-API", "AZD1234 Active Substance",  "HALB", "API",  "KG"),
    ("RX-2891-API", "AZD2891 Active Substance",  "HALB", "API",  "KG"),
    ("RX-4567-API", "AZD4567 Drug Substance",    "HALB", "API",  "KG"),
    ("RX-3312-API", "AZD3312 Biologic Substance","HALB", "BIOL", "KG"),
]

RAW_MATERIALS = [
    ("RM-EXCIP-001", "Microcrystalline Cellulose PH102", "ROH", "EXCIP", "KG"),
    ("RM-EXCIP-002", "Lactose Monohydrate 200M",         "ROH", "EXCIP", "KG"),
    ("RM-PACK-001",  "Blister Foil Alu-Alu 250mm",       "ROH", "PACK",  "M2"),
    ("RM-PACK-002",  "HDPE Bottle 100mL",                "ROH", "PACK",  "EA"),
    ("RM-SOLV-001",  "Water for Injection",               "ROH", "SOLV",  "L"),
]

ALL_MATERIALS = FINISHED_PRODUCTS + SEMI_FINISHED + RAW_MATERIALS

COST_COMPONENTS = [
    "API / Drug Substance",
    "Excipients & Solvents",
    "Primary Packaging",
    "Secondary Packaging",
    "Direct Labour",
    "Manufacturing Overhead",
    "Depreciation",
    "Quality & Analytical",
    "Energy / Utilities",
]
ENERGY_COMPONENT = "Energy / Utilities"

# Cost component weights per material type (must sum to ~1.0).
# Energy / Utilities (last) is carved out of Manufacturing Overhead.
WEIGHTS = {
    "FERT": [0.35, 0.12, 0.08, 0.05, 0.13, 0.13, 0.05, 0.04, 0.05],
    "HALB": [0.55, 0.15, 0.00, 0.00, 0.15, 0.09, 0.03, 0.00, 0.03],
    "ROH":  [0.70, 0.00, 0.00, 0.00, 0.10, 0.12, 0.05, 0.00, 0.03],
}
# Components whose actual cost rises with the winter energy uplift.
ENERGY_COMPONENTS = {"Manufacturing Overhead", "Depreciation"}

# ── Energy market model (drives the Energy / Utilities component) ───────────────
# Plant -> country (ISO3, from PLANTS) and the LEBA-style market index name.
PLANT_COUNTRY = {p[0]: p[2] for p in PLANTS}
COUNTRY_ENERGY_INDEX = {
    "GBR": "UK_POWER", "SWE": "SE_POWER", "IRL": "IE_POWER",
    "USA": "US_POWER", "IND": "IN_POWER",
}
# Energy intensity: MWh of energy per produced unit (API/biologics sites higher).
PLANT_ENERGY_INTENSITY = {
    "PL01": 0.018, "PL02": 0.012, "PL03": 0.022, "PL04": 0.016, "PL05": 0.010,
}
# Baseline wholesale energy price ($/MWh) per country.
ENERGY_BASE_PRICE = {
    "GBR": 95.0, "SWE": 60.0, "IRL": 105.0, "USA": 48.0, "IND": 80.0,
}


def _det_unit(key):
    """Deterministic [0,1) value from a key, stable across processes (hashlib)."""
    return int(hashlib.md5(str(key).encode()).hexdigest(), 16) % 10_000 / 10_000.0


def energy_wa(country, year, month):
    """Synthetic monthly volume-weighted average energy price ($/MWh) per country.
    Winter-peaked, with a 2022-style energy-crisis spike in H2 2024 easing through
    2025. Fully deterministic (no RNG) so all generators agree."""
    base = ENERGY_BASE_PRICE[country]
    seasonal = 1.0 + 0.18 * math.cos(2 * math.pi * (month - 1) / 12)  # winter peak
    if year == 2024:
        crisis = 1.35 if month >= 7 else 1.15
    elif year == 2025:
        crisis = 1.0 + max(0.0, 0.20 - 0.015 * month)
    else:
        crisis = 1.03
    drift = 1.0 + 0.02 * (year - 2024)
    jitter = 0.97 + 0.06 * _det_unit((country, year, month))  # 0.97..1.03, deterministic
    return round(base * seasonal * crisis * drift * jitter, 2)


def energy_mult(country, year, month):
    """Energy price relative to its annual average -> month-on-month cost driver."""
    months = dict(YEAR_MONTHS)[year]
    avg = sum(energy_wa(country, year, m) for m in months) / len(months)
    return energy_wa(country, year, month) / avg if avg else 1.0

CURRENCY = "USD"

# Calendar: 24 months of history + FY2026 H1 (to-date).
YEAR_MONTHS = [
    (2024, list(range(1, 13))),
    (2025, list(range(1, 13))),
    (2026, list(range(1, 7))),
]
ALL_YEARS = [y for y, _ in YEAR_MONTHS]

# Tagged respiratory products with a GENUINE winter demand-seasonal signal.
SEASONAL_PRODUCTS = {"RX-9901-FIN", "RX-7890-FIN", "RX-1156-FIN"}
# Material groups whose cost is sensitive to the FY2026 API price shock.
API_SENSITIVE_GROUPS = {"API", "BIOL", "BIOLOG", "INJECT"}
# Plants hit by the FY2026 yield crisis (May).
YIELD_CRISIS_PLANTS = {"PL03", "PL05"}
# Planned annual maintenance shutdown month per plant (overhead under-absorption).
SHUTDOWN_MONTH = {"PL01": 7, "PL02": 8, "PL03": 6, "PL04": 11, "PL05": 9}

BASE_COST = {"FERT": 45.0, "HALB": 120.0, "ROH": 8.0}
ANNUAL_INFLATION = 0.03  # standard reset uplift year over year

# Per-material and per-plant cost multipliers (drawn once, deterministic).
MATERIAL_FACTOR = {m[0]: random.uniform(0.75, 1.55) for m in ALL_MATERIALS}
PLANT_FACTOR = {p[0]: random.uniform(0.80, 1.30) for p in PLANTS}
BASE_VOLUME = {m[0]: random.uniform(800, 5200) for m in ALL_MATERIALS}


# ── Helpers ───────────────────────────────────────────────────────────────────

def esc(s):
    return s.replace("'", "''")


def is_manufacturing(mtart):
    return mtart in ("FERT", "HALB")


def is_api_sensitive(matnr, mtart, matkl):
    return mtart == "HALB" or matkl in API_SENSITIVE_GROUPS or matnr.endswith("-API")


def driver_multiplier(matnr, mtart, matkl, werks, month):
    """Actual-cost multiplier vs that year's frozen standard, from operational drivers.
    Independent of the standard value, so standards can reset annually without
    changing the driver shape."""
    mult = 1.0
    # Input-cost inflation drift accumulating from Jan (standard is flat all year).
    drift = 0.007 if is_api_sensitive(matnr, mtart, matkl) else 0.004
    mult += drift * (month - 1)
    # Planned maintenance shutdown -> overhead under-absorption spike (manufacturing).
    if is_manufacturing(mtart) and SHUTDOWN_MONTH.get(werks) == month:
        mult += random.uniform(0.08, 0.14)
    # Yield / scrap operational noise.
    mult += random.gauss(0, 0.012)
    # Small winter energy uplift on overhead-linked cost (peaks Jan, ~0..1.5%).
    if is_manufacturing(mtart):
        mult += max(0.0, 0.015 * math.cos(2 * math.pi * (month - 1) / 12))
    # Genuine winter demand seasonality for tagged respiratory products:
    # high winter volume -> better absorption -> LOWER unit cost in winter (~±4%).
    if matnr in SEASONAL_PRODUCTS:
        mult += -0.04 * math.cos(2 * math.pi * (month - 1) / 12)
    return mult


def narrative_2026(matnr, mtart, matkl, werks, month):
    """FY2026 H1 story overlay: Apr API price shock -> May yield crisis -> Jun recovery."""
    bump = 0.0
    sensitive = is_api_sensitive(matnr, mtart, matkl)
    if month == 4 and sensitive:                       # April — API price shock
        bump += random.uniform(0.12, 0.15)
    if month == 5:                                     # May — yield crisis + ongoing shock
        if sensitive:
            bump += random.uniform(0.10, 0.13)
        if werks in YIELD_CRISIS_PLANTS:
            bump += random.uniform(0.06, 0.10)
    if month == 6:                                     # June — partial recovery
        if sensitive:
            bump += random.uniform(0.05, 0.08)
        if werks in YIELD_CRISIS_PLANTS:
            bump += random.uniform(0.03, 0.05)
    return bump


def seasonal_volume(matnr, month):
    """Monthly production volume; winter-peaked for tagged respiratory products."""
    base = BASE_VOLUME[matnr]
    if matnr in SEASONAL_PRODUCTS:
        factor = 1.0 + 0.30 * math.cos(2 * math.pi * (month - 1) / 12)  # winter peak
    else:
        factor = random.uniform(0.85, 1.15)
    return round(base * factor, 2)


def build_series():
    """Compute the full monthly actual/standard series per (material, plant).
    Returns dict keyed (matnr, werks, year, month) -> {actual, std, volume},
    plus std_by_year[(matnr,werks)][year]."""
    series = {}
    std_by_year = {}
    for matnr, _desc, mtart, matkl, _uom in ALL_MATERIALS:
        base = BASE_COST[mtart] * MATERIAL_FACTOR[matnr]
        for werks, *_ in PLANTS:
            true_base = round(base * PLANT_FACTOR[werks], 2)
            stds = {}
            prev_year_actuals = None
            for year in ALL_YEARS:
                if year == 2024:
                    std = round(true_base, 2)
                else:
                    uplift = (1 + ANNUAL_INFLATION) if year >= 2026 else 1.0
                    std = round(sum(prev_year_actuals) / len(prev_year_actuals) * uplift, 2)
                stds[year] = std
                months = dict(YEAR_MONTHS)[year]
                year_actuals = []
                for month in months:
                    mult = driver_multiplier(matnr, mtart, matkl, werks, month)
                    if year == 2026:
                        mult *= (1 + narrative_2026(matnr, mtart, matkl, werks, month))
                    actual = round(std * mult, 4)
                    series[(matnr, werks, year, month)] = {
                        "actual": actual, "std": std,
                        "volume": seasonal_volume(matnr, month),
                    }
                    year_actuals.append(actual)
                # Standard for the NEXT year resets off this year's actuals.
                prev_year_actuals = year_actuals
            std_by_year[(matnr, werks)] = stds
    return series, std_by_year


# ── SQL emit helpers ────────────────────────────────────────────────────────────

def chunked_insert(table_cols, rows, batch=1000):
    """Emit one or more INSERT ... VALUES statements, batching large row sets."""
    out = []
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        out.append(f"INSERT INTO {table_cols} VALUES")
        out.append(",\n".join(chunk) + ";")
        out.append("")
    return "\n".join(out)


# ── Generators ────────────────────────────────────────────────────────────────

def plant_inserts():
    rows = [f"  ('{w}', '{esc(n)}', '{c}', '{esc(city)}', '{r}')" for w, n, c, city, r in PLANTS]
    return ("USE SCHEMA APC_DEPLOY_DB.SAP_BDC;\n\n-- Plant Master (T001W)\n"
            + chunked_insert("PLANT_MASTER (WERKS, NAME1, LAND1, ORT01, REGIO)", rows))


def material_inserts():
    rows = [f"  ('{esc(m)}', '{esc(d)}', '{t}', '{g}', '{u}')" for m, d, t, g, u in ALL_MATERIALS]
    return ("-- Material Master (MARA)\n"
            + chunked_insert("MATERIAL_MASTER (MATNR, MAKTX, MTART, MATKL, MEINS)", rows))


def valuation_inserts(std_by_year):
    """MBEW current standard = FY2026 standard; moving avg ~ standard."""
    rows = []
    for matnr, _d, mtart, _g, _u in ALL_MATERIALS:
        bklas = {"FERT": "7900", "HALB": "3000", "ROH": "3001"}[mtart]
        for werks, *_ in PLANTS:
            std = std_by_year[(matnr, werks)][2026]
            mvp = round(std * random.uniform(0.97, 1.06), 2)
            rows.append(f"  ('{esc(matnr)}', '{werks}', {std}, {mvp}, 1, '{bklas}', '2026-01-01')")
    return ("-- Material Valuation — current Standard Prices (MBEW)\n"
            + chunked_insert("MATERIAL_VALUATION (MATNR, BWKEY, STPRS, VERPR, PEINH, BKLAS, LAEPR)", rows))


def costing_and_components(series, std_by_year):
    kalnr_counter = 1000
    keko_rows = []
    split_rows = []
    for matnr, _d, mtart, matkl, _u in ALL_MATERIALS:
        weights = WEIGHTS[mtart]
        for werks, *_ in PLANTS:
            for year, months in YEAR_MONTHS:
                std_total = std_by_year[(matnr, werks)][year]
                for month in months:
                    per = f"{month:03d}"
                    kalnr = f"K{kalnr_counter:07d}"
                    kalnr_counter += 1
                    ekges = round(std_total * (weights[0] + weights[1]), 2)
                    fkges = round(std_total * (weights[5] + weights[6]), 2)
                    lgges = round(std_total * weights[4], 2)
                    kad = f"{year}-{month:02d}-01"
                    keko_rows.append(
                        f"  ('{kalnr}', '{esc(matnr)}', '{werks}', '01', "
                        f"'{kad}', '{kad}', {std_total}, {ekges}, {fkges}, {lgges}, '{CURRENCY}')"
                    )
                    rec = series[(matnr, werks, year, month)]
                    overall_mult = rec["actual"] / std_total if std_total else 1.0
                    for comp, wt in zip(COST_COMPONENTS, weights):
                        if wt == 0:
                            continue
                        std_c = round(std_total * wt, 4)
                        if comp == ENERGY_COMPONENT:
                            # Energy actual is driven by the market price index
                            # (relative to its annual baseline), not overall_mult.
                            country = PLANT_COUNTRY[werks]
                            comp_mult = energy_mult(country, year, month) * random.uniform(0.99, 1.01)
                        else:
                            comp_mult = overall_mult * random.uniform(0.97, 1.03)
                            if comp in ENERGY_COMPONENTS and is_manufacturing(mtart):
                                comp_mult += max(0.0, 0.01 * math.cos(2 * math.pi * (month - 1) / 12))
                        act_c = round(std_c * comp_mult, 4)
                        split_rows.append(
                            f"  ('{kalnr}', '{esc(matnr)}', '{werks}', {year}, '{per}', "
                            f"'{esc(comp)}', {std_c}, {act_c}, '{CURRENCY}')"
                        )
    out = ["-- Product Costing Header (KEKO)"]
    out.append(chunked_insert(
        "COSTING_HEADER (KALNR, MATNR, WERKS, TVERS, KADKY, KADAT, GSGES, EKGES, FKGES, LGGES, CURRENCY)",
        keko_rows))
    out.append("-- Cost Component Split (KEPH / CKMLCR)")
    out.append(chunked_insert(
        "COST_COMPONENT_SPLIT (KALNR, MATNR, WERKS, GJAHR, POPER, COST_COMPONENT, STANDARD_COST, ACTUAL_COST, CURRENCY)",
        split_rows))
    return "\n".join(out)


def material_ledger_inserts(series):
    rows = []
    for matnr, _d, _mt, _g, _u in ALL_MATERIALS:
        for werks, *_ in PLANTS:
            for year, months in YEAR_MONTHS:
                for month in months:
                    per = f"{month:03d}"
                    rec = series[(matnr, werks, year, month)]
                    pvprs, std, vol = rec["actual"], rec["std"], rec["volume"]
                    var1 = round((pvprs - std) * 0.6, 4)
                    var2 = round((pvprs - std) * 0.4, 4)
                    lbkum = round(vol * pvprs, 2)
                    rows.append(
                        f"  ('{werks}', '{esc(matnr)}', {year}, '{per}', "
                        f"{pvprs}, {std}, 1, {var1}, {var2}, {lbkum}, '{CURRENCY}')"
                    )
    return ("-- Material Ledger Period Actuals (CKMLCR)\n"
            + chunked_insert(
                "MATERIAL_LEDGER (BWKEY, MATNR, GJAHR, POPER, PVPRS, STPRS, PEINH, MLBWP1, MLBWP2, LBKUM, CURRENCY)",
                rows))


def budget_inserts(series):
    """Budget for year Y = prior-year (Y-1) actual for the same month. 2024 has no budget."""
    rows = []
    for matnr, _d, _mt, _g, _u in ALL_MATERIALS:
        for werks, *_ in PLANTS:
            for year, months in YEAR_MONTHS:
                if year == 2024:
                    continue
                for month in months:
                    prior = series.get((matnr, werks, year - 1, month))
                    if not prior:
                        continue
                    per = f"{month:03d}"
                    rows.append(
                        f"  ('{esc(matnr)}', '{werks}', {year}, '{per}', "
                        f"{round(prior['actual'], 4)}, '{CURRENCY}')"
                    )
    return ("-- Cost Budget — prior-year actuals carried as the period budget\n"
            + chunked_insert(
                "COST_BUDGET (MATNR, BWKEY, GJAHR, POPER, BUDGET_COST, CURRENCY)", rows))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    series, std_by_year = build_series()
    header = """-- =============================================================================
-- AI Product Costing Accelerator — Synthetic SAP BDC Data
-- =============================================================================
-- Generated by app/generate_data.py
-- All data is synthetic. Table/field names match real SAP BDC data products.
-- Calendar: FY2024 + FY2025 (12 monthly periods) + FY2026 H1 (P001-P006).
-- Standards reset annually from prior-year actual averages; prior-year actuals
-- are carried as the period BUDGET. Cost-driver model (inflation drift, planned
-- shutdowns, absorption, yield noise) + winter seasonality on respiratory lines.
-- Run: snow sql -c <connection> -f sql/02_synthetic_data.sql
-- =============================================================================
"""
    print(header)
    print(plant_inserts())
    print(material_inserts())
    print(valuation_inserts(std_by_year))
    print(costing_and_components(series, std_by_year))
    print(material_ledger_inserts(series))
    print(budget_inserts(series))
    print("-- Data load complete.")


if __name__ == "__main__":
    main()
