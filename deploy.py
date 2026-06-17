#!/usr/bin/env python3
"""
Run a templated SQL file with variables from vars.yaml.

Usage:
    python deploy.py -c <connection> -f sql/01_setup.sql
    python deploy.py -c <connection> -f sql/01_setup.sql -D "database=MY_DB"

If no -D overrides are passed for a variable, you will be prompted to confirm
or change the default from vars.yaml. Press Enter to accept the default.
"""
import subprocess, sys, yaml
from pathlib import Path


def main():
    with open(Path(__file__).parent / "vars.yaml") as f:
        defaults = yaml.safe_load(f)

    # Split user args: extract -D overrides, keep everything else
    args = sys.argv[1:]
    overrides, passthrough = {}, []
    i = 0
    while i < len(args):
        if args[i] == "-D" and i + 1 < len(args):
            k, _, v = args[i + 1].partition("=")
            overrides[k.strip()] = v.strip()
            i += 2
        else:
            passthrough.append(args[i])
            i += 1

    # Prompt for any variable not already overridden via -D
    print("\nConfigure deployment variables (press Enter to accept default):\n")
    final_vars = {}
    for key, default in defaults.items():
        if key in overrides:
            final_vars[key] = overrides[key]
            print(f"  {key}: {overrides[key]}  (from -D flag)")
        else:
            answer = input(f"  {key} [{default}]: ").strip()
            final_vars[key] = answer if answer else default

    print()

    cmd = ["snow", "sql", "--enable-templating", "JINJA"]
    for k, v in final_vars.items():
        cmd.extend(["-D", f"{k}={v}"])
    cmd.extend(passthrough)

    print(f"Running: {' '.join(cmd)}\n")
    subprocess.run(cmd)


if __name__ == "__main__":
    main()
