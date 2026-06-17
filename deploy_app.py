#!/usr/bin/env python3
"""
deploy_app.py — Deploy the React/App Runtime app with variable substitution.

Usage:
    python3 deploy_app.py [-c <connection>]
    python3 deploy_app.py -c <your-connection> -D "database=MY_DB" -D "warehouse=MY_WH"

Renders app-ui/snowflake.yml from vars.yaml before calling snow app deploy,
then restores the original template file.
"""
import subprocess, sys, yaml
from pathlib import Path

ROOT = Path(__file__).parent
SNOWFLAKE_YML = ROOT / "app-ui" / "snowflake.yml"


def parse_args():
    overrides, conn, rest = {}, None, []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "-D" and i + 1 < len(args):
            k, _, v = args[i + 1].partition("=")
            overrides[k.strip()] = v.strip()
            i += 2
        elif args[i] in ("-c", "--connection") and i + 1 < len(args):
            conn = args[i + 1]
            i += 2
        else:
            rest.append(args[i])
            i += 1
    return overrides, conn, rest


def main():
    overrides, conn, _ = parse_args()

    with open(ROOT / "vars.yaml") as f:
        vars_data = yaml.safe_load(f)
    vars_data.update(overrides)

    database  = vars_data.get("database", "APC_DEPLOY_DB")
    warehouse = vars_data.get("warehouse", "APC_DEPLOY_WH")

    # Read, render, and temporarily write snowflake.yml
    original = SNOWFLAKE_YML.read_text()
    rendered = original.replace('"{{ database }}"', database).replace('"{{ warehouse }}"', warehouse)

    print(f"Rendering app-ui/snowflake.yml: database={database}  warehouse={warehouse}")
    SNOWFLAKE_YML.write_text(rendered)

    try:
        cmd = ["snow", "app", "deploy"]
        if conn:
            cmd += ["-c", conn]
        cmd += sys.argv[1:]  # pass through any extra flags (like --build-only)
        # Remove our own -c and -D flags from passthrough
        clean = []
        args = cmd[3:]  # skip snow app deploy
        i = 0
        while i < len(args):
            if args[i] in ("-c", "-D", "--connection") and i + 1 < len(args):
                i += 2
            else:
                clean.append(args[i])
                i += 1
        final_cmd = ["snow", "app", "deploy"] + (["-c", conn] if conn else []) + clean
        r = subprocess.run(final_cmd, cwd=ROOT / "app-ui")
        if r.returncode != 0:
            print(f"ERROR: snow app deploy failed (exit {r.returncode})", file=sys.stderr)
            sys.exit(1)
    finally:
        SNOWFLAKE_YML.write_text(original)  # always restore template

    print(f"\n✓ App deployed to {database}.ANALYTICS.AI_PRODUCT_COSTING")


if __name__ == "__main__":
    main()
