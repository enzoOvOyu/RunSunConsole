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

M1 validated with `pnpm typecheck`, `pnpm test` (7 files, 13 assertions), and `pnpm build`.
