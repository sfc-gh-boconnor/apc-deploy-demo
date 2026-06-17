---
name: apc-github-setup
description: "Set up the GitHub integration for the apc-deploy-demo repo in a Snowflake account so engineers can use it as a Workspace with full read and write access. Creates a Snowflake SECRET, API INTEGRATION, and GIT REPOSITORY object pointing to https://github.com/sfc-gh-boconnor/apc-deploy-demo. Triggers: set up github integration, connect github to workspace, create git repository, workspace github setup, apc github setup."
---

# APC GitHub Workspace Setup

Sets up the GitHub integration so this repo can be used as a **Snowflake Workspace**. Creates three objects in `APC_DEPLOY_DB.ANALYTICS`:

| Object | Name | What it does |
|--------|------|-------------|
| `SECRET` | `GITHUB_APC_DEPLOY_PAT` | Stores the GitHub credentials (username + PAT) |
| `API INTEGRATION` | `GITHUB_APC_DEPLOY_INTEGRATION` | Allows Snowflake to connect to `github.com/sfc-gh-boconnor` |
| `GIT REPOSITORY` | `APC_DEPLOY_REPO` | Points to the `apc-deploy-demo` repo |

---

## Prerequisites

- Role with `CREATE SECRET`, `CREATE INTEGRATION`, `CREATE GIT REPOSITORY` privileges (ACCOUNTADMIN or equivalent)
- A GitHub Personal Access Token (PAT) with **`repo` scope** (read + write). This is required for both cloning the repo into a Workspace AND pushing commits back. A read-only token will allow the Workspace to open but will fail on any write operation (commit, push).
- `APC_DEPLOY_DB` must already exist (run `sql/01_setup.sql` first if not)

---

## Step 1 — Collect inputs

Ask the engineer for:

1. **GitHub username** — their GitHub login (e.g. `sfc-gh-abainbridge`)
2. **GitHub PAT** — a personal access token with `repo` read access (or a fine-grained token with Contents: Read + Metadata: Read on this repo)

> **How to create a classic PAT with repo scope (recommended):**
> 1. Go to https://github.com/settings/tokens/new
> 2. Give it a name (e.g. `apc-deploy-snowflake-workspace`)
> 3. Check **`repo`** — this grants full read and write access to private repos
> 4. Click **Generate token** and copy the value (starts with `ghp_`)
>
> **Fine-grained PAT alternative** (more restrictive):
> 1. Go to https://github.com/settings/personal-access-tokens/new
> 2. Set **Repository access** → Only select repositories → `sfc-gh-boconnor/apc-deploy-demo`
> 3. Set **Permissions** → Repository permissions:
>    - Contents: **Read and write** (required for push/commit from Workspace)
>    - Metadata: Read-only
> 4. Click **Generate token** and copy the value
>
> ⚠️ A **read-only** token (Contents: Read-only) will let you open the Workspace but will fail on any commit or push operation.

Store the inputs in variables — do NOT print the token value.

---

## Step 2 — Verify session and database

```bash
snow sql [-c <conn>] -q "SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_USER()"
snow sql [-c <conn>] -q "SHOW DATABASES LIKE 'APC_DEPLOY_DB'"
```

If `APC_DEPLOY_DB` does not exist, stop and tell the engineer to run `sql/01_setup.sql` first.

---

## Step 3 — Create the SECRET

Show the engineer what will be created, then ask for approval before running.

```sql
CREATE OR REPLACE SECRET APC_DEPLOY_DB.ANALYTICS.GITHUB_APC_DEPLOY_PAT
  TYPE = PASSWORD
  USERNAME = '<github_username>'
  PASSWORD = '<github_pat>';
```

Run via:
```bash
snow sql [-c <conn>] -q "
CREATE OR REPLACE SECRET APC_DEPLOY_DB.ANALYTICS.GITHUB_APC_DEPLOY_PAT
  TYPE = PASSWORD
  USERNAME = '<github_username>'
  PASSWORD = '<github_pat>';"
```

Expected output: `Secret GITHUB_APC_DEPLOY_PAT successfully created.`

---

## Step 4 — Check for an existing API integration

Some Snowflake accounts already have a `GITHUB` API integration that covers `https://github.com/sfc-gh-boconnor`. **Always check first** before creating a new one — using the wrong integration name is the cause of the error `Integration 'GITHUB' does not allow specified secret`.

```bash
snow sql [-c <conn>] -q "SHOW API INTEGRATIONS;" --format json
```

Then describe any `GIT_HTTPS_API` integration that allows `https://github.com/sfc-gh-boconnor`:

```bash
snow sql [-c <conn>] -q "DESCRIBE INTEGRATION <integration_name>;"
```

Check the `API_ALLOWED_PREFIXES` value — if it already covers `https://github.com/sfc-gh-boconnor`, **use that integration name** instead of creating a new one, and add the secret to its allowed list:

```bash
# If an existing integration already covers the prefix, add the secret to it:
snow sql [-c <conn>] -q "
ALTER API INTEGRATION <existing_integration_name>
  SET ALLOWED_AUTHENTICATION_SECRETS = (APC_DEPLOY_DB.ANALYTICS.GITHUB_APC_DEPLOY_PAT);"
```

Then use that `<existing_integration_name>` in Step 5 instead of `GITHUB_APC_DEPLOY_INTEGRATION`.

**If no suitable integration exists**, create a new one:

```bash
snow sql [-c <conn>] -q "
CREATE OR REPLACE API INTEGRATION GITHUB_APC_DEPLOY_INTEGRATION
  API_PROVIDER = GIT_HTTPS_API
  API_ALLOWED_PREFIXES = ('https://github.com/sfc-gh-boconnor')
  ALLOWED_AUTHENTICATION_SECRETS = (APC_DEPLOY_DB.ANALYTICS.GITHUB_APC_DEPLOY_PAT)
  ENABLED = TRUE;"
```

Expected output: `Integration GITHUB_APC_DEPLOY_INTEGRATION successfully created.`

> ⚠️ **The `ALLOWED_AUTHENTICATION_SECRETS` list must include your secret or you will get `Integration does not allow specified secret`.** This is the most common failure — always verify with `DESCRIBE INTEGRATION <name>` after altering.

---

## Step 5 — Create the GIT REPOSITORY

Use the integration name identified in Step 4 (either the existing one or `GITHUB_APC_DEPLOY_INTEGRATION` if you created a new one):

```bash
snow sql [-c <conn>] -q "
CREATE OR REPLACE GIT REPOSITORY APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_REPO
  API_INTEGRATION = <integration_name_from_step_4>
  GIT_CREDENTIALS = APC_DEPLOY_DB.ANALYTICS.GITHUB_APC_DEPLOY_PAT
  ORIGIN = 'https://github.com/sfc-gh-boconnor/apc-deploy-demo';"
```

Expected output: `Git Repository APC_DEPLOY_REPO was successfully created.`

---

## Step 6 — Verify the connection

```bash
snow sql [-c <conn>] -q "SHOW GIT BRANCHES IN GIT REPOSITORY APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_REPO;"
```

You should see `main` in the results with the latest commit hash. If this fails with an auth error, the PAT is incorrect or lacks the required permissions.

---

## Step 7 — Open in Snowsight Workspaces

Tell the engineer:

> The Git repository is now set up. To open this repo as a Workspace in Snowsight:
>
> 1. Go to **Snowsight → Workspaces**
> 2. Click **+ New Workspace**
> 3. Select **From Git repository**
> 4. Choose `APC_DEPLOY_DB.ANALYTICS.APC_DEPLOY_REPO`
> 5. Select branch `main`
>
> CoCo skills in `.cortex/skills/` are **auto-discovered** once the Workspace is open — no install needed. Type `/apc-deploy` to deploy the accelerator.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `insufficient privileges` on `CREATE INTEGRATION` | Requires ACCOUNTADMIN or a role with `CREATE INTEGRATION` privilege. Run `GRANT CREATE INTEGRATION ON ACCOUNT TO ROLE <your_role>` as ACCOUNTADMIN. |
| `403 Forbidden` / auth error on `SHOW GIT BRANCHES` | PAT is wrong, expired, or lacks repo access. Recreate the secret with a valid token. |
| `APC_DEPLOY_DB does not exist` | Run `sql/01_setup.sql` first: `snow sql [-c <conn>] -f sql/01_setup.sql` |
| `Integration 'X' does not allow specified secret` | The integration's `ALLOWED_AUTHENTICATION_SECRETS` list doesn't include your secret. Run `ALTER API INTEGRATION <name> SET ALLOWED_AUTHENTICATION_SECRETS = (APC_DEPLOY_DB.ANALYTICS.GITHUB_APC_DEPLOY_PAT)` then retry. |
| `API_ALLOWED_PREFIXES does not match` | The origin URL must be under `https://github.com/sfc-gh-boconnor` — do not change the prefix. |
