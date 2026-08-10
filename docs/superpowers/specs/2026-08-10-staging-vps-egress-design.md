# Staging VPS Egress Design

## Status

Approved direction pending written-spec review.

The target is the dedicated Hostinger KVM 1 VPS selected by the user.

The VPS currently has a running Evolution API Docker project and Traefik.

The Evolution project will be stopped reversibly and not deleted.

## Goal

Host the Aspen staging API on the dedicated VPS with a real default-deny outbound network policy.

Keep Production, the Production Vercel deployment and the current Preview deployment unchanged.

Produce evidence that allowed staging dependencies work and Frappe and external messaging providers cannot be reached from staging.

## Architecture

The VPS will run the self-hosted Aspen app server behind the existing Traefik reverse proxy.

The app server will serve the built frontend and `/api/*` handlers using the repository's existing `scripts/app-server.mjs` entry point.

The staging runtime will use the isolated PostgreSQL staging database and staging-only credentials.

The Evolution project will remain available for later restoration but will not run during acceptance.

The host firewall and Docker forwarding path will use default-deny egress with explicit allow rules for only the dependencies required by the staging test scope.

Container traffic will be filtered before Docker's permissive forwarding rules through the host's Docker firewall hook or an equivalent nftables forward policy.

Frappe, N8N, Evolution and CRM provider destinations will not be included in the outbound allowlist.

OpenRouter and KV will be allowed only when the selected staging tests require them.

## Network policy

The host firewall will allow established and related traffic.

The host firewall will allow inbound SSH only from the approved administrator source.

The host firewall will allow inbound HTTPS through Traefik.

The host firewall will allow outbound traffic only to the resolved, documented staging dependency addresses and required ports.

The policy will not use unrestricted `0.0.0.0/0` HTTPS egress as a substitute for an allowlist.

The OS and Docker forwarding firewall rules will be persisted and checked after a reboot or container restart.

The Hostinger managed firewall may be used as an additional inbound control, but it is not treated as the egress control.

## Safety boundaries

No Production deployment, environment variable, database or DNS record will be changed.

A staging-only hostname may be added if the existing Traefik hostname is insufficient.

No Frappe application or data will be changed.

The existing Evolution Docker project will be stopped before the staging deployment and retained for reversible restoration.

Secrets will be transferred through protected files or the VPS secret mechanism and will not be committed or printed.

Evidence will contain only status codes, rule summaries, dependency names and hashes, never credentials, tokens, raw payloads or customer data.

Any SSH, firewall or Docker change will be captured before and after the change.

## Deployment and verification flow

First capture the VPS project list, active containers, reverse-proxy routes, firewall state and available disk and memory without exposing secret values.

Then stop the Evolution project and verify that its containers are no longer running.

Build the application and run the existing self-hosted app server under a dedicated staging service.

Configure Traefik to expose only the staging hostname over HTTPS.

Apply the persisted default-deny egress rules.

Run an allowed dependency probe for PostgreSQL and any selected KV or OpenRouter dependency.

Run a sanitized blocked-destination probe for Frappe and confirm that the failure happens at the network boundary.

Run the PostgreSQL staging E2E suite against the VPS deployment.

Run the rollback-compatible legacy-read scenario only in an explicitly approved temporary exception before the final deny policy, if that scenario still requires Frappe access.

Capture the final firewall ruleset, probe results, E2E result and Evolution stopped state outside the checkout with restrictive permissions.

Restore the Evolution project only if the user explicitly requests it after acceptance evidence is captured.

## Success criteria

The staging API serves the built app over HTTPS and passes authentication and rate limiting.

PostgreSQL-only staging E2E passes without Frappe access.

The Frappe probe fails from the staging runtime while the deny policy is active.

The final ruleset survives a service restart and a VPS reboot check.

Evolution remains stopped during the acceptance window.

Production and the existing Vercel deployments remain unchanged.

The evidence directory contains no secrets, PII, raw payloads or unredacted identifiers.

## Known implementation prerequisite

The Hostinger MCP exposes VPS, Docker Compose and managed firewall operations but does not expose a live Linux shell command runner.

Applying OS-level `nftables`, installing dependencies and inspecting live routes therefore requires approved root SSH or VPS console access.

If root shell access cannot be established, no firewall mutation will be attempted through the managed Hostinger API alone.
