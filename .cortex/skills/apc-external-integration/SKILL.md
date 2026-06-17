---
name: apc-external-integration
description: "Create an external access integration for the APC dbt project or app. Prompts the user for the target host, port, integration name, and network rule name, then generates and executes the SQL. Use when: dbt deploy requires external access, Python models call external APIs, or the app needs outbound network access. Triggers: external access, external integration, network rule, egress, outbound access, API access, external access integration, dbt external access."
---

# APC — External Access Integration

Interactive skill that creates a Snowflake **External Access Integration** (network rule + integration) so the dbt project, Python UDFs, or the app can call external endpoints. Prompts the user for all required values — nothing is hardcoded.

> Use this when `snow dbt deploy` asks for `--external-access-integrations`, when a Python model imports a package that phones home, or when any UDF/procedure needs outbound HTTPS.

## Workflow

### Step 1 — Prompt the user for variables

Ask the user (using the AskUserQuestion tool) for:

1. **Integration name** — e.g. `APC_EXTERNAL_ACCESS` (default: `APC_EXTERNAL_ACCESS`)
2. **Network rule name** — e.g. `APC_API_RULE` (default: `APC_API_RULE`)
3. **Allowed hosts** — comma-separated list of `host:port` values, e.g. `api.energy-prices.io:443, pypi.org:443`
4. **Database** — where to create the objects (default: from `vars.yaml` → `APC_DEPLOY_DB`)
5. **Schema** — where to create the network rule (default: `PUBLIC`)

### Step 2 — Create the network rule

```sql
CREATE OR REPLACE NETWORK RULE <database>.<schema>.<rule_name>
  MODE = EGRESS
  TYPE = HOST_PORT
  VALUE_LIST = ('<host1:port1>', '<host2:port2>', ...);
```

### Step 3 — Create the external access integration

```sql
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION <integration_name>
  ALLOWED_NETWORK_RULES = (<database>.<schema>.<rule_name>)
  ENABLED = TRUE;
```

### Step 4 — Verify

```sql
DESCRIBE EXTERNAL ACCESS INTEGRATION <integration_name>;
```

### Step 5 — Tell the user how to use it

Provide the flag for dbt deploy:
```bash
snow dbt deploy apc --source dbt/apc --database <DB> --schema DBT_ANALYTICS \
  --external-access-integrations <integration_name>
```

Or for a stored procedure / UDF:
```sql
CREATE OR REPLACE FUNCTION my_func(...)
  ...
  EXTERNAL_ACCESS_INTEGRATIONS = (<integration_name>)
  ...
```

## Stopping Points
- ✋ After Step 1 — confirm the collected values before executing any SQL
- ✋ After Step 3 — confirm integration was created successfully before advising usage

## Cleanup
```sql
DROP EXTERNAL ACCESS INTEGRATION IF EXISTS <integration_name>;
DROP NETWORK RULE IF EXISTS <database>.<schema>.<rule_name>;
```

## Output
A working external access integration that can be passed to `snow dbt deploy --external-access-integrations` or attached to UDFs/procedures.
