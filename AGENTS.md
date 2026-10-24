# AGENTS.md — RunSun GPU Cloud 控制台（RunSunConsole）

> 给接手本项目的 AI Agent / 开发者看的最短上手路径。
> 改动代码前**先读「4. 硬性约定」和「8. 排障手册」**——这两节能避免 90% 的返工。
> 详细规范在四份设计文档里（见 §9），本文件只写**代码侧事实与约束**。

---

## 0. Agent 行为准则（强制）

核心目标

以最少的 Token、工具调用和执行步骤，高质量完成开发任务。优先直接执行，避免重复查询、过度拆分、冗长输出和无意义验证。

1. 开发环境

在当前本地真实工作区直接读取、修改和验证代码。

开始前确认项目根目录、Git 状态及当前工作区，保护已有未提交修改。

不假定环境或命令执行成功，关键结果必须实际验证。

2. 设计文档

严格遵循现有 PRD、System Design、Architecture 及相关 MD 文档。

开始前仅读取 AGENTS.md、任务相关设计文档及必要代码。

文档已明确的内容直接执行，不重复查询、总结或向用户确认。

发现文档冲突、关键需求缺失或实现存在重大风险时，再补充调查或提问。

不擅自改变架构、业务规则或设计决策。

3. 开发执行

先定位任务涉及的代码和依赖，再一次性完成合理关联的修改。

禁止过度拆分任务、反复生成计划或进行无关重构。

优先复用现有组件、函数、接口和工具，不重复造轮子。

发现错误时先定位根因，再直接修复；不重复尝试已失败的方案。

不为简单任务生成冗长分析、阶段报告或中间总结。

需求明确且风险可控时直接执行，不等待不必要的确认。

4. Token 与工具调用

每次查询、文件读取和命令执行都必须服务于当前任务。

能一次获得的信息不拆成多次调用；已获取的结果直接复用。

优先精确搜索、局部读取和定向检查，避免重复读取大文件及完整日志。

不重复执行相同命令、测试或状态检查，除非前次结果不完整、代码已变化或需要验证修复。

避免无意义的轮询、重复解释、重复汇报和多轮确认。

不为节省少量 Token 而省略必要上下文、错误诊断或关键验证。

5. 测试与质量

只执行与本次改动相关且必要的检查。

优先利用已有验证结果，避免无差别运行全量测试。

修改完成后验证关键行为、接口兼容性及受影响的功能。

不进行与任务无关的测试、格式化、依赖升级或代码清理。

不得虚构测试结果，不得把未验证的功能描述为已完成。

质量达标后立即停止，不追求无关的完美化。

6. 输出规范

默认使用简洁中文，先给结论，后给必要细节。

只汇报实际完成的修改、必要验证结果和未解决的问题。

不输出冗长思考过程、重复背景、泛泛建议或无意义的过程播报。

任务完成后简要说明：修改内容、验证结果、遗留问题。

仅在真实阻塞、重大风险、需求冲突或必须由用户决策时提问。
---

## 1. 项目是什么

GPU 公有云（RunSun）的 **Web 控制台前端**。把「部署中心（创建）+ 资源（四类展示）+ 项目与支持 / 工作台 / 网络管理 / 存储 / 费用中心」整合为一体。

- **当前状态**：以 `PRD.md` v0.11 为产品基线；架构、UI、Mock 与伸缩参考文档已对齐可确认的需求。工作区已建立前端源码、Mock、回归测试与浏览器测试，当前实现和验收记录见 README；旧代码快照保存在 `archive/current-gdashboard/`。未经用户指令，不从归档代码继续开发。
- **范围边界**：默认 5173 仍使用 MSW；新增可选的内部 PostgreSQL API 服务（`server/`），`VITE_ENABLE_MOCK=false` 时前端通过 Vite 代理访问。四类资源、项目、配额、存储、网络和费用以数据库记录及 SQL 视图为准；GPU 利用率、温度、QPS 等高频监控维持既有 Mock 方案。API 尚无真实租户认证，仅限内部开发网络，不得直接对公网开放。
- **技术栈**：React 19 + TypeScript 5（strict）+ Vite 6 + pnpm 9 + Zustand + TanStack Query + MSW 2 + Recharts + cmdk + 自研轻量 i18n。
- 源码仓库：`https://github.com/enzoOvOyu/RunSunConsole`（main 分支，SSH 部署密钥推送）。

---

## 2. 快速开始

当前工作区已创建 `package.json` 与 `src/`。以下 pnpm 命令通过 `docker compose exec -T dev` 在开发容器中执行；浏览器验收在宿主通过 `sh scripts/test-browser.sh` 执行。所有命令均须在远端 tmux 内启动。

```bash
pnpm install
pnpm exec msw init public/ --save   # 首次：生成 public/mockServiceWorker.js（已入库则跳过）
pnpm dev                            # http://127.0.0.1:5173
pnpm test                           # Vitest（含架构、接口契约、派生、指标与 i18n 回归）
pnpm typecheck                      # tsc -b --noEmit
pnpm build                          # tsc -b && vite build
```

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 在 dev 容器中执行，改代码即时生效 |
| `pnpm test:watch` | 测试 watch 模式 |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |

**Docker 方式**（`docker compose up -d`）：`dev`（Node 22 空闲开发容器）、PostgreSQL 和 Adminer 均在独立 `runsun-network` 内；仅 `0.0.0.0:5173` 为前端预留的宿主映射，数据库与 Adminer 不发布宿主端口，不得占用或改动其他项目的端口。应用代码创建后通过 `docker compose exec dev ...` 启动。

---

## 3. 目标目录结构（按 `ARCHITECTURE.md`）

当前目录包含应用源码、设计文档、Docker 环境、测试与归档快照；下列树为模块结构与职责索引。

```
src/
├─ app/
│  ├─ router.tsx              # createBrowserRouter，全部页面路由
│  ├─ providers.tsx           # QueryClient + MSW（动态 import）
│  └─ layouts/
│     ├─ navModel.ts          # ★ 导航模型单一来源（Sidebar 与 ⌘K 面板共用）
│     ├─ Sidebar.tsx / Topbar.tsx / StatusBar.tsx / ConsoleLayout.tsx
│     └─ layout.module.css
├─ features/                  # 按业务域切分
│  ├─ overview/  deployment/（四类向导 + shared/）  resources/（四类列表与详情 + shared/）
│  ├─ ops/（项目/配额/成本/工单）  workbench/（notebooks/images/apps/scaling）  billing/（bills/vouchers）
│  └─ storage/（block/file） data/（旧 datasets/pipelines + object） shared/（BillingTab/MetricsPanel/api）
├─ components/
│  ├─ command/                # CommandPalette.tsx + palette.css（⌘K 命令面板）
│  ├─ ui/                     # Button/Card/Table/Tabs/Badge/Drawer/Toast/EntityDrawer…
│  ├─ charts/  state-machine/  ops/（TopologyView，仅 vGPU 详情内嵌）
├─ stores/                    # auth.ts / locale.ts / nav.ts（Zustand）
├─ mocks/
│  ├─ handlers/index.ts       # ★ 全部 /api/* 拦截（唯一改接口的地方）
│  ├─ fixtures/               # 种子数据（gpu-specs/pricing/resources/scaling/...）
│  ├─ lib/                    # derive.ts（派生引擎）/ rng.ts / timeseries.ts / env.ts / consistency.ts
│  ├─ metrics.ts  browser.ts
├─ lib/                       # api-client.ts（EP 端点常量）/ rbac.ts / ids.ts / money.ts / date.ts
├─ i18n/                      # index.ts（t/dt）+ locales/{zh-CN,en-US}.ts（字典键与占位符中英严格对齐）
├─ types/domain.ts            # 领域类型（与 ARCH §12 DDL 同构）
├─ test/                      # setup.ts + architecture.test.ts（架构守护）
└─ styles/theme.css           # 设计 Token（亮/暗）
```

根：`vite.config.ts`（含 `manualChunks`）、`vitest.config.ts`、`docker-compose.yml`、`.github/workflows/ci.yml`、四份设计文档。

---

## 4. 硬性约定（违反会被测试或评审拦下）

### 4.1 分层与依赖

1. **UI 层禁止 import `mocks/fixtures`**。`src/features/**`、`src/components/**`、`src/app/**` 对 fixture 的引用数必须为 **0**——`src/test/architecture.test.ts` 会断言。常量与参考数据一律走 `/api/*` 下发。
2. **`mocks/lib/derive.ts` 只能在 Mock 层调用**。`VITE_ENABLE_MOCK=false` 时派生责任移交后端。
3. 新增接口：**改 `mocks/handlers/index.ts`**（加 handler）+ **`lib/api-client.ts`**（加 `EP` 常量），两端字段名必须一致。
4. 无 `TODO` / `FIXME` / `XXX`、无 `@ts-ignore` / `@ts-expect-error`、无 `eslint-disable`——架构测试扫描全 `src`。

### 4.2 i18n（双语，最容易漏）

5. 用户可见文案**必须**走 `t('ns.key')`，**禁止 JSX 内硬编码中文**。
6. **fixture 里的中文数据值**（项目名、事件原因、状态文案）展示前包 `dt(...)`。
7. **模块级标签映射必须 getter 化**：`label: () => t('nav.ops')`，不能写 `label: t('nav.ops')`——模块加载期会固化语言，切换后不更新。同理，Sidebar 的分组结构必须**渲染期计算**。
8. 加键时**中英两边同时加**，键集合严格相等、占位符（`{v0}`）数量与名称一致——`i18n.test.ts` 断言。
9. `dt()` 是模板感知双级反查，**字面量最长者胜**；别造过于通用的短模板（会劫持长句）。
10. 币种**恒 USD**，不做汇率换算；格式化走 `lib/money.ts`，日期走 `lib/date.ts`（`Intl` 随 locale）。

### 4.3 业务口径

11. **计费单位**：裸金属 `per_machine_hour`（**台·小时，禁止按卡**）、vGPU 控制面 `per_cluster_hour`、推理/云服务器 `per_gpu_hour`。
12. **配额是区域作用域**：`QUOTAS` = 3 区域 × 5 指标（GPU / vCPU / 主机内存 / 云存储 / 公网 IP）；org 级行（`region=null`）派生时累加全部区域。下单预检超限 → `409 QUOTA_EXCEEDED`；**开弹性时按 max 档预检**。
13. **两类伸缩策略模型不共用表单**：`node_pool`（云服务器实例 / 裸金属台 / vGPU 每池节点）与 `replica`（推理副本）。写入口**唯一**在工作台·弹性伸缩页；资源详情「弹性」Tab **只读**；下单即物化 `scaling_policies` 行。
14. 费用双档：`PriceEstimate.floorMonthly` / `peakMonthly`；只有 `PriceLine.scales=true` 的行随规模折算（vGPU 控制面与 PVC 为 `false`）。
15. **导航改动走 `app/layouts/navModel.ts`**，Sidebar 与 ⌘K 面板共用同一份 RBAC 过滤，禁止另写一套。

### 4.4 约定细节

16. 路由参数：详情用 `resourceUuid`；`id`（自增主键）不出接口；`display_id` 只用于展示/搜索。
17. 指标为 `null` 时渲染「无数据/采集中」+ 图表断点，**禁止 `?? 0`**。
18. 每个列表必须有空态组件（含筛选无结果态）。
19. `spec_json` 可选键（如 `hpa`、`env`）读取必须 `?.` 并给缺省展示「—」。

---

## 5. 关键机制速查

| 机制 | 位置 | 要点 |
| --- | --- | --- |
| **Mock 开关** | `VITE_ENABLE_MOCK`（`.env`） | `true` 时 `providers.tsx` 才 `await import('../mocks/browser')` |
| **固定随机** | `VITE_MOCK_SEED=20261017` | fixture 可复现，改种子=改全部假数据 |
| **故障注入** | `?fault=oom\|xid48\|network\|straggler\|insufficient\|billing` | 15 min 后自愈（`FAULT_TTL_MS`） |
| **RBAC** | `lib/rbac.ts` | 5 角色 owner/admin/member/billing/viewer；只管**可见性**，不是安全边界 |
| **locale** | `stores/locale.ts` | `localStorage['rs.locale']`，同步 `<html lang>`；**不进 Query key**，靠 Layout 订阅整树重渲染 |
| **nav 收起态** | `stores/nav.ts` | `localStorage['rs.nav.collapsed']`（分组 id JSON 数组）；**只存用户意图**，激活组在渲染期强制展开且不写回 |
| **命令面板** | `components/command/` | ⌘K/Ctrl+K；四组 = 资源搜索 / 新建 / 导航 / 快捷操作 |
| **指标时序** | `mocks/metrics.ts` | 独立 `/api/metrics/*`，不落 PG |

**环境变量默认**：`VITE_ENABLE_MOCK=true`、`VITE_API_BASE_URL=`（同源）、`VITE_DEFAULT_REGION=jp`、`VITE_POLL_INTERVAL_MS=3000`、`VITE_THEME_DEFAULT=light`、`VITE_I18N_DEFAULT_LOCALE=zh-CN`、`VITE_LOW_BALANCE_THRESHOLD_USD=50`。完整表见 ARCH §12.7。

---

## 6. 常见任务怎么做

| 任务 | 步骤 |
| --- | --- |
| **加一个接口** | `mocks/handlers/index.ts` 加 `http.get/post(...)` → `lib/api-client.ts` 的 `EP` 加常量 → 页面用 `useQuery` 消费 |
| **加一个页面** | 在 `features/<域>/` 写页面 → `app/router.tsx` 加 Route → 在 `app/layouts/navModel.ts` 注册（含 RBAC 过滤函数）→ 补 `nav.*` 等 i18n 键（中英） |
| **改导航可见性** | 改 `lib/rbac.ts`（`NAV_VISIBLE` / `canSeeOpsItem` / `canSeeWorkbenchItem`）+ `navModel.ts` |
| **加文案** | 同时改 `i18n/locales/zh-CN.ts` 与 `en-US.ts`（键数必须相等）→ 代码里 `t('ns.key')` |
| **改计价/派生公式** | 改 `mocks/lib/derive.ts` 或 `mocks/fixtures/pricing.ts` → **同步改 `derive.test.ts` 断言**（公式有测试守护）→ MOCK-DATA §7 文档同步 |
| **加伸缩能力** | `types/domain.ts` → `mocks/fixtures/scaling.ts` → handlers → `features/workbench/ScalingPage.tsx`；改完跑 `scaling.test.ts` 契约 |

---

## 7. 测试与 CI

```bash
pnpm test          # vitest run（含架构、接口契约、派生、指标与 i18n 回归）
pnpm typecheck     # 注意：CI 用 tsc -b --force --noEmit
```

| 测试 | 守护什么 |
| --- | --- |
| `lib/{money,ids,date}.test.ts` | USD 格式化、`display_id` 口径、日期/时长 |
| `mocks/lib/derive.test.ts` | 训练吞吐 6N/8N、decode 带宽上界、**stopped 态不计费** |
| `mocks/fixtures/scaling.test.ts` | 种子策略与事件：方向自洽、快照带度量、末值=实际规格 |
| `i18n/i18n.test.ts` | 中英键集合相等 + 占位符一致 |
| `test/architecture.test.ts` | UI 层零 fixture 引用 / 无 TODO / 无 `@ts-ignore` / 无 disable |

**CI**（`.github/workflows/ci.yml`，push main 与 PR 触发）：`typecheck → test → build`，任一失败即红。

---

## 8. 排障手册（症状 → 根因）

| 症状 | 根因 | 处理 |
| --- | --- | --- |
| **5173 暂无页面** | 开发容器当前空闲，尚无前端源码或开发服务器 | 待应用脚手架完成后，在 `dev` 容器启动 Vite；宿主映射固定为 `0.0.0.0:5173` |
| **数据库 / Adminer 无法从宿主访问** | 两个服务仅加入 `runsun-network`，未发布宿主端口以避免影响其他项目 | 开发容器内分别通过 `db:5432` 和 `adminer:8080` 访问；不得擅自新增宿主映射 |
| **Dev 容器内依赖安装失败** | 新工作区 Compose 不注入宿主代理，且当前尚无依赖清单 | 先等待源码脚手架与 `package.json`；按届时环境约定配置代理，不修改其他项目网络设置 |
| **`tsc` 空输出却以为通过** | `tsc -b` 有增量缓存 | 一律用 `tsc -b --force --noEmit` |
| **语言切换后侧边栏/表头还是中文** | 模块级常量捕获了 `t()` 结果 | 标签改 getter 化、结构改渲染期计算（§4.2.7） |
| **架构测试突然红** | 在 UI 层 import 了 fixture，或加了 TODO / `@ts-ignore` | 把常量改走 `/api/*`；真需要豁免时改的是**实现**不是测试 |
| **构建后入口 chunk 变大** | 误把 MSW 或新重依赖静态引入生产包 | MSW 保持 `await import(...)`；重依赖加进 `manualChunks`（预算：入口 ≤ 250 kB） |
| **`pnpm install` 后仓库多出 `.pnpm-store/`** | 原生（非容器）安装的缓存目录 | 已 gitignore；容器安装走命名卷，不影响仓库 |

**沙箱环境注意**：删除类操作有安全护栏，`rm -rf dist` 与 `pnpm build` 需分两轮执行；`pnpm` 后台任务状态可能误报 failed，以日志文件为准。

---

## 9. 设计文档索引（要改设计前先读）

| 文档 | 查什么 |
| --- | --- |
| `PRD.md` | 产品需求、导航树（§2/§2.1）、全局能力（§3，含 §3.6 命令面板）、四类向导字段级（§4.2）、四类详情（§4.3）、生命周期与删除契约（§5）、计费配额（§7）、验收清单（§12）、一致性自检（§13） |
| `ARCHITECTURE.md` | 目录结构（§3）、路由表与 RBAC（§4）、状态管理（§5）、**后端 DDL 蓝图（§12）**、枚举单一来源（§12.6）、环境变量（§12.7）、接口契约（§12.11）、伸缩数据模型（§12.12）、**测试与质量体系（§15）** |
| `DESIGN-SYSTEM.md` | Token（§2）、组件规范（§5，含 §5.25 命令面板）、状态色映射（§8）、可访问性（§10） |
| `MOCK-DATA.md` | 真实值口径、硬件基线、指标字典、派生公式、假数据红旗清单 |
| `GPU弹性伸缩策略四场景对比.md` | 场景比较参考；策略契约以 PRD §4.2.6 / §4.5.2 为准 |
| `DOC-AUDIT.md` | 历史审计记录，不覆盖当前设计基线 |

**文档同步要求**：改设计文档时，三份之间交叉引用（`§x.y`）必须成立——`PRD §4.2.6.x` 是**五级标题**，写校验脚本要扫到 `#####`。

---

## 10. 禁止清单（一句话版）

- 禁止 UI 层 import `mocks/fixtures`；禁止生产包静态引入 MSW。
- 禁止硬编码中文文案；禁止只加一边语言包。
- 禁止模块级 `t()` 固化；禁止侧边栏与命令面板两套 RBAC。
- 禁止裸金属按「GPU·小时」计价；禁止指标 `?? 0`；禁止列表无空态。
- 禁止用 `TODO`/`@ts-ignore`/`eslint-disable` 绕过问题。
- 禁止在 `resources.project_id`、订单 `project_id` 上留空（可空外键必须判空）。
