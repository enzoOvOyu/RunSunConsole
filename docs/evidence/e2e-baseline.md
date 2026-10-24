# E2E 失败归因与性能对照（证据记录）

## 1. 结论
`sh scripts/test-browser.sh` 全量 30 条用例中 19 条失败。经基线对照验证：
**这些失败在 HEAD（未应用本轮改动）上同样复现，不是本轮改动引入的回归。**

## 2. 归因方法
用 `git stash push -- src server` 暂存本轮全部改动，重启 API，跑同一批用例：

| 用例 | HEAD 基线 | 本轮改动 |
| --- | --- | --- |
| all navigation pages load without runtime errors | ✘ | ✘ |
| overview and quota page render the same regional quota records | ✘ | ✘ |
| resource network tabs show per-device private addresses | ✘ | ✘ |

三者在两种代码状态下结果一致 → 既有失败。

## 3. 根因分类
### 3.1 测试环境与运行模式不一致（主因）
- `.env` 为 `VITE_ENABLE_MOCK=false`，页面走真实 API 与 PostgreSQL。
- 但 `tests/e2e/console.spec.ts` 多处断言 `localStorage["rs.mock.database.v2"]`
  （MSW 内存库），实测该键为 `null`、无 Service Worker 控制。
- 测试仍按 MSW 单浏览器上下文编写，多上下文/多次运行之间共享同一数据库，
  因此产生 `Review Project`×8、`gvm-new`×6、`默认项目`×3 等残留，
  触发 Playwright strict mode 多元素冲突（`e2e-vpc` 4 个、`e2e-firewall` 2 个等）。
- 测试无 `beforeAll/afterAll` 清理逻辑（`grep` 无命中）。

### 3.2 测试与实现漂移
- `routes` 列表含 `workbench/notebooks`、`workbench/images`、`workbench/apps`，
  但 `src/app/router.tsx` 已在 `c67512c` 移除 notebook 模块，
  `workbench/images`、`workbench/apps` 只是重定向到 `/workbench/models`，
  `/workbench/notebooks` 无匹配路由 → `h1` 不存在。
- `submenu pages describe their own resource and billing functions` 期望文案
  「查看 GPU 集群、节点池和共享资源状态…」，实际为
  「查看 Kubernetes 集群的 GPU 节点池、Pod 与运行状态…」（`zh-CN.ts:91`）。
- 配额断言期望 `对象存储 160 / 200 TB`，实际 `0 / 200 TB`：
  `storage_volumes` 无 `object` 类型卷（仅 block/file），属数据缺失而非计算错误。

## 4. 性能对照
同一进程内 10~15 次采样取中位数，API 延迟（服务端）：

| 端点 | HEAD 基线 | 本轮改动 |
| --- | --- | --- |
| `/api/overview` | 0.0446s | 0.0443s |
| `/api/quotas` | 0.0064s | 0.0064s |
| `/api/billing/report?period=2026-10` | 0.2656s | 0.2689s |

浏览器首屏（3 次取中位数，`h1` 可见）：

| 页面 | HEAD 基线 | 本轮改动 |
| --- | --- | --- |
| overview | 723ms | 714ms |
| resources/servers | 450ms | 443ms |
| billing/bills | 380ms | 379ms |
| billing/cost | 342ms | 322ms |
| ops/tickets | 273ms | 284ms |
| workbench/scaling | 370ms | 364ms |

**差异均在噪声范围内，本轮改动没有带来可测量的墙钟性能收益。**
保留的改动价值在于结构性正确性（见下），而非速度。

## 5. 保留的改动及其价值
| 改动 | 性质 | 是否提速 |
| --- | --- | --- |
| `query-cache.ts` + `Realtime.tsx` / `hooks.ts` / `ui/index.tsx` / `ResourceListShell.tsx` | 把分散的 `invalidateQueries()` 合并为单次去抖，且默认跳过轮询查询 | 否（减少重复刷新次数，降低抖动） |
| `OverviewPage.tsx` | `filter` 每项目/每类型 O(n·m) → 单次分组建 Map O(n) | 否（n=51 规模下不可测） |
| `TicketsPage.tsx` | `find` 每工单 O(n·m) → Map 查找 | 否（同上） |
| `ResourceListShell.tsx` | `selected.includes` → `Set.has`；列定义与分页用 `useMemo` | 否（同上） |
| `common.tsx` | `MetricCard` 的序列计算与图表数据用 `useMemo` | 否（避免重复计算） |
| `ConsoleLayout.tsx` | 渲染期直接改 `document` → `useLayoutEffect` | 否（修正 React 反模式） |
| `ResourceDrawer.tsx` | 删除后的 `setTimeout(close, 1800)` 未清理 → 保存 ref 并在卸载时清理 | 否（修复卸载后 setState 告警） |
| `ResourceListShell.tsx` | 筛选重置依赖补 `released` | 否（修复切换"已释放"后旧选择残留） |
| `hooks.ts` | `useAction` 卸载后 `setBusy` → mounted ref 守卫 | 否（修复卸载后 setState） |
| `region_quotas` 表 + `setRegionQuotaLimits` | 配额上限从代码常量迁到数据库 | 否（可配置性） |

## 6. 已撤销的改动
- `refetchIntervalInBackground: Boolean(options.poll)`：会让后台标签页持续轮询，
  增加服务端负载，无收益，已移除。
- `Realtime.tsx` 轮询兜底从 `max(30s, interval)` 改为 `max(60s, interval*6)`：
  会把兜底间隔拉到 60s 以上，降低实时性，已回退。
- `DataTable` 中把 `activePage` 回写 `page` 的 `useEffect`：`activePage` 已 clamp，
  属多余渲染，已移除。
