# RunSunConsole

> GPU cloud tenant console — frontend and its Mock contracts.

[![CI](https://github.com/enzoOvOyu/RunSunConsole/actions/workflows/ci.yml/badge.svg)](https://github.com/enzoOvOyu/RunSunConsole/actions/workflows/ci.yml)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Vite%20%2B%20TypeScript-61dafb)
![Scope](https://img.shields.io/badge/scope-frontend%20%2B%20MSW%20mock-blue)
![Node](https://img.shields.io/badge/node-22%2B-339933)

RunSunConsole is a web console for managing GPU cloud tenants. Product behavior follows
[`PRD.md`](./PRD.md), component behavior follows [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md), and
API/data contracts follow [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`MOCK-DATA.md`](./MOCK-DATA.md).

**Scope:** This repository implements the **frontend and its Mock contracts** (MSW). No application
backend is implemented — real GPU provisioning, SSH/Jupyter/BMC sessions, external object endpoints
and invoice issuance require backend services.

## Preview

**Overview** — aggregate spend, region × type GPU allocation matrix, quotas, trend and activity:

![RunSunConsole overview](./assets/overview.png)

**Resource creation flow** (server instance) — project/region/name → GPU pool → spec → network →
review & create, with a live cost estimate on the right:

![RunSunConsole resource creation flow](./assets/resource-creation.gif)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Scripts](#scripts)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Milestones](#milestones)
- [Testing](#testing)
- [Status & Scope](#status--scope)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Role-aware shell** — shared navigation, command palette (`cmdk`) and locale stores (English / Chinese).
- **Aggregate overview** — spend grouped by project or resource kind; comparable summary cards.
- **Four resource kinds** — server instances, bare metal clusters, vGPU clusters, inference services,
  each with type-specific lists, Drawers, filters and specification fields.
- **Deployment & lifecycle** — four deployment wizards, lifecycle actions and scaling integration.
- **Operations** — projects, quotas, cost analysis, support tickets; Workbench (Notebook, image/model
  catalog, app templates, scaling policies); Data (dataset versions/previews, object storage, pipeline DAG);
  Billing (usage, transactions, invoices, vouchers).
- **Runtime diagnostics** — per-machine hardware health (ECC, PCIe, IB, NVMe, power, cooling), vGPU
  node/workload diagnostics, inference replica counters and restarts.
- **Inference governance** — weighted stable/canary releases, QPS limits, request timeouts, change review
  before save, persisted settings and audit events.
- **Network management** — regional, project-isolated VPCs/subnets, independent EIP lifecycle and metering,
  security-group rules, IPsec tunnels, per-device private addresses.

## Tech Stack

| Layer        | Choice                                                            |
| ------------ | ----------------------------------------------------------------- |
| Framework    | React 18 + TypeScript + Vite                                      |
| Runtime      | Node 22, pnpm                                                     |
| State        | Zustand (theme & locale), TanStack Query, React Hook Form + Zod   |
| UI           | Radix UI primitives, `lucide-react` icons, `recharts` / `@visx` charts |
| Routing      | React Router                                                      |
| Data Mock    | MSW (Mock Service Worker) with typed contracts                   |
| Testing      | Vitest (unit), Playwright (browser)                              |
| Quality      | ESLint, Stylelint, Prettier                                       |
| CI           | GitHub Actions (`ci.yml`: typecheck → test → build)               |

## Quick Start

**Prerequisites:** Docker, Docker Compose, pnpm, Node 22.

> The project is designed to run inside a `runsuncos` tmux session on the development device,
> working directory `/home/ubuntu/runsun`. The commands below assume Docker Compose is available.

```sh
# 1. Install dependencies (inside the dev container)
docker compose exec dev pnpm install --frozen-lockfile

# 2. Start the dev server (listens on 0.0.0.0:5173)
docker compose exec dev pnpm dev

# 3. Open the console
#    http://127.0.0.1:5173  (local)  /  http://<host-ip>:5173
```

The dev endpoint binds all host interfaces at port `5173`. PostgreSQL and Adminer stay inside
`runsun-network`. Set `VITE_ENABLE_MOCK=false` to use the configured API gateway; MSW and derived
data are loaded dynamically when enabled.

## Scripts

| Command                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `pnpm dev`             | Start Vite dev server (`--host 0.0.0.0`, port 5173)  |
| `pnpm build`           | Type-check (`tsc -b`) then production build          |
| `pnpm typecheck`       | `tsc -b --force --noEmit`                            |
| `pnpm test`            | Run unit tests (Vitest)                              |
| `pnpm test:watch`      | Vitest watch mode                                    |
| `pnpm test:e2e`        | Playwright browser tests                             |
| `pnpm lint`            | ESLint                                               |
| `pnpm lint:styles`     | Stylelint on `src/**/*.css`                          |
| `pnpm format`          | Prettier write on `src`                              |

## Project Structure

```
RunSunConsole/
├── src/
│   ├── app/            # Router, layout, sidebar/topbar/status bar
│   ├── components/     # Shared UI (ui/, charts/, command palette)
│   ├── features/       # overview, resources, deployment, ops, network, billing, ...
│   ├── i18n/           # en-US / zh-CN locales
│   ├── lib/            # API client, rbac, money, ids, schema
│   ├── mocks/          # MSW handlers (browser + node)
│   ├── stores/         # Zustand stores (auth, region, locale, theme)
│   └── types/          # Domain types
├── public/             # Static assets + MSW worker
├── tests/              # Test setup / shared helpers
├── scripts/            # Tooling (e.g. test-browser.sh)
├── PRD.md              # Product requirements
├── ARCHITECTURE.md     # API & data contracts
├── DESIGN-SYSTEM.md    # Component behavior
├── MOCK-DATA.md        # Mock data contracts
├── AGENTS.md           # Agent / contributor guidance
├── DOC-AUDIT.md        # Documentation audit
├── docker-compose.yml  # Dev container stack
└── vite / vitest / playwright configs
```

## Documentation

| Document                     | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| [`PRD.md`](./PRD.md)         | Product requirements and behavior                      |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | API & data contracts (incl. §12.11.5, §16) |
| [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) | Component behavior & tokens                  |
| [`MOCK-DATA.md`](./MOCK-DATA.md) | Mock data contracts (incl. §6.8.5)                  |
| [`AGENTS.md`](./AGENTS.md)   | Guidance for AI agents / contributors                 |
| [`DOC-AUDIT.md`](./DOC-AUDIT.md) | Documentation audit log                            |
| [`GPU弹性伸缩策略四场景对比.md`](./GPU弹性伸缩策略四场景对比.md) | GPU autoscaling scenario comparison |

## Milestones

| Milestone | Theme                                                          | Validation (tests / browser)        |
| --------- | ------------------------------------------------------------- | ------------------------------------ |
| **M1**    | Foundation, theme/locale, navigation, overview, Mock contracts | 7 Vitest / 13 assertions             |
| **M2**    | Resource lists, Drawers, deployment wizards, scaling          | 19 assertions + browser checks       |
| **M3**    | Operations, Workbench, Data, Billing                          | 31 assertions (9 files) / 9 scenarios|
| **M4**    | Diagnostics, password drafts, idempotent deploy, billing      | 37 (9 files) / 11 scenarios; 142 KB  |
| **M5**    | Inference governance, weighted release, review-before-save     | 46 (10 files) / 12 scenarios         |
| **M6**    | Regional allocation, bare metal, RAM quotas, responsive       | 54 (12 files) / 16 scenarios; 153 KB |
| **M7**    | Network management (VPC/EIP/SG/IPsec) & quotas               | 68 assertions (13 files) / 21+5 scenarios; 173 KB |
| **M8**    | 41-resource Mock catalog, navigation & labels                | 71 assertions (14 files) / 24 scenarios |

Entry JavaScript stays under the **250 KB** budget across all milestones.

<details>
<summary><strong>M1 — Foundation</strong></summary>

React/TypeScript/Vite/pnpm foundation, theme and locale stores, role-aware shared navigation and
command palette, aggregate overview, typed Mock contracts and deterministic business data, basic
regression tests and CI. Validated with `pnpm typecheck`, `pnpm test` (7 files, 13 assertions) and
`pnpm build`.

</details>

<details>
<summary><strong>M2 — Resources & deployment</strong></summary>

Four independent resource lists, resource Drawers, deployment wizards, lifecycle actions and scaling
integration. Validated with type checking, 19 regression assertions, production build, and remote
Chromium checks of all resource Drawers plus a complete server deployment. Routes load on demand to
keep an entry chunk under 250 KB.

</details>

<details>
<summary><strong>M3 — Operations / Workbench / Data / Billing</strong></summary>

Adds Operations (projects, quotas, cost and support), Workbench (Notebook attachments, image/model
catalog, app templates and scaling policies), Data (dataset versions/previews/references, bucket
prefixes/object content/lifecycle and pipeline DAG/runs/logs), and Billing (usage, transactions,
invoices and vouchers).

Validation: 31 unit/API/architecture assertions in 9 Vitest files; 9 Chromium scenarios covering every
navigation page, all four deployment wizards, data persistence, read-only roles, typed deletion and
history, i18n, command palette and responsive navigation. TypeScript, ESLint, Stylelint and production
build pass. Entry JavaScript remains below the 250 KB budget.

</details>

<details>
<summary><strong>M4 — Diagnostics & billing consistency</strong></summary>

Adds per-machine hardware health (ECC, PCIe, IB, NVMe, power and cooling), scoped vGPU
nodes/workloads/control-plane diagnostics, inference replica counters and restart actions, deterministic
monitoring samples, deployment options from the API, password authentication with credentials excluded
from persisted state, and idempotent order submission. Metering combines pools by billing unit, retains
fractional charges, accounts for voucher credits and overdue grace periods, and preserves project
references after archival. Overview spend can be grouped by project or resource kind.

Validation: 37 tests in 9 Vitest files, plus 11 Chromium scenarios. Type checking, ESLint, Stylelint
and production build pass; entry JavaScript is 142.12 KB. Browser coverage includes runtime diagnostics,
replica restart persistence and password draft privacy.

</details>

<details>
<summary><strong>M5 — Inference service governance</strong></summary>

Implements PRD §4.3.4 service governance: weighted stable/canary releases, QPS limits and request
timeouts, a change review before saving, read-only role/state guards, persisted settings and
configuration audit events. Calling examples respect the service authentication setting and use an
environment variable for the API key. Scaling remains managed exclusively from Workbench. API and
deterministic release data contracts are documented in `ARCHITECTURE.md` §12.11.5 and `MOCK-DATA.md` §6.8.5.
Actual deployment and gateway enforcement require backend services.

Validation: 46 tests in 10 Vitest files and 12 Chromium scenarios, including cancellation without a
write, saved settings after reload, read-only controls, and English governance/event text. Type checking,
ESLint, Stylelint and production build pass; entry JavaScript remains below 250 KB.

</details>

<details>
<summary><strong>M6 — Allocation, bare metal & quotas</strong></summary>

Follows the updated overview requirements: four comparable summary cards, a region-by-type allocation
matrix with type-specific machine/cluster/replica quantities, and no independent region summary. Host RAM
quotas derive from assigned VM memory, physical machines, node pools and inference allocations; cloud
storage remains separate. Peak scaling preflight includes RAM. VM disk and vGPU PVC sizes are normalized
when restoring existing Mock state, preserving saved resources, projects and historical billing.

Bare metal Drawers now include every physical machine, cluster RAM/NVMe totals, and selected-machine
hardware, BMC, network and firmware details. Machine identities align with placement records, and
monitoring query keys and seeds include the selected machine index. Navigation uses distinct submenu
icons and the label “My resources”. Deployment forms keep a wider estimate card on the right at
desktop/laptop widths, with horizontal steps and a stacked layout on small screens.

Validation: 54 tests in 12 Vitest files and 16 Chromium scenarios; type checking, ESLint, Stylelint and
build pass. Browser coverage includes allocation semantics, all machines and BMC switching,
1280/1440/1920 px deployment layouts, mobile overflow, and restoring saved state with a repaired PVC
size. Entry JavaScript is 152.85 KB.

</details>

<details>
<summary><strong>M7 — Network management & quotas</strong></summary>

Network Management adds regional, project-isolated VPCs and vSwitches, per-device private addresses,
independent EIP allocation/binding/release and retention metering, VM security-group rules and
associations, and IPsec tunnel configuration. All four deployment wizards consume scoped network options;
compute Drawers expose effective per-device network information. The Quotas page includes regional network
counts, limits, remaining capacity, utilization, EIP allocation breakdown, subnet address pools and quota
request links with region/metric context.

Existing browser snapshots migrate without dropping compute resources or historical bills. EIP fees and
quota remain allocated after unbind, VM stop or VM deletion, and end on EIP release. PSKs are validated
only and never stored or returned. Network actions follow existing roles and dependency checks. This
remains a frontend/MSW implementation: no actual firewall rules, routes or VPN connections are applied.
Product and API contracts are in PRD §14 and ARCHITECTURE §16, with official Alibaba Cloud references in
the PRD.

Validation: 68 Vitest assertions in 13 files; all 21 Chromium scenarios, followed by 5 network scenarios
after the final quota layout and input-limit adjustments. TypeScript, ESLint, Stylelint, `git diff
--check` and production build pass. Entry JavaScript is 173.49 kB, below the 250 kB budget. Remote
screenshots were inspected for network details and the expanded quota page.

</details>

<details>
<summary><strong>M8 — Resource specifications & navigation</strong></summary>

The fresh Mock catalog now contains 41 logical resources across all four regions and all four resource
kinds while retaining the 1,040 allocated GPU total. Server instances cover 1/2/4/8 GPU shapes, bare
metal clusters vary by machine and RAID configuration, vGPU clusters vary by slicing and control-plane
tier, and inference services vary by model, engine and quantization. Resource lists show the relevant
specification fields and offer type-specific filters. Existing browser-saved Mock state remains intact;
the expanded seed applies to a fresh browser state.

The Operations navigation group is labeled “Projects & Support” and contains projects, quotas and
tickets. Cost Analysis is under Billing at `/billing/cost`, with the former route redirecting there. The
bare metal Drawer no longer shows the out-of-band management tab; BMC/IPMI Mock data and provisioning
behavior remain available to the underlying contract.

Validation: 71 Vitest assertions in 14 files, 24 Chromium scenarios, TypeScript, ESLint, production build
and `git diff --check` pass. The entry JavaScript remains below the 250 kB budget.

</details>

## Testing

Business data and mutations are served by MSW. Compact billing state is saved in browser storage and
uploaded object content in IndexedDB.

**Unit tests**

```sh
docker compose exec dev pnpm test
```

**Browser scenarios** (run on a host with Chromium available; the dev server must already be running
in tmux):

```sh
sh scripts/test-browser.sh
```

The browser runner reads the Playwright version from the development container, uses temporary host
tooling, and copies the committed tests/config unchanged. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an
existing Chromium executable. The Alpine development container is used for compilation, unit tests and
the Vite server; browser execution takes place on the Ubuntu host.

## Status & Scope

- **Frontend + MSW only.** Real GPU provisioning, SSH/Jupyter/BMC sessions, external object endpoints and
  invoice issuance require backend services; this repository implements the frontend and its Mock contracts.
- **Performance budget.** Entry JavaScript is kept below **250 KB** (M4 142 KB, M6 153 KB, M7 173 KB).
- **Quality gates.** Every milestone passes TypeScript, ESLint, Stylelint and production build; M7/M8 also
  pass `git diff --check`.

## Contributing

See [`AGENTS.md`](./AGENTS.md) for contributor and agent guidance. Development commands run inside the
`runsuncos` tmux session; keep changes within the 250 KB entry-bundle budget and the existing role/state
guards.

## License

This repository does not yet ship a `LICENSE` file. Add one before publishing if you intend to
open-source the project.
