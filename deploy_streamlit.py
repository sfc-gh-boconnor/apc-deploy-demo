#!/usr/bin/env python3
"""
deploy_streamlit.py — Upload Streamlit files to stage and create the app.

Usage (from workspace root):
    python3 deploy_streamlit.py
    python3 deploy_streamlit.py -D "database=MY_DB" -D "warehouse=MY_WH"

This script:
  1. Reads vars.yaml for default database/warehouse (overridable with -D flags).
  2. Uploads streamlit/* files to @<database>.ANALYTICS.<stage>/streamlit/
     using the base64 temp-table approach (works in workspace sandbox where PUT is blocked).
  3. Runs sql/12_streamlit.sql to create the Streamlit object and set its live version.

Requires: snow CLI available on PATH (built into Snowsight Workspaces).
"""

import base64
import os
import subprocess
import sys
import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
STREAMLIT_DIR = os.path.join(ROOT, "streamlit")
SQL_FILE = os.path.join(ROOT, "sql", "12_streamlit.sql")


def load_vars(cli_overrides: dict) -> dict:
    with open(os.path.join(ROOT, "vars.yaml")) as f:
        defaults = yaml.safe_load(f)
    return {**defaults, **cli_overrides}


def parse_d_flags() -> tuple[dict, list]:
    """Extract -D key=value overrides from sys.argv; return (overrides, remaining_args)."""
    overrides, rest = {}, []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "-D" and i + 1 < len(args):
            k, _, v = args[i + 1].partition("=")
            overrides[k.strip()] = v.strip()
            i += 2
        else:
            rest.append(args[i])
            i += 1
    return overrides, rest


def snow_sql(query: str, d_flags: list[str]) -> subprocess.CompletedProcess:
    cmd = ["snow", "sql", "--enable-templating", "JINJA"] + d_flags + ["-q", query]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


def upload_file(local_path: str, stage_path: str, vars: dict, d_flags: list[str]):
    """Upload a single file via base64 → temp table → COPY INTO stage."""
    db = vars["database"]
    stage_fqn = f"@{db}.ANALYTICS.APC_DEPLOY_STAGE"

    content = open(local_path, "rb").read()
    b64 = base64.b64encode(content).decode()
    chunks = [b64[i:i + 40000] for i in range(0, len(b64), 40000)]

    snow_sql(
        f"CREATE OR REPLACE TEMPORARY TABLE {db}.ANALYTICS.TMP_B64_UPLOAD "
        "(chunk_id INT, b64_chunk VARCHAR(16777216))",
        d_flags
    )

    for i, chunk in enumerate(chunks):
        r = snow_sql(f"INSERT INTO {db}.ANALYTICS.TMP_B64_UPLOAD VALUES ({i}, '{chunk}')", d_flags)
        if r.returncode != 0:
            print(f"  ERROR inserting chunk {i}: {r.stderr}", file=sys.stderr)
            return False

    snow_sql(
        f"CREATE OR REPLACE TEMPORARY TABLE {db}.ANALYTICS.TMP_FILE_UPLOAD AS "
        "SELECT BASE64_DECODE_STRING(LISTAGG(b64_chunk, '') WITHIN GROUP (ORDER BY chunk_id))::VARCHAR AS content "
        f"FROM {db}.ANALYTICS.TMP_B64_UPLOAD",
        d_flags
    )

    r = snow_sql(
        f"COPY INTO {stage_fqn}/{stage_path} "
        f"FROM {db}.ANALYTICS.TMP_FILE_UPLOAD "
        f"FILE_FORMAT = (FORMAT_NAME = '{db}.ANALYTICS.APC_RAW_TEXT_FF') "
        "SINGLE = TRUE OVERWRITE = TRUE HEADER = FALSE",
        d_flags
    )
    if r.returncode != 0:
        print(f"  ERROR copying to stage: {r.stderr}", file=sys.stderr)
        return False
    return True


def main():
    cli_overrides, _ = parse_d_flags()
    vars = load_vars(cli_overrides)

    d_flags = []
    for k, v in vars.items():
        d_flags.extend(["-D", f"{k}={v}"])

    stage_fqn = f"@{vars['database']}.ANALYTICS.APC_DEPLOY_STAGE"
    stage_prefix = "streamlit"

    files_to_upload = []
    for root, dirs, files in os.walk(STREAMLIT_DIR):
        for fname in files:
            local_path = os.path.join(root, fname)
            rel_path = os.path.relpath(local_path, STREAMLIT_DIR)
            stage_path = f"{stage_prefix}/{rel_path}"
            files_to_upload.append((local_path, stage_path))

    if not files_to_upload:
        print("ERROR: No files found in streamlit/ directory", file=sys.stderr)
        sys.exit(1)

    print(f"Uploading {len(files_to_upload)} file(s) to {stage_fqn}/{stage_prefix}/...")
    for local_path, stage_path in files_to_upload:
        rel = os.path.relpath(local_path, os.path.dirname(STREAMLIT_DIR))
        ok = upload_file(local_path, stage_path, vars, d_flags)
        status = "✓" if ok else "✗"
        print(f"  {status} {rel} → {stage_path}")
        if not ok:
            sys.exit(1)

    print(f"\nRunning {os.path.basename(SQL_FILE)}...")
    cmd = ["snow", "sql", "--enable-templating", "JINJA"] + d_flags + ["-f", SQL_FILE]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print(f"ERROR running SQL: {r.stderr}", file=sys.stderr)
        sys.exit(1)
    print(r.stdout[-500:] if len(r.stdout) > 500 else r.stdout)
    print(f"\n✓ Streamlit app deployed to {vars['database']}.ANALYTICS!")


if __name__ == "__main__":
    main()
