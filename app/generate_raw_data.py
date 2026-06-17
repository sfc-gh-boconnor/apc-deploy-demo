#!/usr/bin/env python3
"""
generate_raw_data.py — Generate RAW SAP extracts for the dbt transformation demo.

Produces INSERT statements for APC_DEPLOY_DB.SAP_RAW: genuinely messy, transactional
SAP data (material-ledger LINE ITEMS in local currency, effective-dated MBEW
standards, coded KEPH component lines, TCURR FX rates, raw master data).

It reuses build_series() from generate_data.py so the economics are IDENTICAL to
the curated APC_DEPLOY_DB data — meaning the dbt pipeline that transforms SAP_RAW can be
RECONCILED back to ANALYTICS.PRODUCT_COST_SUMMARY / SAP_BDC.COST_BUDGET.

Usage:
    python3 app/generate_raw_data.py > sql/10_raw_sap_data.sql
    snow sql -c <connection> -f sql/10_raw_sap_data.sql
"""

import random

from generate_data import (
    build_series, PLANTS, ALL_MATERIALS, WEIGHTS, YEAR_MONTHS,
    chunked_insert, esc, PLANT_COUNTRY, energy_mult, ENERGY_COMPONENT,
)

rng = random.Random(7)   # independent RNG — does not disturb build_series determinism
MANDT = "100"

# Plant -> company code, local currency, city.
PLANT_INFO = {
    "PL01": ("GB01", "GBP", "Macclesfield"),
    "PL02": ("SE01", "SEK", "Sodertalje"),
    "PL03": ("IE01", "EUR", "Dunboyne"),
    "PL04": ("US01", "USD", "Mount Vernon"),
    "PL05": ("IN01", "INR", "Bangalore"),
}
# Base FX: local-currency units per 1 USD.
FX_LOCAL_PER_USD = {"GBP": 0.79, "SEK": 10.5, "EUR": 0.92, "USD": 1.0, "INR": 83.0}

MTART_BY_MAT = {m[0]: m[2] for m in ALL_MATERIALS}
DESC_BY_MAT  = {m[0]: m[1] for m in ALL_MATERIALS}
GRP_BY_MAT   = {m[0]: m[3] for m in ALL_MATERIALS}
UOM_BY_MAT   = {m[0]: m[4] for m in ALL_MATERIALS}


def local_per_usd(currency, year, month):
    """Base rate with a small deterministic monthly drift (stored exactly in TCURR)."""
    base = FX_LOCAL_PER_USD[currency]
    drift = 1.0 + 0.02 * ((year - 2024) + month / 12.0 - 1)  # gentle multi-year drift
    return round(base * drift, 6)


def inverted_gdatu(year, month):
    return str(99999999 - int(f"{year}{month:02d}01"))


# ── Master data ────────────────────────────────────────────────────────────────

def mara_inserts():
    rows = []
    for matnr, desc, mtart, matkl, uom in ALL_MATERIALS:
        # trailing spaces on MATNR to force a trim in staging
        rows.append(f"  ('{MANDT}', '{esc(matnr)}  ', '{esc(desc)}', '{mtart}', '{matkl}', '{uom}')")
    return ("USE SCHEMA APC_DEPLOY_DB.SAP_RAW;\n\n-- MARA material master (raw)\n"
            + chunked_insert("MARA_RAW (MANDT, MATNR, MAKTX, MTART, MATKL, MEINS)", rows))


def t001w_inserts():
    rows = []
    for werks, name, land, city, _r in PLANTS:
        bukrs, cur, _city = PLANT_INFO[werks]
        rows.append(f"  ('{MANDT}', '{werks} ', '{esc(name)}', '{land}', '{bukrs}', '{cur}', '{esc(city)}')")
    return ("-- T001W plant master (raw)\n"
            + chunked_insert("T001W_RAW (MANDT, WERKS, NAME1, LAND1, BUKRS, WAERS, ORT01)", rows))


def tcurr_inserts(years_months):
    rows = []
    for cur in ["GBP", "SEK", "EUR", "INR", "USD"]:
        for year, months in years_months:
            for month in months:
                lpu = local_per_usd(cur, year, month)
                ukurs = round(1.0 / lpu, 8)  # USD per 1 local unit
                rows.append(f"  ('{MANDT}', 'M', '{cur}', 'USD', '{inverted_gdatu(year, month)}', {ukurs})")
    return ("-- TCURR FX rates (FCURR -> USD, monthly, inverted GDATU)\n"
            + chunked_insert("TCURR_RAW (MANDT, KURST, FCURR, TCURR, GDATU, UKURS)", rows))


# ── Transactional + valuation data ──────────────────────────────────────────────

def split_amount(total, n):
    """Split a total into n positive parts that sum exactly to total (2dp)."""
    if n == 1:
        return [round(total, 2)]
    fracs = [rng.uniform(0.5, 1.5) for _ in range(n)]
    s = sum(fracs)
    parts = [round(total * f / s, 2) for f in fracs]
    parts[-1] = round(total - sum(parts[:-1]), 2)
    return parts


def material_ledger_doc_inserts(series):
    rows = []
    belnr = 4500000000
    for matnr, _d, _mt, _g, _u in ALL_MATERIALS:
        for werks, *_ in PLANTS:
            _bukrs, cur, _city = PLANT_INFO[werks]
            bukrs = _bukrs
            for year, months in YEAR_MONTHS:
                for month in months:
                    rec = series[(matnr, werks, year, month)]
                    lpu = local_per_usd(cur, year, month)
                    qty_total = round(rec["volume"], 2)
                    local_unit = rec["actual"] * lpu
                    amt_total = round(local_unit * qty_total, 2)

                    n = rng.choice([2, 2, 3])
                    qty_parts = split_amount(qty_total, n)
                    amt_parts = split_amount(amt_total, n)
                    day = rng.randint(1, 28)
                    budat = f"{year}{month:02d}{day:02d}"
                    mat_raw = f"{matnr}  "      # trailing spaces (needs trim)
                    werks_raw = f"{werks} "

                    def emit(q, a, bwart, buzei):
                        nonlocal belnr
                        belnr += 1
                        rows.append(
                            f"  ('{MANDT}', '{belnr}', {buzei}, '{esc(mat_raw)}', '{werks_raw}', "
                            f"'{bukrs}', {year}, {month}, '{bwart}', {q}, {a}, '{cur}', '{budat}')"
                        )

                    for i, (q, a) in enumerate(zip(qty_parts, amt_parts), start=1):
                        emit(q, a, "101", i)

                    # ~25% of periods get a reversal pair that nets to zero (needs netting).
                    if rng.random() < 0.25:
                        qr = round(qty_parts[0] * 0.4, 2)
                        ar = round(amt_parts[0] * 0.4, 2)
                        emit(qr, ar, "101", 8)
                        emit(-qr, -ar, "102", 9)

                    # ~2% duplicate extract row (SAME doc key emitted twice) -> dedupe in staging.
                    if rng.random() < 0.02:
                        last = rows[-1]
                        rows.append(last)

                    # ~1% incomplete posting: NULL amount junk row -> filtered in staging.
                    if rng.random() < 0.01:
                        belnr += 1
                        rows.append(
                            f"  ('{MANDT}', '{belnr}', 1, '{esc(mat_raw)}', '{werks_raw}', "
                            f"'{bukrs}', {year}, {month}, '261', {round(rng.uniform(1,9),2)}, NULL, '{cur}', '{budat}')"
                        )
    return ("-- CKMLCR material-ledger posting line items (raw, local currency)\n"
            + chunked_insert(
                "MATERIAL_LEDGER_DOC (MANDT, BELNR, BUZEI, MATNR, WERKS, BUKRS, GJAHR, POPER, BWART, MENGE, DMBTR, WAERS, BUDAT)",
                rows))


def mbew_inserts(std_by_year):
    rows = []
    for matnr, _d, _mt, _g, _u in ALL_MATERIALS:
        for werks, *_ in PLANTS:
            _bukrs, cur, _city = PLANT_INFO[werks]
            for year in [y for y, _ in YEAR_MONTHS]:
                std_usd = std_by_year[(matnr, werks)][year]
                stprs_local = round(std_usd * local_per_usd(cur, year, 1), 2)
                vfrom = f"{year}0101"
                rows.append(
                    f"  ('{MANDT}', '{esc(matnr)} ', '{werks}', {stprs_local}, 1, '{cur}', '{vfrom}', '{vfrom}')"
                )
    return ("-- MBEW standard prices (effective-dated, local currency)\n"
            + chunked_insert(
                "MBEW_RAW (MANDT, MATNR, BWKEY, STPRS, PEINH, WAERS, VALID_FROM, LAEPR)", rows))


def keph_inserts(series, std_by_year):
    rows = []
    kaln = 700000
    for matnr, _d, mtart, _g, _u in ALL_MATERIALS:
        weights = WEIGHTS[mtart]
        for werks, *_ in PLANTS:
            _bukrs, cur, _city = PLANT_INFO[werks]
            for year, months in YEAR_MONTHS:
                std_total = std_by_year[(matnr, werks)][year]
                for month in months:
                    rec = series[(matnr, werks, year, month)]
                    lpu = local_per_usd(cur, year, month)
                    kaln += 1
                    kalnr = f"K{kaln:08d}"
                    energy_idx = len(weights)  # Energy / Utilities is the last weight
                    for idx, wt in enumerate(weights, start=1):
                        if wt == 0:
                            continue
                        std_local = round(std_total * wt * lpu, 4)
                        if idx == energy_idx:
                            # Energy element tracks the market price index, not overall actual.
                            act_usd = std_total * wt * energy_mult(PLANT_COUNTRY[werks], year, month)
                        else:
                            act_usd = rec["actual"] * wt
                        act_local = round(act_usd * lpu, 4)
                        rows.append(f"  ('{MANDT}', '{kalnr}', '{esc(matnr)}', '{werks}', {year}, {month}, {idx}, 'S', {std_local}, '{cur}')")
                        rows.append(f"  ('{MANDT}', '{kalnr}', '{esc(matnr)}', '{werks}', {year}, {month}, {idx}, 'A', {act_local}, '{cur}')")
    return ("-- KEPH cost component split (coded elements, std + actual, local currency)\n"
            + chunked_insert(
                "KEPH_RAW (MANDT, KALNR, MATNR, WERKS, GJAHR, POPER, ELEMENT, RECTYPE, WERTN, WAERS)", rows))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    series, std_by_year = build_series()
    print("""-- =============================================================================
-- AI Product Costing Accelerator — RAW SAP extract DATA (APC_DEPLOY_DB.SAP_RAW)
-- =============================================================================
-- Generated by app/generate_raw_data.py — reuses generate_data.build_series() so
-- the dbt pipeline output reconciles to the curated ANALYTICS views.
-- Run AFTER sql/09_raw_sap.sql.
-- =============================================================================
""")
    print(mara_inserts())
    print(t001w_inserts())
    print(tcurr_inserts(YEAR_MONTHS))
    print(mbew_inserts(std_by_year))
    print(material_ledger_doc_inserts(series))
    print(keph_inserts(series, std_by_year))
    print("-- Raw load complete.")


if __name__ == "__main__":
    main()
