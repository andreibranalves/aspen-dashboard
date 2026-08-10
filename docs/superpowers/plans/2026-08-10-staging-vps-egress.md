# Staging VPS Egress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Aspen staging on the dedicated Hostinger KVM 1 with persisted default-deny egress and evidence that Frappe and messaging providers are unreachable.

**Architecture:** Keep the frontend and Production deployment unchanged while deploying the existing self-hosted `scripts/app-server.mjs` application on the VPS behind Traefik. Stop the existing Evolution Docker project without deleting it, store staging secrets outside the repository, and enforce egress through the host firewall and Docker forwarding path.

**Tech Stack:** Ubuntu 24.04, Docker 29, Traefik, Node.js 22, npm, `nftables`, PostgreSQL staging, Hostinger VPS API and SSH.

## Global Constraints

- PostgreSQL is the internal source of truth.
- Frappe remains legacy and GET-only.
- N8N, Evolution and outbox providers remain disabled.
- No Production deployment, database, DNS record or environment variable changes.
- No secrets, PII, raw payloads or unredacted identifiers in the repository or evidence.
- The existing Evolution project is stopped reversibly and not deleted.
- Egress rules apply to both host traffic and Docker-forwarded container traffic.
- Every destructive or connectivity-changing step has a captured rollback command.

---

### Task 1: Capture VPS state and protected rollback evidence

**Files:**
- Create outside checkout: `/root/aspen-staging-evidence/2026-08-10/preflight.json`
- Create outside checkout: `/root/aspen-staging-backup/evolution-api-enwq/`

**Interfaces:**
- Consumes: SSH root access to the dedicated KVM 1.
- Produces: Sanitized project, container, disk, firewall and routing state plus a restorable Evolution project snapshot.

- [ ] **Step 1: Create protected evidence directories**

Run on the VPS:

```bash
install -d -m 700 /root/aspen-staging-evidence/2026-08-10 /root/aspen-staging-backup/evolution-api-enwq
```

- [ ] **Step 2: Capture Docker Compose and service metadata without secrets**

Save the existing Evolution Compose content and Traefik Compose content outside the checkout.

Redact every environment value before writing evidence.

Capture only project names, service names, image names, container states, published ports, disk usage, memory usage, active listening ports, firewall rules and Docker forwarding rules.

- [ ] **Step 3: Verify rollback material**

Confirm that the Evolution Compose file and named volume declarations are readable and that no container or volume will be deleted by the next task.

Write a SHA-256 manifest of the protected rollback files.

- [ ] **Step 4: Commit the plan**

```bash
git add docs/superpowers/plans/2026-08-10-staging-vps-egress.md
git commit -m "docs: plan staging VPS egress"
```

Expected: clean local worktree and protected VPS preflight evidence.

### Task 2: Stop external messaging provider and prepare staging runtime

**Files:**
- Create outside checkout: `/etc/aspen-dashboard/.env`
- Create outside checkout: `/opt/aspen-staging/app/`
- Create outside checkout: `/opt/aspen-staging/Dockerfile`
- Create outside checkout: `/opt/aspen-staging/docker-compose.yml`

**Interfaces:**
- Consumes: Task 1 rollback snapshot and staging database credentials.
- Produces: Stopped Evolution containers, protected staging environment file and dedicated application directory.

- [ ] **Step 1: Stop Evolution without deleting its project or volumes**

Run from the existing Evolution project directory:

```bash
docker compose stop
```

Verify that no Evolution container remains running.

Do not run `docker compose down --volumes` and do not delete the project.

- [ ] **Step 2: Create protected application directories**

```bash
install -d -m 750 /opt/aspen-staging/app
install -d -m 750 /etc/aspen-dashboard
```

The application container will run as a non-root user defined in its image.

- [ ] **Step 3: Create the protected staging environment file**

Write only staging values to `/etc/aspen-dashboard/.env` with mode `0600`.

Set `XDG_CONFIG_HOME=/etc`, `VERCEL_ENV=preview`, `STAGING_E2E=1`, `STAGING_EGRESS_BLOCKED=1`, `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` and the staging PostgreSQL/KV/OpenRouter values required by the selected tests.

Set a non-production placeholder for the legacy token only because `scripts/app-server.mjs` requires the variable to exist at startup.

Do not include Production or Frappe credentials.

- [ ] **Step 4: Transfer the current worktree without secrets**

Use SSH transfer with explicit exclusions for `.env*`, `.git`, `node_modules`, `test-results`, snapshots, dumps and local evidence directories.

Write the source under `/opt/aspen-staging/app` and record the Git commit hash separately.

- [ ] **Step 5: Create the Docker build and Compose definition**

Use a `node:22-bookworm-slim` build stage with `/opt/aspen-staging` as context, install the Chromium shared libraries and fonts without installing a system browser, copy `app/package*.json` before `npm ci`, then copy `app/` before running `npm run build` and `npm prune --omit=dev`.

Run the final container as a non-root user with `PORT=8888`, `NODE_ENV=production` and `XDG_CONFIG_HOME=/etc`, allowing the application to use its bundled `@sparticuz/chromium` executable.

Use `network_mode: host` so the host egress policy covers the app container and the existing host-network Traefik can reach `127.0.0.1:8888` through its file provider.

Mount `/etc/aspen-dashboard` read-only and load the protected environment file through Compose.

Use `restart: unless-stopped` and do not publish an additional port.

Expected: Evolution stopped, application directory populated, environment file mode `0600`, no secret files transferred.

### Task 3: Build and expose Aspen staging

**Files:**
- Modify outside checkout: `/opt/aspen-staging/app/`
- Create outside checkout: `/opt/aspen-staging/Dockerfile`
- Create outside checkout: `/opt/aspen-staging/docker-compose.yml`

**Interfaces:**
- Consumes: Task 2 source tree, Docker definition and protected environment file.
- Produces: HTTPS staging endpoint serving the built app and API through the existing Traefik file provider.

- [ ] **Step 1: Build the image before egress lockdown**

```bash
cd /opt/aspen-staging
docker compose build --no-cache
```

Expected: API JavaScript output and Vite frontend assets are generated inside the image.

- [ ] **Step 2: Configure the existing Traefik provider**

Keep the current host-network Traefik container and add its file provider with a read-only mount of `/opt/aspen-staging/traefik/dynamic`.

Create a file-provider router for the existing Hostinger hostname captured during preflight, the `websecure` entrypoint, the existing certificate resolver and service URL `http://127.0.0.1:8888`.

Remove the app container's Docker-provider labels because host-network containers have no Docker IP for the Docker provider.

Do not modify the Production hostname or its certificates.

- [ ] **Step 3: Start the staging service**

```bash
cd /opt/aspen-staging
docker compose up -d
```

Verify that the app container is healthy and that Traefik has discovered the staging router.

- [ ] **Step 4: Verify application health before egress lockdown**

Check that the staging hostname returns the login page, that authentication works, and that an authenticated PostgreSQL quotation detail request reaches the staging database.

Record only status codes and timing.

Expected: API is reachable and no Production route changed.

### Task 4: Apply persisted default-deny egress

**Files:**
- Create outside checkout: `/etc/nftables.d/aspen-staging-egress.nft`
- Create outside checkout: `/etc/systemd/system/aspen-staging-egress.service`
- Create outside checkout: `/root/aspen-staging-evidence/2026-08-10/firewall-before-after.txt`

**Interfaces:**
- Consumes: Task 3 dependency host inventory and allowed staging test scope.
- Produces: Atomic host and Docker-forwarding egress policy with rollback snapshot.

The application container uses host networking, so its outbound traffic is covered by the host output policy.
The forwarding policy remains required for any residual Docker bridge traffic.

- [ ] **Step 1: Resolve and record allowed dependency destinations**

Resolve only the PostgreSQL, KV and OpenRouter destinations required by the selected staging tests.

Record destination names, resolved address ranges, ports and the resolution timestamp outside the repository.

Do not resolve or allow Frappe, N8N, Evolution or CRM provider destinations.

- [ ] **Step 2: Write an atomic nftables policy**

Use an `inet` table with established/related acceptance, explicit required inbound rules, explicit allowed outbound destinations and a default drop policy for host output and Docker-forwarded traffic.

Filter container traffic in the Docker forwarding hook before Docker's broad accept rules.

Do not use unrestricted outbound HTTPS as an allow rule.

- [ ] **Step 3: Validate syntax and apply with rollback available**

```bash
nft -c -f /etc/nftables.d/aspen-staging-egress.nft
cp -a /etc/nftables.d/aspen-staging-egress.nft /root/aspen-staging-backup/aspen-staging-egress.nft.before
systemctl enable --now aspen-staging-egress.service
```

The custom oneshot service deletes only its own `inet aspen_staging` table before loading it, runs after Docker at boot and leaves the unrelated Hostinger nftables service disabled.

Keep an active SSH session while applying the policy.

If SSH or HTTPS is lost, run `systemctl disable --now aspen-staging-egress.service` and verify that only the custom table was removed.

- [ ] **Step 4: Verify effective Docker policy**

Inspect `nft list ruleset`, the custom systemd unit and Docker forwarding hooks.

Confirm the final ruleset is loaded after a Docker restart and does not expose an unrestricted forwarding accept path.

Expected: allowed dependencies work, all other outbound destinations are denied.

### Task 5: Run probes, staging E2E and collect acceptance evidence

**Files:**
- Create outside checkout: `/root/aspen-staging-evidence/2026-08-10/probes.json`
- Create outside checkout: `/root/aspen-staging-evidence/2026-08-10/staging-e2e.log`
- Create outside checkout: `/root/aspen-staging-evidence/2026-08-10/firewall-final.sha256`

**Interfaces:**
- Consumes: Task 4 active firewall policy and Task 3 staging endpoint.
- Produces: Evidence for the acceptance report and a pass/fail decision.

- [ ] **Step 1: Run allowed dependency probes**

Verify PostgreSQL connectivity and only the selected KV/OpenRouter dependencies.

Record boolean success, sanitized error class and timing.

- [ ] **Step 2: Run blocked-destination probes**

From the staging runtime, attempt a safe Frappe connection and confirm a network-level denial.

Do not send credentials, application payloads or write requests.

Run equivalent probes for N8N, Evolution and CRM provider destinations when their addresses are known.

- [ ] **Step 3: Run PostgreSQL staging E2E**

Point the existing Playwright staging suite at the VPS endpoint and run the PostgreSQL detail, PDF, public-link, outbox-disabled and revision-edit scenarios.

Do not run the rollback-compatible legacy-read scenario while the deny policy is active.

- [ ] **Step 4: Verify persistence**

Restart the staging Compose service and Docker without changing the policy.

Confirm the deny and allow probes have the same result.

Perform a controlled reboot check only after confirming the rollback path and console access.

- [ ] **Step 5: Hash evidence and update the acceptance report**

Hash only sanitized evidence files.

Update `docs/superpowers/reports/2026-08-08-migracao-acceptance.md` with the VPS egress evidence and remaining operational gates.

Expected: PostgreSQL staging passes, Frappe and provider probes are denied, Evolution remains stopped, and Production remains untouched.

### Task 6: Review and commit repository evidence

**Files:**
- Modify: `docs/superpowers/reports/2026-08-08-migracao-acceptance.md`
- Modify: `.superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md`

- [ ] **Step 1: Run local validation**

```bash
git diff --check
npm run check
```

- [ ] **Step 2: Run targeted diagnostics**

```bash
npx tsc -p api/tsconfig.api.json --noEmit
```

Use `lens_diagnostics` on any changed source files.

- [ ] **Step 3: Review the diff for secrets and scope**

Confirm that only plan, report and progress files changed in the repository.

Confirm that no `.env`, dump, snapshot, customer identifier or raw provider output is staged.

- [ ] **Step 4: Commit the repository evidence**

```bash
git add docs/superpowers/reports/2026-08-08-migracao-acceptance.md .superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md
git commit -m "docs: record VPS egress evidence"
```

Expected: clean worktree, verifiable evidence outside checkout and acceptance status updated without a Production change.
