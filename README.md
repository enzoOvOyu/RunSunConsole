# RunSunConsole

GPU cloud tenant console. Product behavior follows `PRD.md`, component behavior follows `DESIGN-SYSTEM.md`, and API/data contracts follow `ARCHITECTURE.md` and `MOCK-DATA.md`.

## Development

All development commands run on the development device in the `runsuncos` tmux session, working directory `/home/ubuntu/runsun`.

```sh
docker compose exec dev pnpm install --frozen-lockfile
docker compose exec dev pnpm dev
docker compose exec dev pnpm typecheck
docker compose exec dev pnpm test
docker compose exec dev pnpm build
```

The development endpoint is bound to `127.0.0.1:5173`. PostgreSQL and Adminer stay inside `runsun-network`. No application backend is implemented. Set `VITE_ENABLE_MOCK=false` to use the configured API gateway; MSW and derived data are loaded dynamically when enabled.

## Implementation milestones

- M1: React/TypeScript/Vite/pnpm foundation, theme and locale stores, role-aware shared navigation and command palette, aggregate overview, typed Mock contracts and deterministic business data, basic regression tests and CI.
- M2: Four independent resource lists, resource Drawers, deployment wizards, lifecycle actions and scaling integration.
- M3: Operations, workbench, datasets, object storage, pipelines and billing workflows.
- M4: Resource runtime diagnostics, secure password drafts, idempotent deployment, billing and historical data consistency.
- M5: Inference service governance, weighted release traffic, gateway settings and review before saving.

M1 validated with `pnpm typecheck`, `pnpm test` (7 files, 13 assertions), and `pnpm build`.

M2 validated with type checking, 19 regression assertions, production build, and remote Chromium checks of all resource Drawers plus a complete server deployment. Routes load on demand to retain an entry chunk under 250 KB.

M3 adds Operations (projects, quotas, cost and support), Workbench (Notebook attachments, image/model catalog, app templates and scaling policies), Data (dataset versions/previews/references, bucket prefixes/object content/lifecycle and pipeline DAG/runs/logs), and Billing (usage, transactions, invoices and vouchers).

M3 validation: 31 unit/API/architecture assertions in 9 Vitest files; 9 Chromium browser scenarios covering every navigation page, all four deployment wizards, data persistence, read-only roles, typed deletion and history, internationalization, command palette and responsive navigation. TypeScript, ESLint, Stylelint and production build pass. Entry JavaScript remains below the 250 KB budget.

M4 adds per-machine hardware health (ECC, PCIe, IB, NVMe, power and cooling), scoped vGPU nodes/workloads/control-plane diagnostics, inference replica counters and restart actions, deterministic monitoring samples, deployment options from the API, password authentication with credentials excluded from persisted state, and idempotent order submission. Metering combines pools by billing unit, retains fractional charges, accounts for voucher credits and overdue grace periods, and preserves project references after archival. Overview spend can be grouped by project or resource kind.

M4 validation: 37 tests in 9 Vitest files, plus 11 Chromium scenarios. Type checking, ESLint, Stylelint and production build pass; entry JavaScript is 142.12 KB. Browser coverage includes runtime diagnostics, replica restart persistence and password draft privacy alongside the existing workflows.

M5 implements PRD §4.3.4 service governance: weighted stable/canary releases, QPS limits and request timeouts, a change review before saving, read-only role/state guards, persisted settings and configuration audit events. Calling examples respect the service authentication setting and use an environment variable for the API key. Scaling remains managed exclusively from Workbench. API and deterministic release data contracts are documented in `ARCHITECTURE.md` §12.11.5 and `MOCK-DATA.md` §6.8.5. Actual deployment and gateway enforcement require backend services.

M5 validation: 46 tests in 10 Vitest files and 12 Chromium scenarios, including cancellation without a write, saved settings after reload, read-only controls, and English governance/event text. Type checking, ESLint, Stylelint and production build pass; entry JavaScript remains below 250 KB.

Run browser scenarios on a host with Chromium available:

```sh
# The dev server must already be running in tmux.
sh scripts/test-browser.sh
```

The browser runner reads the Playwright version from the development container, uses temporary host tooling, and copies the committed tests/config unchanged. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium executable. The Alpine development container is used for compilation, unit tests and the Vite server; browser execution takes place on the Ubuntu host.

Business data and mutations are served by MSW. Compact billing state is saved in browser storage and uploaded object content in IndexedDB. Real GPU provisioning, SSH/Jupyter/BMC sessions, external object endpoints and invoice issuance require backend services; this repository implements the frontend and its Mock contracts as scoped by the design.
