# ARCHITECTURE — RunSun GPU Cloud 控制台（前端架构）

> 文档类型：架构说明（前端为主；后端为蓝图，不在本次实现）
> 版本：**v0.10 · 当前架构基线**
> 关联文档：`PRD.md`（产品需求，业务规则唯一来源）、`DESIGN-SYSTEM.md`（UI 规范）、`MOCK-DATA.md`（数据约束）

> 本文定义前端模块、路由、状态和接口边界。业务行为以 PRD 当前版本为准：总览跨 JP / TH / SG / US 展示，账号菜单不承载项目，四类资源完整详情使用右侧 Drawer；平台节点运维数据不作为租户导航或总览健康预览。

---

## 1. 技术约束总览

| 维度     | 约束                                                  |
| ------ | --------------------------------------------------- |
| 前端框架   | **React 19**（并发特性、Actions、`use()`）                  |
| 语言     | **TypeScript 5**（strict 模式，禁止 `any` 泄露到领域层）          |
| 本次范围   | **仅前端展示**；数据全部来自 Mock 层                             |
| 未来后端存储 | 约定使用 **PostgreSQL 15+（pg）**（仅蓝图，见 §12）              |
| 包管理    | pnpm                                                |
| 构建     | Vite 6                                              |
| 代码质量   | ESLint + Prettier + Stylelint                       |

---

## 2. 前端技术栈

| 关注点  | 选型                                  | 理由                                  |
| ---- | ----------------------------------- | ----------------------------------- |
| 路由   | React Router 7（数据路由）                | 嵌套路由、懒加载、loader 适配 Mock             |
| 状态管理 | Zustand（全局轻量）+ TanStack Query（服务端态） | 避免 Redux 样板；Query 层天然适配 Mock/真实 API |
| 数据Mock | MSW（Mock Service Worker）          | 拦截 fetch，契约即文档；切换开关见 §12.7         |
| UI基础 | Radix UI 原语 + 自研组件                  | 无障碍优先，可控主题                          |
| 样式   | CSS Modules + Design Token（CSS 变量）   | 主题切换靠变量                             |
| 表格   | TanStack Table                      | 复杂筛选/排序/虚拟滚动（Vast.ai 风格）           |
| 图表   | Recharts（常规）+ visx（拓扑/机架定制）         | 定制能力与效率平衡                           |
| 表单   | React Hook Form + Zod               | 部署向导分步校验；Zod 同时约束 `spec_json`（§12.9） |
| 国际化  | **自研轻量 i18n**：`src/i18n/` 字典（zh-CN 为源 + en-US 译）+ `useI18n()`/`t()`，locale 走 Zustand store 并持久化 `localStorage` | 文案键即前后端契约；fixture 数据值经字典出英译（MOCK-DATA G10） |
| 命令面板 | **cmdk**              | `components/command/CommandPalette.tsx`：⌘K/Ctrl+K 唤起，资源搜索 / 新建 / 导航 / 快捷操作四组（PRD §3.6、DESIGN §5.25） |
| 测试   | **Vitest 3**           | 兼容 Vite 的 TS / 别名 / ESM；运行 `src/**/*.test.ts`，含架构守护测试（§15） |
| 实时数据 | Mock WebSocket（或轮询）                 | 利用率、goodput、节点状态流（端点由 §12.7 配置）     |

---

## 3. 目录结构

```
src/
├─ app/
│  ├─ router.tsx              # 路由表（含 RBAC 守卫；/development/* → /workbench/* 重定向）
│  ├─ layouts/
│  │  ├─ navModel.ts          # ★ 导航模型单一来源（v0.8）：分组/子项定义 + RBAC 过滤，
│  │  │                       #   Sidebar 与 ⌘K 命令面板共用，禁止第二套过滤逻辑（§5）
│  │  └─ …                    # 控制台骨架（Sidebar + Topbar + StatusBar + Outlet）
│  └─ providers.tsx           # Query / i18n / Theme / MSW 初始化（受 VITE_ENABLE_MOCK 控制）
│                             #   ★ MSW 走动态 import，mock 代码不进生产主包（§11）
├─ features/                  # 按业务域切分（与 PRD §2 导航一一对应）
│  ├─ overview/
│  ├─ deployment/             # 创建入口：server / baremetal / vgpu / inference 向导
│  ├─ resources/              # 展示菜单：4 类各自独立（PRD §4.3.1–4.3.4，禁止共用模板）
│  │  ├─ servers/             #   GPU 云服务器：列表 + 详情（概览/监控/控制台/配置/事件/计费）
│  │  ├─ baremetal/           #   GPU 裸金属：列表 + 详情（含硬件监控/带外/固件/创建 Notebook 联动）
│  │  ├─ vgpu/                #   vGPU：列表 + 详情（含控制面/节点池/工作负载/拓扑）
│  │  └─ inference/           #   推理服务：列表 + 详情（含实例管理/监控/服务治理/日志）
│  │                          #   共享：ResourceListShell（列表骨架 + 区域/项目筛选）
│  ├─ ops/                    # 运营：项目 / 配额（含已分配节点池视图）/ 成本 / 工单
│  │                          #   （原 cluster + operations 合并；无 monitoring、无 topology 独立页）
│  ├─ workbench/              # 工作台（v0.7：原 development 更名）：notebooks / images / apps / scaling
│  ├─ data/
│  └─ assets/
├─ components/
│  ├─ command/                # ★ v0.8：CommandPalette.tsx + palette.css（⌘K 命令面板，PRD §3.6）
│  ├─ ui/                     # Button/Card/Table/Tabs/Badge/Modal/Tooltip/
│  │                          #   EntityDrawer（PRD §3.4 展开）、RowExpander（C 档行内展开）、
│  │                          #   ConfirmDeleteDialog（键入 display_id 确认）、
│  │                          #   MetricCard（DESIGN §8.3 五要素）、CostBreakdownCard（PRD §7.8）
│  ├─ charts/                 # GPU 利用率 / goodput / 成本趋势 / 延迟分位
│  ├─ state-machine/          # 节点状态机 & 资源生命周期可视化
│  └─ ops/                    # TopologyView（仅供 vGPU 详情内嵌，非独立页）
├─ stores/                    # Zustand：auth（含 project）/ region / theme / billing / locale / nav
├─ mocks/                     # MSW handlers + fixtures + 契约 schema
│  ├─ handlers/               # 各域接口拦截
│  ├─ fixtures/               # 种子数据（与 §12 DDL 同构）
│  └─ schema/                 # Zod/TS 类型化契约（含 ResourceId/DisplayId 品牌类型）
├─ lib/                       # api-client / date / money / rbac / ids（*.test.ts 就近同置）
├─ i18n/                      # 国际化（v0.7）：字典 zh-CN（源）/ en-US + locale store + t()/useI18n()
│                             #   i18n.test.ts：中英键集合与占位符一致性（§15）
├─ test/                      # ★ v0.8：setup.ts（测试环境引导）+ architecture.test.ts（架构守护）
├─ types/                     # 全局领域类型
├─ tokens/                    # 设计 Token（亮/暗）
└─ styles/                    # 全局样式、reset、主题变量注入
```

**仓库根（v0.8 新增）**

```
vitest.config.ts              # 测试配置（environment: node，含 @/ 别名与 setupFiles）
.github/workflows/ci.yml      # CI：typecheck → test → build（Node 22 + pnpm）
```

---

## 4. 路由与权限模型

### 4.1 路由表（节选，详情路由参数统一为 `resourceUuid`）

> 路由与 PRD §2 一致：总览同屏展示 JP / TH / SG / US；区域筛选只用于适用页面；账号菜单不承载项目；四类资源完整详情由列表路由的 Drawer 参数承载。

```
/overview
/deployment/server               /deployment/baremetal
/deployment/vgpu                 /deployment/inference          （4 类独立向导）
/resources/servers                 /resources/servers?drawer=:resourceUuid   （完整详情为右侧 Drawer）
/resources/baremetal               /resources/baremetal?drawer=:resourceUuid   （完整详情为右侧 Drawer）
/resources/vgpu                    /resources/vgpu?drawer=:resourceUuid   （完整详情为右侧 Drawer）
/resources/inference               /resources/inference?drawer=:resourceUuid   （完整详情为右侧 Drawer）
/workbench/notebooks             /workbench/images（含模型卡片）  /workbench/apps
/workbench/scaling               （四类资源分区配置 / 伸缩事件）
/data/datasets                   /data/storage         /data/pipelines
/ops/projects                    /ops/projects/:projectUuid     （项目页，A 档整页详情）
/ops/quotas                      /ops/cost                       （C 档行内展开；配额含「已分配节点池」视图）
/ops/tickets                     /ops/tickets/:id                （A 档整页详情）
/billing/bills                   /billing/vouchers               （费用中心：我的账单 / 代金券）
```

**API 契约（前端调用面，见 §12.11）**

```
GET    /api/projects                     # 项目列表（真实；运营·项目页 + 资源列表页项目筛选 + 向导内联新建共用；账号菜单不再承载）
POST   /api/projects                     # 部署向导内联新建 / 项目页新建（同一接口）
PATCH  /api/projects/:id
DELETE /api/projects/:id                 # 有未释放资源时返回 409
GET    /api/projects/:id/summary         # v0.7：卡片聚合（GPU/运行中/四类计数/本月成本/配额水位/成员）
GET    /api/workbench/notebooks?region&resource_kind   # v0.7：Notebook/IDE 列表（可按挂靠类型过滤）
POST   /api/workbench/notebooks          # v0.7：挂靠 gpu_vm / gpu_baremetal / vgpu（PRD §4.5.1）
DELETE /api/workbench/notebooks/:id
GET    /api/scaling/policies?region&strategy_model      # v0.7：弹性策略（node_pool / replica 两类）
POST   /api/scaling/policies             # v0.7：工作台新建策略；向导下单同模型生成
PATCH  /api/scaling/policies/:id         # v0.7：编辑 / 暂停 / 恢复
DELETE /api/scaling/policies/:id         # v0.7：409 POLICY_BOUND_RESOURCE_RUNNING
GET    /api/scaling/events?resource_id&direction&from&to   # v0.7：伸缩事件时间线
GET    /api/resources?kind&region&project_id&status&q&page&size&sort
GET    /api/resources/:uuid              # 详情（含 spec_json / placement / 来源）
DELETE /api/resources/:uuid              # 真实软删（PRD §5.4.1）
POST   /api/resources/:uuid/start|stop|restart
GET    /api/metrics/:kind/:uuid?window&metrics=   # 时序，与业务实体分离（§12.8）
GET    /api/billing/usage?resource_id&from&to     # 用量明细（PRD §7.8 ③）
GET    /api/billing/transactions?resource_id      # 扣费流水（PRD §7.8 ④）
GET    /api/node-pools?region                    # 部署目录的可选规格/可售量；不得返回平台总容量或节点健康明细
```

`gpu_nodes` / `node_events` 是供给侧平台模型，不提供全平台节点列表/状态查询接口。vGPU 资源 Drawer 如需节点与工作负载信息，只返回该资源已分配的 `resource_placements` 范围（PRD §4.3.3）；总览不展示节点健康预览。配额页「已分配物理资源」从当前用户可见的未软删资源记录派生，不读取平台容量总量。

- `routeKey ↔ kind ↔ display_id 前缀` 的唯一映射见 **§12.6**（组件不得自定义第二套）。
- **资源类型图标统一**：部署中心（`/deployment/:kind`）与资源列表/详情共用 `lib/ids.ts` 的 `KIND_META.icon`，禁止第二套图标（DESIGN §2.6）。

### 4.2 前端 RBAC（仅控制可见性，非安全边界）

> 角色枚举以 **§12.1 `user_role`** 为准，`lib/rbac.ts` 直接消费该联合类型，避免第二套命名。

| 角色（`user_role`） | 可见/可操作                                        |
| ---------------- | --------------------------------------------- |
| `owner`          | 全部（含计费主体、成员管理、删除资源）                           |
| `admin`          | 除计费主体外的全部 + 用户/配额/工单管理                        |
| `member`         | 部署中心、资源（创建/启停/扩缩/控制台/**删除**）、工作台、数据、运营（配额只读 + 提工单） |
| `billing`        | 费用中心（我的账单、代金券）、成本分析、发票；资源**只读**（不可删除/启停）           |
| `viewer`         | 全部页面**只读**                                   |

危险操作（删除 / 扩缩 / cordon / drain / 发票作废）由 `lib/rbac.ts` 计算可见性与禁用态。

> Topbar 账号菜单中的「角色切换」控件必须与上表五角色严格一致（`owner / admin / member / billing / viewer`）；切换后 `lib/rbac.ts` 即时重算导航可见性（`NAV_VISIBLE` / `canSeeOpsItem` / `canSeeWorkbenchItem`）与危险操作禁用态；命名「切换角色视图」，不得暗示测试/演示环境（PRD §3.7）。账号菜单不展示项目。

---

## 5. 状态管理层

- **全局 Store（Zustand）**：
  - `auth`：**用户（uuid/role）+ 当前 org + 当前 project**（对应 §12.1，`project` 来自接口 `projects`，创建资源时必选并写入订单）。**v0.10：`project` 上下文的切换入口仅为部署向导首步与资源列表页项目筛选；账号菜单不提供项目切换**（PRD §3.1 / §3.5）。
  - `region`：`jp|th|sg|us`，**按页上下文驱动列表过滤与 Query key**（PRD §3.3）；全局 Topbar 不再承载区域控件。
  - `theme`：light/dark → `data-theme`。
  - `locale`（v0.7）：`zh-CN | en-US`，Topbar 语言切换器写入，持久化 `localStorage`（key `rs.locale`），同步 `<html lang>`；默认取 `VITE_I18N_DEFAULT_LOCALE`（§12.7）。
  - `nav`（v0.7）：侧边栏分组收起态（分组 id 数组），持久化 `localStorage`（key `rs.nav.collapsed`）；含激活路由的分组在渲染期强制展开（PRD §2.1）。
- **导航模型单一来源（v0.8，强制）**：`app/layouts/navModel.ts` 导出分组定义、可见项过滤与 RBAC 判定，**Sidebar 与 ⌘K 命令面板必须消费同一份**。约束：
  - 分组标签一律 **getter 化**（`() => t('nav.xxx')`），禁止模块级常量捕获 `t()` 结果，否则语言切换后侧边栏文案不更新；
  - 分组结构在**渲染期计算**（`buildGroups()`），避免模块加载期固化；
  - 角色过滤后的空分组不渲染；命令面板不得另写一套过滤（PRD §3.6 第 5 条）。
- **服务端状态（TanStack Query）**：区域维度页面的 key 含 `region` + `routeKey` + `project`，多维度缓存隔离；切换区域/项目必须触发真实重取。总览不使用当前 `region` 过滤，按一个聚合请求取得四区域数据（PRD §4.1）。
- **资源生命周期**：`provisioning → running | stopped | error → terminating → deleted_at`（PRD §5.4），与计量严格挂钩（PRD §7.4）；**删除走 `DELETE /api/resources/:uuid`，后端置 `deleted_at` 软删并释放配额（§12.10）**。
- **节点状态机**：见 §9，完整节点状态仅用于平台内部供给/故障数据派生；vGPU 资源 Drawer 可按 `resource_placements` 展示该资源范围内的工作负载节点状态，租户总览不提供节点健康预览或全平台节点状态图。

---

## 6. Mock 数据层与契约

- MSW 拦截 `/api/*`，返回 `mocks/fixtures` 种子数据；开关为 `VITE_ENABLE_MOCK`（§12.7）。
- 契约以 **TypeScript 类型 + Zod** 定义于 `mocks/schema`；**类型必须与 §12 DDL 同构**，降低联调成本。
- 关键实体（对应 §12 表）：
  - `Plan / Org / User / Project`：身份与计费主体。
  - `NodePool / GpuNode / NodeEvent`：供给侧（`gpu_nodes.state` ∈ 5 态）。
  - `Resource`（含 `kind` / `status` / `resourceUuid` / `display_id` / `spec_json`）：四类统一实体。
  - `DeploymentOrder / ResourcePlacement / ResourceEvent / ProvisioningStep`：资源映射与工作项。
  - `Invoice / BillingUsage / Transaction / Voucher / Reservation / Quota`：计费。
  - `Model / Image / AppTemplate / Notebook / Dataset / Ticket / Notification`：内容与支撑。
  - `ScalingPolicy / ScalingEvent`（v0.7）：弹性伸缩策略与伸缩事件（PRD §4.2.6 / §4.5.2，DDL 见 §12.12）。
- **ID 契约**：`resourceUuid` 与 `display_id` 用 TS **品牌类型**（`type ResourceUuid = string & {__brand}`）区分，禁止混用（PRD §5.5）。
- **数值真实性约束（强制）**：Mock 数据受 `MOCK-DATA.md` 全文约束，要点：
  - **G1 真实量级**：硬件规格、价格、单位、阈值一律以 `MOCK-DATA.md` §3 / §4 / §6 为唯一口径，禁止自造失真数值。
  - **G2 派生优先**：金额、吞吐、KV cache、goodput、供给时长等能算的量不得硬编码，统一走 `mocks/lib/derive.ts`（对应 `MOCK-DATA.md` §7）。
  - **G4 状态自洽**：`provisioning` 无运行时指标；`stopped` 指标为 `null`（非 0）；无数据用 `null` 且图表断点，禁止填 0。
  - **G5 确定性**：固定种子 `VITE_MOCK_SEED`，同 nodeUuid/同窗口多次刷新序列一致；`Math.random()` 禁止用于初始值。
  - **G8 红旗**：见 `MOCK-DATA.md` §1 G8 清单，开发态由 `mocks/lib/consistency.ts` 运行时断言拦截。
- **指标与业务实体分离**：§6 全部时序指标走 `/api/metrics/*` 契约，**不得混入业务实体接口**（与 §12.8 边界一致）。

---

## 7. 组件分层

1. **Primitives（ui/）**：Button、Card、Input、Select、Tabs、Badge、StatusDot、Modal、Drawer、Toast、Table、Tooltip。
2. **Domain Blocks（components/）**：
   - `ResourceCard`（RunPod 风卡片化比价）、`MachineCard`（**裸金属整机卡，"一台=8卡"**）、`ImageCard` / `ModelCard`
   - `FilterBar`（Vast.ai 风多条件）、`RegionProjectBar`（资源列表页区域+项目筛选，PRD §4.3.0）
   - `DeployWizard`（**四类各自 5 步**，PRD §4.2.1–4.2.4）+ `CostSummaryCard`（右侧费用明细，PRD §4.2.5）
   - `EntityDrawer` / `RowExpander`（PRD §3.4 三档展开）、`ConfirmDeleteDialog`（键入确认）
   - `ConsolePanel`（AutoDL 四合一）、`HardwareHealthPanel`（裸金属）、`TopologyView`（**仅内嵌于 vGPU 详情**）
   - `MetricCard`（DESIGN §8.3 五要素）、`CostBreakdownCard`（PRD §7.8）
   - `StateMachineBadge`（节点 5 态）、`LifecycleBadge`（资源 5 枚举态 + 已释放派生态）、`StatusBar`（§12.7 可开关）
3. **Layouts**：Sidebar（品牌区冻结） + Topbar（**无区域选择器**） + StatusBar（真实派生，可开关） + Outlet。
4. **Pages（features/）**：组合上述组件，绑定 Query/Store。**四类资源列表/详情各自独立组件，禁止共用一套模板**（PRD §4.3）。

---

## 8. 可视化与实时数据

- **GPU 利用率 / goodput**：Recharts 面积/折线 + 实时追加（Mock WS 每 2–5s；WS 端点由 `VITE_WS_URL` 配置）。
- **节点状态图**：全平台节点状态分布仅用于内部供给/故障模拟，不提供租户节点状态占比图或总览健康预览；vGPU 资源 Drawer 的资源级节点/工作负载视图遵循 PRD §4.3.3。
- **机架拓扑**：visx 节点-连线图，表达 rack → switch → node 与 NVL72 互联。
- **straggler 标记**：节点列表警示徽标，联动 `Remediation`。

**单位与阈值规范（避免 UI 自造）**

- 单位、小数位、降采样规则统一见 `MOCK-DATA.md` §6.0（15s 原始采样；近 1h/6h/24h/7d 分别降采样到 15s/1min/5min/1h；利用率取均值、延迟取 P50–P99）。
- **告警阈值与方法必须由后端/阈下发**（Mock 期放 `fixtures/thresholds.ts`），组件只读消费，**禁止在组件内硬编码数字比较**。
- 无数据统一渲染断点而非 0 线；Y 轴不得因单点毛刺无限放大，须按指标约定量程（利用率固定 0–100%）。

> **边界声明（重要）**：GPU 利用率、goodput、QPS、延迟等**时序指标不落 PostgreSQL**，由时序库或 Mock 提供；§12 的 PG 表只存**业务实体与计费聚合量**，不存高频采样点。指标字典与真实值口径详见 `MOCK-DATA.md` §6，切换真实 API 的隔离约定见 `MOCK-DATA.md` §11。

---

## 9. 状态机实现约定（节点 5 态 + 资源生命周期）

```text
# 节点（gpu_nodes.state）
states: Ready | Cordoned | Draining | Remediation | NotReady
events: CORDON, UNCORDON, DRAIN, EVICTED, FAIL, REMEDIATE, FIXED, REJOIN
transitions:
  Ready      --CORDON-->   Cordoned
  Cordoned   --UNCORDON--> Ready
  Cordoned   --DRAIN-->    Draining
  Draining   --EVICTED-->  NotReady
  Ready      --FAIL-->     NotReady
  NotReady   --REMEDIATE-> Remediation
  Remediation--FIXED-->    Ready
  NotReady   --REJOIN-->   Ready
  Any        --FAIL-->     NotReady

# 资源（resources.status）——闭环
states: Provisioning | Running | Stopped | Error | Terminating (+ deleted_at 软删终态)
events: READY, FAIL, STOP, START, TERMINATE, RETRY, RECYCLED
transitions:
  Provisioning --READY-->     Running        (置 running_since，起算算力费)
  Provisioning --FAIL-->      Error
  Error        --RETRY-->     Provisioning   (复用同一 order，幂等)
  Running      --STOP-->      Stopped        (算力停计，保留存储)
  Stopped      --START-->     Running
  Running      --TERMINATE--> Terminating
  Stopped      --TERMINATE--> Terminating
  Error        --TERMINATE--> Terminating
  Terminating  --RECYCLED-->  deleted_at 非空（终态）
```

`StateMachineBadge` / `LifecycleBadge` 依据 state 渲染"颜色 + 图标 + 文本"（满足可访问性）。

---

## 10. 主题与 Design System 集成

- 视觉属性全部来自 `tokens/`，以 CSS 变量注入 `:root` 与 `[data-theme="dark"]`。
- 组件不得硬编码色值，统一 `var(--rs-*)`；Token 与组件规范见 `DESIGN-SYSTEM.md`。

---

## 11. 构建与部署（前端）

- `vite build` 产出静态资源；对象存储 + CDN 托管（SPA 回退 index.html）。
- 本地 `vite dev` 可运行完整原型（含 MSW）；`vite preview` 验证生产产物。
- **环境变量注入时机**：构建期注入 `VITE_*`，运行期只读（见 §12.7）。

### 11.1 CI 流水线（v0.8，强制）

`.github/workflows/ci.yml`，**推送 `main` 与所有 PR** 触发；Node 22 + pnpm（corepack），依赖走 `pnpm install --frozen-lockfile`。

| 阶段 | 命令 | 失败即红 |
| --- | --- | --- |
| 1 · 类型 | `pnpm typecheck`（`tsc -b --force --noEmit`） | ✅ |
| 2 · 测试 | `pnpm test`（`vitest run`） | ✅ |
| 3 · 构建 | `pnpm build` | ✅ |

- `tsc` 有**增量缓存**，CI 必须带 `--force`，否则可能空输出误判通过。
- E2E（Playwright）**不在范围内**（PRD §11）。

### 11.2 产物分包与体积预算（v0.8）

- **`build.rollupOptions.output.manualChunks`** 按依赖族拆包：`react`（react/react-dom）、`router`（react-router）、`query`（@tanstack/react-query）、`charts`（recharts/d3 系）、`ui`（lucide-react/cmdk/radix）、`mocks`（MSW 与 mock 代码）。
- **MSW 必须按需动态导入**：`app/providers.tsx` 在 `VITE_ENABLE_MOCK=true` 时才 `await import('../mocks/browser')`。
  - 收益一：`VITE_ENABLE_MOCK=false` 的**生产构建不再打包 mock 与 fixture 种子**；
  - 收益二：入口 chunk 由 **1012 kB → 197 kB**（gzip 显著下降），首屏不再被 Mock 数据拖累。
- **体积预算**（PRD §10.1）：入口 chunk ≤ 250 kB（gzip ≤ 90 kB）；超出需在 PR 说明。
- **实测分包（v0.8 落地值，`dist/assets`）**：

  | chunk | 体积 | 说明 |
  | --- | --- | --- |
  | `browser-*.js`（MSW） | 365 kB | **动态导入**，`VITE_ENABLE_MOCK=false` 时不加载 |
  | `charts-*.js` | 363 kB | recharts/d3 系，仅图表页按需 |
  | `react-*.js` | 311 kB | react + react-dom |
  | **`index-*.js`（入口）** | **197 kB** | ✅ 满足预算 |
  | `ui-*.js` | 50 kB | lucide-react / cmdk / radix |
  | `query-*.js` | 40 kB | @tanstack/react-query |
  | 其余路由 chunk | 各 10–70 kB | 路由级懒加载 |
- `sourcemap: true` 保留，便于线上定位；`dist/` 不入库。

### 11.3 Docker 开发环境的监听策略（运维约定）

- `vite.config.ts` 的 `server.watch` **禁用 `usePolling`**：Docker Desktop 的 bind mount 会放大轮询开销，曾因仓库根残留大量缓存文件导致 gRPC-FUSE 返回 `EIO`、Vite 反复崩溃；现为 inotify 事件驱动、无常驻负载。
- **已知代价**：bind mount **不向容器传播宿主文件事件**，容器内 HMR 不生效。改源码后需 `docker compose up -d --force-recreate frontend`，再硬刷新浏览器（Ctrl+Shift+R）。
- 容器运行时 `pnpm install` 需出网，代理端口由宿主动态分配；**漂移时同步 `.env` 的 `COMPOSE_HTTP_PROXY` / `COMPOSE_HTTPS_PROXY`**，否则容器卡死在依赖安装。

---

## 12. 后端蓝图（仅供设计参考，本次不实现）

> 声明：本节 DDL **不在本次交付范围**，仅用于前端契约对齐。脚本为 PostgreSQL 15+ 可建表语句，字段与关系对应 PRD §6.5 / §7；**前端 Mock 实体须与之同构**。
> 修订要点：拆除订单↔资源**循环外键**、补齐生命周期终态、统一 ID/枚举命名、补齐资产/配额/工单/通知/事件等被 UI 引用但此前无模型的实体。
>
> **建表顺序（重要）**：`resource_placements.node_id` 外键指向 `gpu_nodes`，故实际执行顺序应为：**§12.1 identity → §12.3 supply → §12.2 deployment → §12.4 billing → §12.5 content**。本节按"业务叙事"编排，落库时请按上述依赖顺序执行。

### 12.1 identity — 用户与组织（用户表结构）

```sql
-- ===== 枚举 =====
CREATE TYPE user_status AS ENUM ('active','suspended','pending','deleted');
CREATE TYPE user_role   AS ENUM ('owner','admin','member','billing','viewer');
CREATE TYPE project_role AS ENUM ('admin','member','viewer');

-- 套餐（PLAN）
CREATE TABLE plans (
  code              VARCHAR(32) PRIMARY KEY,        -- free / standard / enterprise
  name              VARCHAR(64)  NOT NULL,
  free_credit_usd   NUMERIC(12,2) NOT NULL DEFAULT 0,   -- 首次注册赠送（一次性）
  max_members       INT          NOT NULL DEFAULT 20,
  support_level     VARCHAR(32)  NOT NULL DEFAULT 'community',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 组织 / 租户（计费与配额主体）
CREATE TABLE orgs (
  id                 BIGSERIAL PRIMARY KEY,
  name               VARCHAR(128) NOT NULL,
  slug               VARCHAR(64)  NOT NULL UNIQUE,
  plan_code          VARCHAR(32)  NOT NULL REFERENCES plans(code) ON UPDATE CASCADE,
  credit_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,        -- 账户余额（USD）
  currency           CHAR(3)      NOT NULL DEFAULT 'USD',     -- 计价币种，v1 固定 USD
  low_balance_threshold_usd NUMERIC(12,2) NOT NULL DEFAULT 50.00,
  status             VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_orgs_slug ON orgs(slug);

-- 用户 / 账号
CREATE TABLE users (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  org_id            BIGINT       NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  email             VARCHAR(255) NOT NULL UNIQUE,
  display_name      VARCHAR(128) NOT NULL,
  status            user_status  NOT NULL DEFAULT 'active',
  role              user_role    NOT NULL DEFAULT 'member',
  identity_provider VARCHAR(32),                                -- local/google/github/saml
  mfa_enabled       BOOLEAN      NOT NULL DEFAULT false,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_users_org   ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- 项目（Project：成本归集与切换维度）
CREATE TABLE projects (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT      NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       VARCHAR(128) NOT NULL,
  slug       VARCHAR(64)  NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE project_members (
  project_id BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    BIGINT       NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       project_role NOT NULL DEFAULT 'member',
  PRIMARY KEY (project_id, user_id)
);
```

### 12.2 deployment — 资源映射（资源映射相关表结构）

> 对应 PRD §5：下单 → 映射为四类之一 → 落到节点池/节点 → 呈现于「资源」菜单。

```sql
-- ===== 枚举 =====
CREATE TYPE region_code     AS ENUM ('jp','th','sg','us');
CREATE TYPE node_pool_code  AS ENUM ('H100_SXM','H200_NVL','B200_NVL72','B300','GB300_NVL72');
CREATE TYPE resource_kind   AS ENUM ('gpu_vm','gpu_baremetal','vgpu','inference');
CREATE TYPE resource_status AS ENUM ('provisioning','running','stopped','error','terminating');
CREATE TYPE order_status    AS ENUM ('pending','provisioning','fulfilled','failed');
CREATE TYPE source_type     AS ENUM ('direct','image','model','template','notebook');
CREATE TYPE step_state      AS ENUM ('pending','running','done','failed','skipped');
CREATE TYPE event_level     AS ENUM ('info','warning','error','success');

-- 部署中心：创建订单（即"工作项"，status 为任务状态）
CREATE TABLE deployment_orders (
  id               BIGSERIAL PRIMARY KEY,
  order_uuid       UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  org_id           BIGINT        NOT NULL REFERENCES orgs(id),
  owner_id         BIGINT        NOT NULL REFERENCES users(id),
  project_id       BIGINT        REFERENCES projects(id),
  resource_kind    resource_kind NOT NULL,
  requested_spec   JSONB         NOT NULL,          -- 请求规格（用户所选）
  region           region_code   NOT NULL,
  node_pool        node_pool_code,
  source_type      source_type   NOT NULL DEFAULT 'direct',
  source_ref_id    BIGINT,                          -- images.id / models.id / app_templates.id / notebooks.id
  price_snapshot   NUMERIC(14,4),                   -- 下单时预估单价（$/GPU·h）
  status           order_status  NOT NULL DEFAULT 'pending',
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_org ON deployment_orders(org_id, status);

-- 资源实例主表（映射后呈现于「资源」菜单）
CREATE TABLE resources (
  id             BIGSERIAL PRIMARY KEY,
  resource_uuid  UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(),   -- 对外/路由
  display_id     VARCHAR(32)   NOT NULL UNIQUE,                             -- UI 短码 srv-a1b2c3
  org_id         BIGINT        NOT NULL REFERENCES orgs(id),
  owner_id       BIGINT        NOT NULL REFERENCES users(id),
  project_id     BIGINT        REFERENCES projects(id),
  order_id       BIGINT        REFERENCES deployment_orders(id),            -- 唯一来源（单向，避免循环）
  kind           resource_kind NOT NULL,
  name           VARCHAR(128)  NOT NULL,
  region         region_code   NOT NULL,
  node_pool      node_pool_code NOT NULL,          -- 主节点池
  spec_json      JSONB         NOT NULL,           -- 实际供给规格（契约见 §12.9）
  gpu_count      INT           NOT NULL DEFAULT 0,
  storage_gb     NUMERIC(12,2) NOT NULL DEFAULT 0,
  status         resource_status NOT NULL DEFAULT 'provisioning',
  running_since  TIMESTAMPTZ,                      -- 算力计费起算点
  stopped_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ                       -- 软删终态
);
CREATE INDEX idx_resources_org_kind ON resources(org_id, kind);
CREATE INDEX idx_resources_status   ON resources(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_resources_order    ON resources(order_id);

-- 资源 ↔ 节点供给映射（实际落位）
CREATE TABLE resource_placements (
  id           BIGSERIAL PRIMARY KEY,
  resource_id  BIGINT         NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  node_pool    node_pool_code NOT NULL,            -- 实际落位节点池（与主 node_pool 可不同：多节点场景）
  node_id      BIGINT         REFERENCES gpu_nodes(id),   -- 实际节点
  rack_id      VARCHAR(64),
  gpu_indices  INT[],                              -- 占用的 GPU 卡序号
  assigned_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_placements_resource ON resource_placements(resource_id);

-- 资源事件（详情页"事件时间线"数据源）
CREATE TABLE resource_events (
  id          BIGSERIAL PRIMARY KEY,
  resource_id BIGINT      NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  org_id      BIGINT      NOT NULL REFERENCES orgs(id),
  type        VARCHAR(48) NOT NULL,                -- created/provisioned/started/stopped/error...
  level       event_level NOT NULL DEFAULT 'info',
  message     TEXT        NOT NULL,
  actor_user_id BIGINT    REFERENCES users(id),    -- 人/系统触发者
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_res_events ON resource_events(resource_id, created_at DESC);

-- 供给子任务（Provisioning 进度步骤数据源）
CREATE TABLE resource_provisioning_steps (
  id          BIGSERIAL PRIMARY KEY,
  resource_id BIGINT     NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  seq         SMALLINT   NOT NULL,
  step_key    VARCHAR(48) NOT NULL,                -- schedule/provision/pull_image/attach_storage/ready
  state       step_state NOT NULL DEFAULT 'pending',
  message     TEXT,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (resource_id, step_key)
);
```

> **循环外键已拆除（评审修订）**：旧版 `deployment_orders.resulting_resource_id ↔ resources.order_id` 双向引用会造成插入时序死锁且两份关系可能不一致。现仅保留 **单向** `resources.order_id`；"某订单产出了什么资源"通过 `WHERE order_id = ?` 查询获得。

### 12.3 supply — 供给侧（平台内部，不对租户展示）

> 旧版 `resource_placements.node_id` 指向了**不存在的节点实体**；现补齐 `node_pools` / `gpu_nodes` / `node_events`。

```sql
CREATE TYPE node_state AS ENUM ('ready','cordoned','draining','remediation','notready');

CREATE TABLE node_pools (
  code            node_pool_code PRIMARY KEY,
  display_name    VARCHAR(32)  NOT NULL,           -- H100 SXM / H200 NVL ...
  gpu_model       VARCHAR(32)  NOT NULL,
  gpus_per_node   INT          NOT NULL DEFAULT 8,
  vram_gb         INT          NOT NULL,
  interconnect    VARCHAR(32),                     -- NVLink / NVL72 / IB
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE gpu_nodes (
  id            BIGSERIAL PRIMARY KEY,
  node_uid      VARCHAR(64)  NOT NULL UNIQUE,
  pool_code     node_pool_code NOT NULL REFERENCES node_pools(code),
  region        region_code  NOT NULL,
  rack_id       VARCHAR(64),
  switch_group  VARCHAR(64),
  gpu_count     INT          NOT NULL DEFAULT 0,
  state         node_state   NOT NULL DEFAULT 'ready',
  straggler     BOOLEAN      NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_nodes_pool_region ON gpu_nodes(pool_code, region);
CREATE INDEX idx_nodes_state       ON gpu_nodes(state);

CREATE TABLE node_events (
  id            BIGSERIAL PRIMARY KEY,
  node_id       BIGINT      NOT NULL REFERENCES gpu_nodes(id) ON DELETE CASCADE,
  type          VARCHAR(48) NOT NULL,              -- cordon/uncordon/drain/evicted/fail/remediate/fixed/rejoin
  level         event_level NOT NULL DEFAULT 'info',
  message       TEXT,
  actor_user_id BIGINT      REFERENCES users(id),  -- 运维操作者（可空=系统自动）
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_node_events ON node_events(node_id, created_at DESC);
```

### 12.4 billing — 计费与资产（billing 表结构）

> 对应 PRD §7：按 GPU·小时统一计量、实时客帐扣费 + 月结对账单、代金券/预留/配额落库。

```sql
-- ===== 枚举 =====
-- per_machine_hour 为 v0.6 新增：GPU 裸金属按「整台物理机·小时」计价（不是按卡）
CREATE TYPE rate_unit         AS ENUM ('per_gpu_hour','per_machine_hour','per_gb_hour','per_instance_hour');
CREATE TYPE invoice_status    AS ENUM ('open','paid','overdue','void');
CREATE TYPE txn_type          AS ENUM ('charge','refund','credit','adjustment');
CREATE TYPE voucher_status    AS ENUM ('unused','partial','used','expired','void');
CREATE TYPE reservation_status AS ENUM ('scheduled','active','expired','cancelled','refunded');
CREATE TYPE quota_metric      AS ENUM ('gpu','vcpu','memory_gb','storage_gb','public_ip');

-- 单价表（资源类型 × 节点池 × 区域 × 单位 × 有效期）
CREATE TABLE billing_rates (
  id            BIGSERIAL PRIMARY KEY,
  resource_kind resource_kind NOT NULL,
  node_pool     node_pool_code NOT NULL,
  region        region_code   NOT NULL,
  unit          rate_unit     NOT NULL,
  price         NUMERIC(10,4) NOT NULL,           -- 单价（USD）
  currency      CHAR(3)       NOT NULL DEFAULT 'USD',
  effective_from DATE         NOT NULL,
  effective_to   DATE,                            -- 空=当前有效
  UNIQUE (resource_kind, node_pool, region, unit, effective_from)
);

-- 用量 / 计费事件（按小时聚合）
CREATE TABLE billing_usage (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT        NOT NULL REFERENCES orgs(id),
  project_id     BIGINT        REFERENCES projects(id),
  resource_id    BIGINT        NOT NULL REFERENCES resources(id),
  resource_kind  resource_kind NOT NULL,
  node_pool      node_pool_code NOT NULL,
  region         region_code   NOT NULL,
  unit           rate_unit     NOT NULL,
  quantity       NUMERIC(12,4) NOT NULL,          -- GPU·h / GB·h
  unit_price     NUMERIC(10,4) NOT NULL,          -- 定价时快照
  amount         NUMERIC(14,4) NOT NULL,          -- 不可变金额快照
  billing_period DATE          NOT NULL,          -- 账期 yyyy-mm-01
  usage_hour     TIMESTAMPTZ   NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (resource_id, usage_hour, unit)          -- 幂等防重复计量
);
CREATE INDEX idx_usage_org_period ON billing_usage(org_id, billing_period);
CREATE INDEX idx_usage_resource   ON billing_usage(resource_id);

-- 发票 / 月结对账单（凭证，不是二次扣费）
CREATE TABLE invoices (
  id             BIGSERIAL PRIMARY KEY,
  invoice_uuid   UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  org_id         BIGINT       NOT NULL REFERENCES orgs(id),
  billing_period DATE         NOT NULL,
  subtotal       NUMERIC(14,2) NOT NULL,
  tax            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'USD',
  status         invoice_status NOT NULL DEFAULT 'open',
  due_at         TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_org_period ON invoices(org_id, billing_period);

-- 账户交易流水（实时客帐：正=入账，负=扣费）
CREATE TABLE billing_transactions (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT       NOT NULL REFERENCES orgs(id),
  type           txn_type     NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'USD',
  balance_after  NUMERIC(14,2) NOT NULL,
  reference_type VARCHAR(32),                     -- invoice/usage/plan_signup/refund/manual/voucher/reservation
  reference_id   BIGINT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_txn_org ON billing_transactions(org_id, created_at DESC);

-- 代金券（资产·代金券）
CREATE TABLE vouchers (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT      NOT NULL REFERENCES orgs(id),
  code           VARCHAR(48) NOT NULL UNIQUE,
  amount         NUMERIC(12,2) NOT NULL,
  balance        NUMERIC(12,2) NOT NULL,
  currency      CHAR(3)      NOT NULL DEFAULT 'USD',
  applicable_kind  resource_kind,                 -- 空=不限类型
  applicable_region region_code,                  -- 空=不限区域
  status         voucher_status NOT NULL DEFAULT 'unused',
  valid_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to       TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE voucher_redemptions (
  id          BIGSERIAL PRIMARY KEY,
  voucher_id  BIGINT       NOT NULL REFERENCES vouchers(id),
  invoice_id  BIGINT       REFERENCES invoices(id),
  amount      NUMERIC(12,2) NOT NULL,
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_redemptions_voucher ON voucher_redemptions(voucher_id);

-- 预留实例（费用中心·我的账单，v0.9）
CREATE TABLE reservations (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT        NOT NULL REFERENCES orgs(id),
  node_pool      node_pool_code NOT NULL,
  region         region_code   NOT NULL,
  gpu_count      INT           NOT NULL,
  committed_price_per_gpu_hour NUMERIC(10,4) NOT NULL,
  start_at       TIMESTAMPTZ   NOT NULL,
  end_at         TIMESTAMPTZ   NOT NULL,
  status         reservation_status NOT NULL DEFAULT 'scheduled',
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_reservations_org ON reservations(org_id, status);

-- 存储包（资产·存储包）
CREATE TABLE storage_packs (
  id           BIGSERIAL PRIMARY KEY,
  org_id       BIGINT       NOT NULL REFERENCES orgs(id),
  size_gb      NUMERIC(12,2) NOT NULL,
  remaining_gb NUMERIC(12,2) NOT NULL,
  valid_from   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  valid_to     TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 配额（运营·配额；resource_kind/region 为 NULL 表示不限该维度）
CREATE TABLE quotas (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT      NOT NULL REFERENCES orgs(id),
  resource_kind resource_kind,
  region        region_code,
  metric        quota_metric NOT NULL,
  limit_value   NUMERIC(14,2) NOT NULL,
  used_value    NUMERIC(14,2) NOT NULL DEFAULT 0,   -- 派生值，定时重算
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, resource_kind, region, metric)
);
```

> **余额一致性**：每小时用量聚合后在同一事务内生成 `billing_transactions(type='charge')` 并更新 `orgs.credit_balance`；低于 `low_balance_threshold_usd` 由 billing 服务写 `notifications` 告警（联动 PRD §3.2 状态栏）。

### 12.5 content / 支撑实体（模型库、商城、数据、工单、通知）

> 补齐"被 UI 引用但此前无数据模型"的实体，使来源追溯与工单关联可落地。

```sql
-- 模型库
CREATE TABLE models (
  id           BIGSERIAL PRIMARY KEY,
  slug         VARCHAR(128) NOT NULL UNIQUE,
  name         VARCHAR(160) NOT NULL,
  source       VARCHAR(32)  NOT NULL,             -- hf_mirror/official/community
  modality     VARCHAR(32),                        -- llm/diffusion/embedding...
  param_size   VARCHAR(16),                        -- 7B/70B...
  license      VARCHAR(64),
  quantization VARCHAR(32),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_favorites (
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id BIGINT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, model_id)
);

-- 镜像商城
CREATE TABLE images (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  registry      VARCHAR(255) NOT NULL,
  tag           VARCHAR(64)  NOT NULL,
  framework     VARCHAR(64),                       -- pytorch/tensorflow...
  cuda_version  VARCHAR(32),
  size_gb       NUMERIC(10,2),
  is_official   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI 应用模板
CREATE TABLE app_templates (
  id          BIGSERIAL PRIMARY KEY,
  slug        VARCHAR(128) NOT NULL UNIQUE,
  name        VARCHAR(160) NOT NULL,
  category    VARCHAR(64),                         -- chatbot/embedding/comfyui...
  default_image_id BIGINT REFERENCES images(id),
  form_schema JSONB       NOT NULL DEFAULT '{}',   -- 表单化参数
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notebook（开发模块；挂靠到已有资源，不产生资源实例）
CREATE TABLE notebooks (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT      NOT NULL REFERENCES orgs(id),
  user_id     BIGINT      NOT NULL REFERENCES users(id),
  resource_id BIGINT      REFERENCES resources(id) ON DELETE SET NULL,
  resource_kind resource_kind,                   -- v0.7：挂靠形态 gpu_vm/gpu_baremetal/vgpu（PRD §4.5.1）
  type        VARCHAR(16) NOT NULL DEFAULT 'jupyter',  -- jupyter/vscode
  status      VARCHAR(16) NOT NULL DEFAULT 'running',
  url_path    VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 数据模块（最小集）
-- 数据集（PRD §4.6.1）：一个数据集可有多个版本，列表显示最新版本
CREATE TABLE datasets (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT      NOT NULL REFERENCES orgs(id),
  name       VARCHAR(160) NOT NULL,
  latest_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  size_gb    NUMERIC(12,2) NOT NULL DEFAULT 0,       -- 最新版本规模（列表列）
  format_tag VARCHAR(32),                            -- parquet/jsonl/image/...（列表列与筛选）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 数据集版本（详情 Drawer「版本列表」）
CREATE TABLE dataset_versions (
  id          BIGSERIAL PRIMARY KEY,
  dataset_id  BIGINT      NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version     VARCHAR(32) NOT NULL,
  size_gb     NUMERIC(12,2) NOT NULL DEFAULT 0,
  change_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version)
);

-- 数据集引用关系（引用完整性：删除前检查，被引用则 409）
CREATE TABLE dataset_references (
  id          BIGSERIAL PRIMARY KEY,
  dataset_id  BIGINT      NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  ref_type    VARCHAR(32) NOT NULL,                  -- notebook/pipeline/deployment
  ref_id      BIGINT      NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, ref_type, ref_id)
);

CREATE TABLE buckets (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT      NOT NULL REFERENCES orgs(id),
  name       VARCHAR(128) NOT NULL,
  region     region_code NOT NULL,
  access     VARCHAR(16) NOT NULL DEFAULT 'private',  -- private/public_read（桶列表列）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE objects (
  id            BIGSERIAL PRIMARY KEY,
  bucket_id     BIGINT      NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  key           VARCHAR(512) NOT NULL,
  size_bytes    BIGINT      NOT NULL DEFAULT 0,
  storage_class VARCHAR(16) NOT NULL DEFAULT 'standard',  -- standard/infrequent（对象列表列）
  content_type  VARCHAR(128),
  etag          VARCHAR(64),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 桶生命周期规则（PRD §4.6.2）：按前缀 N 天后转低频 / 删除
CREATE TABLE bucket_lifecycle_rules (
  id          BIGSERIAL PRIMARY KEY,
  bucket_id   BIGINT      NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  prefix      VARCHAR(512) NOT NULL DEFAULT '',
  action      VARCHAR(16) NOT NULL,                  -- transition/expire
  after_days  INT         NOT NULL CHECK (after_days >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pipelines (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT      NOT NULL REFERENCES orgs(id),
  name       VARCHAR(160) NOT NULL,
  dag_json   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 流水线运行历史（PRD §4.6.3：运行历史 + 节点级日志与产物）
CREATE TYPE pipeline_run_status AS ENUM ('success','running','failed','never');

CREATE TABLE pipeline_runs (
  id            BIGSERIAL PRIMARY KEY,
  pipeline_id   BIGINT      NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  status        pipeline_run_status NOT NULL DEFAULT 'never',
  triggered_by  VARCHAR(16) NOT NULL DEFAULT 'manual',  -- manual/schedule
  actor_user_id BIGINT      REFERENCES users(id),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  duration_sec  INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 节点级运行明细（输入/输出/参数/日志/产物）
CREATE TABLE pipeline_run_nodes (
  id               BIGSERIAL PRIMARY KEY,
  run_id           BIGINT      NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  node_key         VARCHAR(64) NOT NULL,             -- dag_json 内的节点标识
  status           VARCHAR(16) NOT NULL DEFAULT 'pending',
  params_json      JSONB       NOT NULL DEFAULT '{}',
  logs_json        JSONB       NOT NULL DEFAULT '[]',
  outputs_json     JSONB       NOT NULL DEFAULT '[]'
);

-- 工单（运营·工单；可关联资源）
CREATE TYPE ticket_status   AS ENUM ('open','pending','resolved','closed');
CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');

CREATE TABLE tickets (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT      NOT NULL REFERENCES orgs(id),
  user_id     BIGINT      NOT NULL REFERENCES users(id),
  resource_id BIGINT      REFERENCES resources(id) ON DELETE SET NULL,
  subject     VARCHAR(200) NOT NULL,
  description TEXT,
  status      ticket_status   NOT NULL DEFAULT 'open',
  priority    ticket_priority NOT NULL DEFAULT 'normal',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_org ON tickets(org_id, status);

-- 通知中心
CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT      NOT NULL REFERENCES orgs(id),
  user_id    BIGINT      REFERENCES users(id),     -- 空=组织级广播
  type       VARCHAR(48) NOT NULL,                 -- node_notready/task_failed/balance_alert...
  level      event_level NOT NULL DEFAULT 'info',
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  link       VARCHAR(255),
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_org_user ON notifications(org_id, user_id, read_at);
```

### 12.6 统一枚举与命名映射（单一事实来源，强制）

> 组件/路由/Mock 必须引用下表同一份常量，禁止自定义第二套（来源：PRD §5.2.1、§9.1、§9.2）。

| `resource_kind`   | 路由 `routeKey` | 显示名     | `display_id` 前缀 |
| ----------------- | ------------- | ------- | --------------- |
| `gpu_vm`          | `servers`     | GPU 云服务器 | `srv-`          |
| `gpu_baremetal`   | `baremetal`   | GPU 裸金属  | `bm-`           |
| `vgpu`            | `vgpu`        | vGPU    | `vgpu-`         |
| `inference`       | `inference`   | 推理服务    | `inf-`          |

| `region_code` | 显示名 | ISO |
| ------------- | --- | --- |
| `jp`          | 日本  | JP  |
| `th`          | 泰国  | TH  |
| `sg`          | 新加坡 | SG  |
| `us`          | 美国  | US  |

| `node_pool_code` | 显示名        |
| ---------------- | ---------- |
| `H100_SXM`       | H100 SXM   |
| `H200_NVL`       | H200 NVL   |
| `B200_NVL72`     | B200 NVL72 |
| `B300`           | B300       |
| `GB300_NVL72`    | GB300 NVL72 |

**弹性伸缩枚举（v0.7 新增，单一事实来源；PRD §4.2.6）**

| `strategy_model` | 显示名     | 适用 `resource_kind`                |
| ---------------- | ------- | --------------------------------- |
| `node_pool`      | 节点池伸缩   | `gpu_vm` / `gpu_baremetal` / `vgpu` |
| `replica`        | 服务副本伸缩  | `inference`                        |

| `scaling_trigger`  | 显示名         | 适用模型              | 备注                          |
| --------------- | ----------- | ----------------- | --------------------------- |
| `queue_depth`   | 队列深度        | `node_pool`       | 云服务器/vGPU 首选；替代失效的 GPU 利用率 |
| `pending_pods`  | 待调度 Pod 数   | `node_pool`       | vGPU 集群维度                  |
| `qpm`           | 每分钟查询数 QPM  | `node_pool`/`replica` | 推理主力指标                     |
| `gpu_allocation_rate` | GPU 分配率   | `node_pool`       | 裸金属维度（集群级）                |
| `concurrency`   | 并发数         | `replica`         | 推理副本级                      |
| `ttft_p99`      | 首 Token 延迟 P99 | `replica`      | 推理副本级                      |
| `kv_cache_usage` | KV Cache 使用率 | `replica`        | 推理副本级                      |
| `requests_waiting` | 等待请求数      | `replica`        | 推理副本级（PRD §4.2.4 明确列出）       |

| `scaling_status` | 显示名  |                                   |
| -------------- | ---- | --------------------------------- |
| `active`       | 生效中  | 正常按策略伸缩                          |
| `paused`       | 已暂停  | 用户手动暂停；不再触发伸缩                    |
| `cooldown`     | 冷却中  | stabilization 窗口内，抑制反向动作         |

| `scaling_direction` | 显示名 |
| ---------------- | --- |
| `scale_out`      | 扩容 |
| `scale_in`       | 缩容 |

```
路由：/resources/:routeKey                 （列表）
路由：/resources/:routeKey/:resourceUuid   （详情，参数为 resource_uuid）
展示：display_id（srv-a1b2c3），⌘K 可按 display_id 或 resource_uuid 搜索
内部：resources.id 仅作主键，禁止出现在接口响应与 URL
```

### 12.7 环境变量与开关（评审新增，消除悬空配置）

> 旧版文档声明"关闭 MSW 指向网关"却未定义如何切换。下表为唯一配置来源，`lib/api-client` 与 `app/providers.tsx` 消费。

| 变量                         | 类型      | 默认值                       | 消费位置                                | 说明             |
| -------------------------- | ------- | ------------------------- | ----------------------------------- | -------------- |
| `VITE_ENABLE_MOCK`         | boolean | `true`                    | `app/providers.tsx`（MSW 初始化开关）       | `false` 时不再拦截请求 |
| `VITE_API_BASE_URL`        | string  | `http://localhost:8080`   | `lib/api-client`（baseURL）           | Mock 关闭时的网关地址  |
| `VITE_DEFAULT_REGION`      | enum    | `jp`                      | `stores/region` 初始值                  | ∈ jp/th/sg/us  |
| `VITE_WS_URL`              | string  | 空                         | `lib/api-client`（实时通道）              | 为空则退化为轮询       |
| `VITE_POLL_INTERVAL_MS`    | number  | `3000`                    | 轮询降级路径                              | 仅在无 WS 时生效     |
| `VITE_FEATURE_STATUS_BAR`  | boolean | `true`                    | `layouts`（StatusBar 渲染开关）           | 紧急下线状态栏时用      |
| `VITE_FEATURE_TOPOLOGY`    | boolean | `true`                    | `components/ops/TopologyView`（**内嵌于 `features/resources/vgpu` 详情页**，无独立路由） | 拓扑图较重，可降级为隐藏该 Tab |
| `VITE_THEME_DEFAULT`       | enum    | `light`                   | `stores/theme` 初始值                  | light/dark     |
| `VITE_LOW_BALANCE_THRESHOLD_USD` | number | `50`                 | StatusBar 提示阈值（真实阈值以后端 `orgs.low_balance_threshold_usd` 为准） | 前端兜底展示  |
| `VITE_MOCK_SEED`           | number  | `20261017`                | `mocks/lib/rng.ts`（种子随机）          | 固定种子保证 fixture 可复现（G5） |
| `VITE_ENABLE_CONSISTENCY_CHECK` | boolean | `true`（仅 dev）      | `mocks/lib/consistency.ts`  | Mock 数据运行时断言开关（§8.3） |
| `VITE_MOCK_FAULT`          | enum    | 空                         | `mocks/lib/fault-injector.ts`     | ∈ oom/xid48/network/straggler/insufficient/billing；亦可用 `?fault=` 覆盖 |
| `VITE_I18N_DEFAULT_LOCALE` | enum    | `zh-CN`                   | `i18n/` locale store 初始值   | ∈ zh-CN/en-US；用户切换后以 `localStorage`（`rs.locale`）为准 |

> 所有 `VITE_*` 在**构建期注入**；涉及安全的配置严禁放前端（如数据库口令、内部服务凭证）。
> `VITE_MOCK_SEED` / `VITE_ENABLE_CONSISTENCY_CHECK` / `VITE_MOCK_FAULT` 仅在 `VITE_ENABLE_MOCK=true` 时生效，Mock 关闭后 `mocks/lib/derive.ts` **不得被调用**（派生责任移交后端）。

### 12.8 边界声明

- **不落 PostgreSQL**：GPU 利用率、显存、goodput、温度、QPS、延迟等**时序采样**（由时序库或 Mock 提供；完整指标字典与真实值口径见 `MOCK-DATA.md` §6）。
- **落 PostgreSQL**：业务实体（identity/deployment/supply/content）、计费**聚合量**（`billing_usage`）、事件与审计（`*_events`）。
- `quotas.used_value` 为派生字段，**禁止业务代码直接写入**，仅由重算任务更新，避免双写不一致。

### 12.9 `spec_json` 契约（Zod 校验）

> GPU 裸金属按整台物理机采购，计费 `unit='per_machine_hour'`、`quantity = machine_count`。`gpu_count` 在裸金属语境下表示整机总卡数（`machine_count × gpus_per_node`），仅用于展示，不作为计费数量。

| `kind`           | 必需键                                                                                 | 可选键                                        |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| `gpu_vm`         | `gpu_model`, `gpu_count`, `vcpu`, `memory_gb`, `storage_gb`, `image_ref`            | `env`, `ports`, `ssh_pubkey`, **`scaling`** |
| `gpu_baremetal`  | `machine_type`, `machine_count`(台), `gpu_model`, `gpu_count`(整机总卡), `passthrough`(bool), `cpu_model`, `local_nvme_gb` | `ipmi_enabled`, `ib_enabled`, **`scaling`** |
| `vgpu`           | `k8s_version`, `node_count`, `gpu_count`, `slicing_policy`(MIG profile), `storage_gb` | `network_plugin`, `ingress_enabled`, **`scaling`** |
| `inference`      | `model_ref`, `replicas`, `gpu_count`, `port`, `auth_enabled`                         | **`scaling`**, `traffic_split` |

- **`scaling` 键契约（PRD §4.2.6）**：`{ strategy_model, trigger_metric, target_value?, min_size, max_size, scale_to_zero?, drain_timeout_s, fallback_enabled, cooldown_s }`；`strategy_model ∈ {node_pool, replica}`。GPU 云服务器与裸金属要求 `min_size ≥ 1`；推理服务仅在用户明确开启 `scale_to_zero` 并二次确认后允许 `min_size=0`；vGPU 的零规模策略尚未由 PRD 定义，不得作为已支持能力呈现。配额预检按 `max_size` 档校验（超限 `409 QUOTA_EXCEEDED`）。向导开关写入 `requested_spec.scaling`，下单后生成 `scaling_policies` 行（§12.12），资源 Drawer「弹性」Tab 读取同一行。
- `requested_spec`（订单请求）与 `spec_json`（实际供给）**允许不同**，UI 详情展示"实际规格"，差异来自库存/调度降级；两者皆过 Zod。

---

### 12.10 删除语义与数据自洽约束

> 回应评审：删除必须为**真实数据操作**；Mock 数据须逻辑自洽；前后端不得有悬空配置/空指针。

#### 12.10.1 删除语义（真实软删）
- 前端删除按钮 → `DELETE /api/resources/:uuid`；后端置 `resources.deleted_at = now()`（软删终态），**不物理删除**（保留审计）。
- 副作用（同一事务或级联）：释放 `quotas.used_value`（按 §7.3 口径重算）、停止 `billing_usage` 写入、取消 `resource_provisioning_steps` 进行中步骤。
- 列表查询恒加 `WHERE deleted_at IS NULL`；详情对 `deleted_at` 非空返回 410/软删态。前端失效该资源 Query 缓存并从列表移除。
- **禁止**再把删除按钮做成禁用占位或只弹 Toast。

#### 12.10.2 数据自洽约束（逻辑自洽，强制）
- **project 必填**：`resources.project_id NOT NULL REFERENCES projects(id)`；下单 `deployment_orders.project_id NOT NULL`；**不得写死 `PROJECTS[0]`**。
- **region 维度一致**：所有区域相关实体（`resources`/`gpu_nodes`/`node_pools` 可用量/`billing_usage`）的 `region` 必须 ∈ `region_code`；**切换区域后查询必须按 `region` 过滤重算**，Mock 与真实后端一致。
- **裸金属单位约束**：`gpu_baremetal` 计费 `unit='per_machine_hour'`、`quantity = machine_count`；`gpu_count = machine_count × node_pools.gpus_per_node`。
- **容量/规格一致性**：`gpu_vm.gpu_count ≤ node_pools.gpus_per_node`；`gpu_count > 0`；`storage_gb ≥ 0`。
- **区域×节点池可用性矩阵**：`POOL_REGIONS` 约束（如 `GB300_NVL72` 仅 `us`）；前端对该池在非可用区域必须置灰且**不可下单**。
- **阈值/枚举单一来源**：所有阈值（`thresholds.ts`）、区域/节点池/类型映射（`lib/ids.ts`、`fixtures/*`）为唯一来源；**组件不得硬编码数字/枚举/第二套命名**，杜绝悬空配置。
- **无悬空外键**：`resource_events` / `resource_placements` / `resource_provisioning_steps` 随 `resources` `ON DELETE CASCADE`；软删后子表仍可查（审计保留）。
- **派生值不可直写**：`quotas.used_value` / `billing_usage.amount` 仅为派生/快照，业务代码不直接写主表双份。

#### 12.10.3 DDL 级约束清单（可直接落库，Mock 亦须遵守）

> 回应"建立新的约束条件，制定 Mock 数据结构使其逻辑自洽"。下表既是**真实建表约束**，也是 **Mock fixture 的运行时断言来源**（`mocks/lib/consistency.ts` 逐条实现）。

| #  | 约束                | DDL（PostgreSQL）                                                                                                                                                                                             |
| -- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 | **项目必填**          | `ALTER TABLE resources ALTER COLUMN project_id SET NOT NULL;`<br>`ALTER TABLE deployment_orders ALTER COLUMN project_id SET NOT NULL;`                                                                        |
| C2 | **区域×节点池可用矩阵**    | `CREATE TABLE pool_regions (pool node_pool_code, region region_code, PRIMARY KEY(pool,region));`<br>按 MOCK-DATA §5.4 填充：`GB300_NVL72` 仅 `us`；`B200_NVL72` 仅 `us,jp`；`B300` 仅 `us,sg` 等                        |
| C3 | **裸金属按台**         | `ADD CONSTRAINT chk_bm CHECK (kind<>'gpu_baremetal' OR (spec_json->>'machine_count')::int BETWEEN 1 AND 32);`；**台数 × `node_pools.gpus_per_node` 的卡数一致性**（Q5 决议：不写死 8）由应用层 / 触发器校验                      |
| C4 | **GPU 数不超单节点上限**   | 应用层 / 触发器校验：`kind<>'gpu_baremetal'` 时 `1 <= gpu_count <= node_pools.gpus_per_node`（Q5 决议：上限取 `gpus_per_node`，禁止硬编码 8）                                                                             |
| C5 | **计费单位与类型绑定**      | `ADD CONSTRAINT chk_unit CHECK ((kind='gpu_baremetal' AND unit='per_machine_hour') OR (kind<>'gpu_baremetal' AND unit IN ('per_gpu_hour','per_gb_hour')));`（在 `billing_rates`/`billing_usage` 各加一份）        |
| C6 | **容量非负且不超总量**      | `CHECK (available_gpu >= 0 AND available_gpu <= total_gpu)`；`billing_usage.quantity >= 0`；`storage_gb >= 0`                                                                                                       |
| C7 | **时间与生命周期一致**      | `CHECK (status<>'running' OR running_since IS NOT NULL)`；<br>`CHECK (running_since IS NULL OR running_since <= now())`；<br>`CHECK (stopped_at IS NULL OR stopped_at >= running_since)`                        |
| C8 | **终态互斥**          | `CHECK (deleted_at IS NULL OR status = 'terminating')`；软删后不得再变更为其他状态                                                                                                                                          |
| C9 | **显存可行性**（推理）     | 写入前校验：`weights_gb + kv_gb + 2 <= gpu_per_replica * vram_gb`（MOCK-DATA §7.3/§7.4）；不满足则拒绝下单                                                                                                                       |
| C10 | **区域维度非空**        | `resources.region` / `gpu_nodes.region` / `billing_usage.region` / `node_pools` 容量行 **全部 `NOT NULL`**，杜绝"切区域无变化"的结构性诱因                                                                                            |
| C11 | **配额作用域唯一**       | `UNIQUE (org_id, resource_kind, region, metric)`（已定义，注意 `NULL` 需 `UNIQUE NULLS NOT DISTINCT` 或改为哨兵值）                                                                                                             |
| C12 | **度量与事件一致**       | 每个 `state <> 'ready'` 的 `gpu_nodes` 行，必须存在 ≥1 条 `node_events`（应用层断言，无法用 FK 表达）                                                                                                                                  |
| C13 | **默认项目不可删**       | `projects` 增加 `is_default BOOLEAN NOT NULL DEFAULT false`，删除时 `CHECK (NOT is_default)`                                                                                                                        |
| C14 | **删除项目前必须无资源**    | 应用层：`DELETE /api/projects/:id` 前 `SELECT COUNT(*) FROM resources WHERE project_id=? AND deleted_at IS NULL`，>0 则 409                                                                                            |

> **Mock 侧等价要求**：`mocks/lib/consistency.ts` 在 dev 模式下对每条 fixture 执行上表可断言项（C1–C10、C12），失败即 `console.error` + Toast（MOCK-DATA §8.3）。

### 12.11 接口契约（前后端唯一约定）

> 回应"保证前后端逻辑通畅"：以下为前端实际调用面，**Mock（MSW）与真实后端必须实现同一套**，字段级一致；`VITE_ENABLE_MOCK=false` 时仅 baseURL 变化，前端代码零改动。

#### 12.11.1 删除资源（真实落库）

> 删除接口契约：确认参数通过查询参数 `?confirm` 传递；后端收到确认后立即写入 `deleted_at`；错误体 `code` 使用本节定义的全大写短名。

```
DELETE /api/resources/:uuid?confirm=<display_id>
Resp 200: { resourceUuid, displayId, status: 'terminating', deletedAt: '2026-10-19T06:30:00Z',
            releasedQuota: [{ metric:'gpu', amount:8 }, { metric:'storage_gb', amount:100 }],
            finalSettlement: { amount: 0.42, currency:'USD' } }
```

| HTTP | body.code | 触发条件 | 前端处理（PRD §5.4.1） |
| ---- | --------- | -------- | ---------------------- |
| 403 | `FORBIDDEN` | 角色无权（billing / viewer） | 提示所需角色 |
| 404 | `NOT_FOUND` | 资源不存在 | 刷新列表 |
| 409 | `ALREADY_DELETED` | 资源已软删，重复删除 | 刷新列表，提示已删除 |
| 409 | `INVALID_STATE` | 当前状态不允许删除（如已在 `terminating`） | 提示当前状态 |
| 410 | `GONE` | 对已释放资源请求详情（非删除接口） | 只读历史视图 |
| 422 | `CONFIRM_MISMATCH` | `confirm` 与 `display_id` 不一致 | 保留对话框，要求重新键入 |
| 423 | `HAS_DEPENDENCIES` | 存在未释放依赖（预留 / 工单 / 挂载） | 列出 `dependencies[]` 与跳转链接 |
| 429 | `RATE_LIMITED` | 限流 | 允许重试 |
| 5xx | `INTERNAL` | 服务端 | 保留对话框 + 重试 |

**级联（后端同一事务或可靠队列，顺序不可乱）**
1. **立即**写 `resources.deleted_at = now()`、`status='terminating'`；回收完成后保持 `terminating`，`deleted_at` 已非空即视为软删终态；
2. 结算最后一小时：按实际秒数写 `billing_usage`（`UNIQUE` 冲突则忽略）+ `billing_transactions(type='charge')` + 更 `orgs.credit_balance`；
3. 释放 `quotas.used_value`（按 PRD §7.3 口径重算）；
4. `resource_provisioning_steps` 中 `state IN (pending,running)` → `skipped`；
5. 写 `resource_events(type='deleted')`，`payload` 含操作人与删除前快照；
6. 释放 `resource_placements` 占用的 `gpu_indices`（卡位归还节点）。
7. **不物理 DELETE**：子表随外键 `ON DELETE CASCADE` 仅在前述硬删场景生效；软删保留审计。

#### 12.11.2 项目（真实 CRUD）

```
GET    /api/projects                     -> [{ id, name, slug, isDefault, resourceCount }]
POST   /api/projects  { name, slug? }    -> 201 { id, name, slug, isDefault:false }
PATCH  /api/projects/:id { name?, defaultRegion?, labels? }
DELETE /api/projects/:id                 -> 204 | 409 PROJECT_HAS_RESOURCES { resourceCount }
GET    /api/projects/:id/summary         # v0.7：项目卡片/详情聚合（PRD §3.5.1）
```

- **默认项目**：org 创建时生成 `slug='default'` 的项目，`isDefault=true`，**不可删除**（返回 409）。
- 删除前必须满足 `resourceCount === 0`（仅统计 `deleted_at IS NULL` 的资源）。
- 部署向导内新建项目即调用 `POST /api/projects`，成功后入 `deployment_orders.project_id`。
- **`/summary` 返回契约**：`{ projectUuid, name, slug, defaultRegion, myRole, members:[{userId,name,role}], quotas:[{region,metric,limitValue,usedValue}], resources:{ gpu_vm:running/total, gpu_baremetal:…, vgpu:…, inference:… }, gpuTotal, monthCost, costTrend7d:[{date,amount}] }`；运营·项目页卡片与详情页消费同一接口。账号菜单不读取项目列表或项目摘要（PRD §3.1、§3.5）。

#### 12.11.5 工作台与弹性伸缩

```
# Notebook / IDE（PRD §4.5.1：可挂靠 gpu_vm / gpu_baremetal / vgpu）
GET    /api/workbench/notebooks?region&resource_kind&status
POST   /api/workbench/notebooks  { resourceUuid, ide: 'jupyter'|'vscode', imageRef,
                                   storageGb?, autoShutdownIdleMin? }
                                 -> 201 { id, resourceUuid, urlPath, status }
DELETE /api/workbench/notebooks/:id      -> 204   （不删除宿主资源）

# 弹性策略（PRD §4.2.6 / §4.5.2；向导下单与工作台新建同模型）
GET    /api/scaling/policies?region&strategy_model&status
POST   /api/scaling/policies  { resourceUuid, strategyModel, triggerMetric, targetValue?,
                                minSize, maxSize, scaleToZero?, drainTimeoutS,
                                fallbackEnabled, cooldownS }
PATCH  /api/scaling/policies/:id { minSize?, maxSize?, triggerMetric?, targetValue?,
                                   status: 'active'|'paused' }   # 暂停/恢复/编辑
DELETE /api/scaling/policies/:id   -> 204 | 409 POLICY_BOUND_RESOURCE_RUNNING
GET    /api/scaling/events?resource_id&direction&from&to   # 时间线（B 档 Drawer）
```

- **策略唯一性**：一个资源同时最多一条生效策略（`UNIQUE(resource_id) WHERE status='active'`）；换模型（`node_pool` ↔ `replica`）须先解绑再新建。
- **409 `POLICY_BOUND_RESOURCE_RUNNING`**：资源 `status='running'` 时禁止解绑/换模型，前端引导先停止资源（错误处理同 §12.11.1 六类码模式）。
- **下单即生成策略**：向导 `requested_spec.scaling` 非空时，订单映射为资源后同事务写 `scaling_policies(status='active')`，资源详情「弹性」Tab与工作台策略列表读同一行（单一写入口在工作台，PRD §4.5.2）。
- **配额预检按 `max_size`**：`POST /api/deployment-orders` 既有预检（§12.11）增加 scaling 档位——弹到上限不得超配额。

#### 12.11.3 区域感知查询（G9 落地）

| 接口                                         | 必传参数         | 后端义务                                                                             |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------- |
| `GET /api/resources`                       | `kind`,`region`,`project_id?`,`status?`,`q?`,`page`,`size`,`sort` | 按 `region` 精确过滤（**不得忽略**）；默认附加 `deleted_at IS NULL`；返回 `X-Total-Count`；`includeDeleted` 参数为 true 时才含已释放 |
| `GET /api/node-pools`                      | `region`     | 仅供部署向导读取可选规格、区域可售量与价格；不得返回平台总容量或节点健康明细；不用于租户配额页 |
| `GET /api/billing/summary`                 | `billing_period`,`region?` | 成本 MTD 按 region 聚合，**无 region 时按全部区域求和（前端须明示）**                                  |
| `GET /api/metrics/:kind/:uuid`             | `window`,`metrics` | **种子含 region**：`mulberry32(seed ⊕ region ⊕ uuid)`，切区域基线必变（MOCK-DATA §1 G9）       |

#### 12.11.3.1 数据模块接口（PRD §4.6）

| 接口 | 方法 | 必传参数 | 后端义务 |
| --- | --- | --- | --- |
| `/api/datasets` | GET / POST | `q?`,`format?`,`sort?` | 列表按 `org_id` 隔离，返回 `latest_version` / `size_gb` / `format_tag` / `ref_count` |
| `/api/datasets/:id` | GET / PATCH / DELETE | — | 详情含版本列表与引用关系；**删除前检查 `dataset_references`，被引用返回 409 DATASET_IN_USE { references[] }** |
| `/api/datasets/:id/versions` | GET / POST | `version`,`size_gb` | 版本化写入 `dataset_versions`，同步更新 `datasets.latest_version` |
| `/api/buckets` | GET / POST | `region` | 桶列表按 `org_id` + `region` 过滤；创建时校验区域合法 |
| `/api/buckets/:id/overview` | GET | — | 返回对象数、已用容量、配额、近 7 日请求数（聚合值，不返回明细） |
| `/api/buckets/:id/objects` | GET | `prefix`,`page`,`size` | 前缀导航：按 `key` 前缀过滤，返回子前缀与对象；**前缀与对象分两组返回** |
| `/api/buckets/:id/objects` | POST / DELETE | `key` | 上传 / 删除对象；返回 `etag` 与签名 URL（有效期可选） |
| `/api/buckets/:id/lifecycle` | GET / PUT | `prefix`,`action`,`after_days` | 生命周期规则 CRUD；返回下次执行时间 |
| `/api/pipelines` | GET / POST | `q?` | 列表返回节点数、最近运行状态与时间、平均耗时 |
| `/api/pipelines/:id` | GET / PATCH / DELETE | — | 详情返回 `dag_json`（画布渲染源） |
| `/api/pipelines/:id/runs` | GET / POST | `page`,`size` | 运行历史；POST 触发一次运行 |
| `/api/pipeline-runs/:runId/nodes` | GET | — | 节点级明细：输入/输出/参数/日志/产物 |

> **数据模块口径**：数据集与流水线为**组织级**（不随区域切换），对象存储桶为**区域级**；三者的列表与详情均不得出现平台内部节点信息（PRD §4.6.4）。

#### 12.11.4 四类资源详情返回体（每类独立 schema，禁止大一统）

```
GET /api/resources/:uuid
公共段: { resourceUuid, displayId, name, kind, status, region, nodePool,
         createdAt, runningSince, stoppedAt,
         owner:{ id,name }, project:{ id,name,slug },
         order:{ orderUuid, priceSnapshot, sourceType, sourceRef },
         cost:{ perHour, today, month, remainingHours, currency, unit },
         placement:{ rackId, switchGroup, nodes[] } }

专用段（按 kind 二选一，Zod discriminatedUnion）:
  gpu_vm       -> { spec:{ gpuModel, gpuCount, vcpu, memoryGb, storageGb, imageRef },
                     images:{ name, tag, framework, cudaVersion },
                     access:{ privateIp, publicIp, sshEnabled, jupyterUrl, terminalUrl },
                     security:{ vpcId, subnetId, securityGroups[], keyName } }
  gpu_baremetal-> { spec:{ machineType, machineCount(台), gpuCount(整机总卡), passthrough,
                           migPartition?, cpuModel, memoryGb, localNvmeGb, raidLevel },
                     physical:{ rackId, nodeUids[], ibEnabled, bmc:{ ip, firmware, reachable } },
                     firmware:{ vbios, driverVersion, cudaVersion, compliance } }
  vgpu         -> { spec:{ k8sVersion, controlPlaneTier, nodePools:[{ poolCode, nodeCount,
                           gpuPerNode, slicingPolicy, migProfile?, timeSliceShare?,
                           scaling?:{ strategyModel:'node_pool', minNodes, maxNodes, triggerMetric } }] },
                     access:{ apiServerEndpoint, kubeconfigUrl, apiServerPublic },
                     storage:{ storageClass, defaultPvcGb } }
  inference    -> { spec:{ modelRef:{ slug,name,paramSize,quantization,license },
                           replicas, gpuPerReplica, engine, port, maxModelLen,
                           scaling?:{ strategyModel:'replica', minReplicas, maxReplicas,
                                      triggerMetric, targetValue?, drainTimeoutS, scaleToZero } },
                           canary?{ percent } },
                     access:{ endpointUrl, authEnabled, apiKeyShownOnce },
                     runtime:{ maxBatchSize, prefixCaching, chunkedPrefill } }
```

> `scaling` 是弹性配置的唯一 JSON 键；不得使用 `autoscale` 或 `hpa` 别名。`strategy_model` 区分节点池策略与服务副本策略（§12.6、PRD §4.2.6）。

- **时序指标不得混入业务接口**：监控数据一律走 `GET /api/metrics/:kind/:uuid`（§12.8）。
- 计费三表另有三接口（PRD §7.8）：`GET /api/billing/usage`、`/api/billing/transactions`、`/api/billing/rates`。
- **字段可空性**：上表中 `?` 标记字段为可选，前端一律 `?.` 读取并缺省"—"（PRD §13.3 空指针约束）。

- **总览分布**：`GET /api/overview` 返回 `distribution:[{region,kind,gpuCount,unitCount,nodeCount}]`，含四区域 × 四类型共 16 格。`unitCount` 分别按 VM quantity、裸金属 machineCount、vGPU 集群数、推理 replicas 统计，不混合求和；`nodeCount` 用于 vGPU 节点数。取消独立 `regions` 数据块。
- **配额内存**：API `metric='memory'` 对应 DDL `memory_gb`，另有 gpu/vcpu/storage/ip，共四区域 × 五项。VM 内存为 `memoryGb×quantity`；裸金属为 `memoryGb×machineCount`；vGPU 按各池 `memorySystemGb×nodeCount` 累加；推理按所分配 GPU 对应的主机内存份额计算。内存随停止/释放归零，下单与伸缩预检按 max 档检查。云存储与本地 NVMe 不是主机内存，分开计量。
- **裸金属逐台信息**：`GET /api/resources/:uuid/machines` 返回 `machineCount` 行，含 `index,nodeUuid,name,hostname,status,gpuModel,gpuCount,cpuModel,vcpu,memoryGb,localNvmeGb,privateIp,bmcIp,rack,network`；稳定设备 ID 与 placement.nodes 对齐。硬件 `GET /api/metrics/gpu_baremetal/:uuid/hardware?node=N` 及设备监控 `GET /api/metrics/gpu_baremetal/:uuid?node=N` 验证索引，越界返回 422。已释放设备可只读查询历史配置。

#### 12.11.5 推理服务治理接口（PRD §4.3.4）

- `GET /api/resources/:uuid/governance`：返回 `endpoint`、`modelRef`、`modelName`、`authEnabled`、`active`、`versions[]`、`canaryPercent`、`qpsLimit`、`timeoutMs` 与只读 `scalingPolicy`。不返回 API Key。停止或已释放资源可读取历史配置，`active=false`。
- `POST /api/resources/:uuid/governance`：原子保存 `{ canaryPercent, qpsLimit, timeoutMs }`。仅 owner/admin/member 可修改运行中的推理服务；其他资源类型返回 404，停止态返回 409 INVALID_STATE，已释放返回 410 GONE，只读角色返回 403 FORBIDDEN。
- `canaryPercent` 为 0–99 的整数；稳定版本流量为 `100-canaryPercent`。`qpsLimit` 为 1–100000 的整数，默认 100 req/s；`timeoutMs` 为 1000–300000 的整数，默认 30000 ms。字段不合法返回 422 VALIDATION_ERROR，所有字段校验成功后才写入。
- 流量比例持久化到 `spec.canaryPercent`；网关配置持久化到可选 `spec.gateway={qpsLimit,timeoutMs}`，旧资源缺省值由接口提供。保存记录 `GOVERNANCE_UPDATED` 事件，含变更前后配置和灰度比例。兼容的 `POST /api/resources/:uuid/traffic {percent}` 使用相同的比例校验、角色与状态限制。
- 编辑使用 Modal，先核对变更摘要再提交；取消不发写请求。保存失效相关查询缓存。副本数、GPU 分配、计费方式与伸缩策略不由本接口修改；伸缩的唯一写入口仍为工作台（PRD §4.5.2）。

### 12.12 弹性伸缩数据模型

> 对应 PRD §4.2.6 / §4.5.2。策略是资源的运行时治理配置，**不落时序库**；伸缩过程的指标快照随事件存档（§12.8 边界不变）。

```sql
CREATE TYPE strategy_model    AS ENUM ('node_pool','replica');
CREATE TYPE scaling_trigger   AS ENUM ('queue_depth','pending_pods','qpm','gpu_allocation_rate','concurrency','ttft_p99','kv_cache_usage','requests_waiting');
CREATE TYPE scaling_status    AS ENUM ('active','paused','cooldown');
CREATE TYPE scaling_direction AS ENUM ('scale_out','scale_in');

-- 弹性伸缩策略（一个资源最多一条生效策略）
CREATE TABLE scaling_policies (
  id               BIGSERIAL PRIMARY KEY,
  policy_uuid      UUID            NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  org_id           BIGINT          NOT NULL REFERENCES orgs(id),
  resource_id      BIGINT          NOT NULL REFERENCES resources(id),
  strategy_model   strategy_model  NOT NULL,
  trigger_metric   scaling_trigger NOT NULL,
  target_value     NUMERIC(10,2),                  -- 触发目标值（如 ttft_p99 ≤ 800ms）
  min_size         INTEGER         NOT NULL CHECK (min_size >= 0),
  max_size         INTEGER         NOT NULL CHECK (max_size >= min_size),
  scale_to_zero    BOOLEAN         NOT NULL DEFAULT false,   -- 仅 replica 模型允许 true
  drain_timeout_s  INTEGER         NOT NULL DEFAULT 300,     -- 优雅下线时长
  fallback_enabled BOOLEAN         NOT NULL DEFAULT true,    -- 库存不足回退同型邻近池
  cooldown_s       INTEGER         NOT NULL DEFAULT 600,     -- stabilization 防抖窗口
  status           scaling_status  NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT scaling_scale_to_zero_replica CHECK (NOT scale_to_zero OR strategy_model = 'replica')
);
CREATE UNIQUE INDEX idx_scaling_active ON scaling_policies(resource_id) WHERE status = 'active';
-- GPU 云服务器与裸金属的 min_size 必须 >= 1；vGPU 零规模语义待 PRD 明确前不得提供。
-- 推理服务仅允许在显式开启 scale_to_zero 并二次确认后令 min_size = 0。
-- 按 resource.kind 的最小值约束由应用层/触发器校验（PRD §4.2.6.2）。

-- 伸缩事件（策略执行审计，携带触发时指标快照）
CREATE TABLE scaling_events (
  id               BIGSERIAL PRIMARY KEY,
  event_uuid       UUID            NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  policy_id        BIGINT          NOT NULL REFERENCES scaling_policies(id),
  resource_id      BIGINT          NOT NULL REFERENCES resources(id),
  direction        scaling_direction NOT NULL,
  from_size        INTEGER         NOT NULL,
  to_size          INTEGER         NOT NULL,
  trigger_snapshot JSONB           NOT NULL,   -- { metric, value, target, windowS }
  warm_pool_hit    BOOLEAN,                    -- 是否命中 warm pool
  duration_s       INTEGER,                    -- 本次伸缩实际耗时（形态区分，见下）
  reason           TEXT,                       -- 失败原因 / 人工干预说明
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_scaling_events_policy ON scaling_events(policy_id, created_at DESC);
```

- **Mock 约束（MOCK-DATA §9.4）**：`duration_s` 按形态区分（裸金属 300–1800s、云服务器 60–300s、vGPU 30–120s、推理 warm pool ≤5s / 冷启动 30–720s）；事件必须"带度量"（§9.2）；`trigger_snapshot` 与 `/api/metrics/*` 同窗口数值一致（G9 区域指纹）。
- **与计费联动（PRD §7.4）**：扩容产生新 `billing_usage` 行（按新 `quantity`），缩容停止计量；缩到 0 的推理服务保留存储计量。
- **与配额联动（PRD §4.2.6.3）**：下单预检与工作台改 `max_size` 时按 max 档校验 `quotas`，超限 `409 QUOTA_EXCEEDED`。

---

## 13. 实体追溯链路与工作项关联（评审新增）
> 回答"实体能否关联到具体工作项/任务、链路与字段是否可落地"。

### 13.1 主链路（单一可追溯闭环）

```
plans/orgs/users/projects                      身份与计费主体
   └─ deployment_orders  【工作项：status 即任务状态】
        ├─ source_type + source_ref_id ──► images / models / app_templates / notebooks   （来源追溯）
        └─ resources.order_id           ──► resources 【资源实例】
              ├─ resource_provisioning_steps  【子任务：step_key + state + 时间】
              ├─ resource_placements ─────► gpu_nodes ─► node_pools                    （供给落位）
              ├─ resource_events            【事件时间线 / 审计】
              └─ billing_usage ─► billing_transactions ─► orgs.credit_balance           （成本/扣费）
                    └─ billing_period ─► invoices ─► voucher_redemptions ─► vouchers   （账单/优惠）
```

### 13.2 UI → 表 → 关键字段 对照表

| UI 模块/要素                 | 主要表                                                    | 关联字段                                                |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| 部署向导 / 下单               | `deployment_orders`                                    | `order_uuid`, `resource_kind`, `source_type/ref_id` |
| Provisioning 进度条（PRD §5.3） | `resource_provisioning_steps`                          | `resource_id`, `step_key`, `state`                  |
| 资源列表（四类各自）               | `resources`（+`placements`）                              | `kind`, `region`, `project_id`, `status`, `deleted_at IS NULL` |
| **详情页：公共段**（PRD §4.3.0）   | `resources` → `projects`/`users`/`deployment_orders`/`resource_placements` | `resource_uuid`, `display_id`, `spec_json`, `running_since` |
| **详情页：规格/机型/集群/模型段**      | `resources.spec_json`（§12.11.4 按 kind 分支）              | `kind` 决定 schema                                    |
| **详情页：控制台（云服务器）**         | `resources` + `notebooks`                              | `resource_id`, `url_path`                           |
| **详情页：硬件健康（裸金属）**         | `gpu_nodes` + 指标 `/api/metrics/*`（不落 PG）                | `node_uid`, ECC/Xid/PSU/NVMe 指标                      |
| **详情页：控制面·节点池·工作负载（vGPU）** | `resources` → `resource_placements` → `gpu_nodes`       | `node_count`, `slicing_policy`, Pod phase            |
| **详情 Drawer：副本与端点（推理）**         | `resources.spec_json` + 指标 `/api/metrics/*`             | `replicas`, `scaling`, `endpointUrl`                    |
| **详情页：计费 Tab（PRD §7.8）**   | `billing_usage` + `billing_transactions` + `billing_rates` | `usage_hour`, `unit`, `quantity`, `amount`, `balance_after` |
| **Drawer 快速预览（PRD §3.4）**  | 同对应实体的公共段子集                                            | `?drawer=<id>` URL 同步                                |
| **项目（PRD §3.5 / §3.5.1）**          | `projects`（+`project_members`）                         | `org_id`, `slug`, `isDefault`, `default_region`       |
| **运营·项目页卡片/详情**       | `projects` → 聚合（`resources`/`billing_usage`/`quotas`）     | `project_id`, `billing_period`, `metric`            |
| **工作台·Notebook / IDE**     | `notebooks` → `resources`                              | `resource_id`, `resource_kind`, `url_path`, `ide`    |
| **工作台·弹性伸缩 / 资源 Drawer 弹性 Tab** | `scaling_policies` → `scaling_events`                  | `resource_id`, `strategy_model`, `trigger_metric`, `direction` |
| **删除（PRD §5.4.1）**        | `resources.deleted_at` + `quotas` + `billing_usage`      | `confirm`, 六类错误码（§12.11.1）                           |
| 详情页事件时间线                 | `resource_events`                                      | `resource_id`, `created_at DESC`                    |
| 来源（镜像/模型/模板）             | `images`/`models`/`app_templates`  ← orders            | `orders.source_type` + `source_ref_id`              |
| 拓扑视图（**vGPU 详情内嵌**）       | `resource_placements` → `gpu_nodes` → `node_pools`     | `node_id`, `rack_id`, `gpu_indices`                 |
| **总览·关键指标条 / 区域与类型矩阵**   | 当前用户可见资源 → `Σ gpu_count`（按 `region`，`deleted_at IS NULL`） | **四区域已分配 GPU 总卡数合计 = 1040**；不使用 `quotas.used_value` 或平台节点池容量（MOCK-DATA §1 G11） |
| 顶部状态栏（服务状态/余额/花费/运行中）      | 服务事件聚合、`orgs`, `billing_usage`, `resources`      | 语义化服务状态、`credit_balance`、`billing_period`；不展示健康百分比或节点明细 |
| 成本分析（按项目/资源/区域）          | `billing_usage` → `projects`/`resources`               | `project_id`, `resource_id`, `region`               |
| 配额水位                    | `quotas`                                               | `metric`, `limit_value`, `used_value`               |
| 费用中心（我的账单 / 代金券）     | `billing_usage`, `billing_transactions`, `invoices`, `vouchers` | `billing_period`, `amount`, `status`, `balance`, `end_at` |
| 工单                      | `tickets`                                               | `resource_id`（可关联到出问题的资源）                            |
| 通知中心                    | `notifications`                                        | `org_id`, `user_id`, `read_at`                      |

### 13.3 幂等与一致性要点

| 场景           | 机制                                                            |
| ------------ | ------------------------------------------------------------- |
| 重复计量/重复扣费    | `billing_usage UNIQUE (resource_id, usage_hour, unit)`        |
| 订单重试         | 复用同一 `order_uuid`，不新建 resource（避免孤儿实例）                         |
| 余额漂移         | `billing_transactions.balance_after` 与 `orgs.credit_balance` 同事务写入 |
| 配额不准         | `quotas.used_value` 仅由重算任务更新（派生值）                              |
| 软删与清算        | `resources.deleted_at` 非空即释放配额并停止计量                            |
| 删除误操作        | 前端键入 `display_id` 确认 + 后端 `confirm` 二次校验（`422 CONFIRM_MISMATCH`）  |
| 删除依赖         | `423 HAS_DEPENDENCIES` 阻止删除，列出依赖后允许逐个处理                       |
| 项目被误删        | `is_default` 项目禁止删除；有未释放资源的项目返回 `409 PROJECT_HAS_RESOURCES`    |
| 区域过滤被忽略      | C10 约束 + 接口层强制 `region` 参数（缺省时须显式返回全部区域并在响应标注 `regionScope`） |

---

## 14. 安全（前端侧）

- 鉴权态存内存 + 短期 token（不落 localStorage 长期密钥）。
- 密钥/凭证不在前端明文展示，危险操作二次确认。
- 所有外部跳转与用户内容做防注入/转义（React 默认转义 + 富文本白名单）。
- RBAC 仅用于体验优化，**真实鉴权与授权以后端为准**。
- `VITE_*` 仅含非敏感配置；任何私有凭证不得进入前端构建产物。
- **命令面板不绕过 RBAC**：⌘K 的导航组复用 `navModel` 的过滤结果（§5），面板不构成越权入口。

---

## 15. 测试与质量保障体系（强制）

> 测试与 CI 必须验证计价公式、派生数据、i18n 一致性、弹性策略契约与架构边界，避免设计约束只依赖人工检查。

### 15.1 测试栈与命令

| 项 | 值 |
| --- | --- |
| 框架 | **Vitest 3**（复用 Vite 的 TS / 别名 / ESM 解析，零额外配置） |
| 环境 | `environment: 'node'`（当前只测纯逻辑与种子契约，不涉及 DOM；后续如需组件测试再引入 jsdom + Testing Library） |
| 配置 | `vitest.config.ts`（`setupFiles: src/test/setup.ts`，`include: src/**/*.test.ts`） |
| 命令 | `pnpm test`（`vitest run`）/ `pnpm test:watch` |
| 落位 | **就近同置**：`src/lib/money.test.ts`、`src/mocks/fixtures/scaling.test.ts`…；跨文件守护放 `src/test/` |

### 15.2 测试分层与断言口径

| 层 | 文件 | 断言要点 |
| --- | --- | --- |
| **基础工具** | `lib/money.test.ts`、`lib/ids.test.ts`、`lib/date.test.ts` | USD 格式化与千分位、精度边界（0 / 负 / 大数）；`display_id` 前缀与资源类型一一对应；相对时间与 `formatDuration` 跨月/超 24h |
| **派生引擎** | `mocks/lib/derive.test.ts` | 训练吞吐 `6N`（无重计算）与 `8N`（重计算）比值 0.75；节点数线性放大；decode 带宽上界随 TP 线性、bf16 为 fp8 的一半；**`stopped` 态不产生算力费用**（PRD §7.4）；存储月费独立计 |
| **种子契约** | `mocks/fixtures/scaling.test.ts` | 11 策略 / 118 事件：方向数值自洽（扩后 > 扩前、缩后 < 缩前且不越界）、快照带度量、耗时按形态分档、末值 = 资源实际规格、含人工干预与库存回退样本 |
| **i18n 契约** | `i18n/i18n.test.ts` | **中英键集合严格相等**；同一键的 `{v0}`…占位符数量与名称一致；无空串、无非标准占位符（如 `{data.x}`） |
| **架构守护** | `test/architecture.test.ts` | 见 §15.3 |

### 15.3 架构守护（防止约定悄悄腐化）

以源码文本扫描为断言，全线静态、无运行时开销：

1. **UI 层禁止直连 Mock fixtures**：`src/features/**`、`src/components/**`、`src/app/**` 对 `mocks/fixtures` 的 import 数必须为 **0**。
   依据 §12.8 边界声明——`VITE_ENABLE_MOCK=false` 时派生责任移交后端，UI 层不得依赖种子常量。常量与参考数据一律走 `/api/*` 下发。
2. **无半成品标记**：`src` 内无 `TODO` / `FIXME` / `XXX`。
3. **不压制类型错误**：无 `@ts-ignore` / `@ts-expect-error`。
4. **无静默豁免**：无 `eslint-disable` / `stylelint-disable`。

> 说明：第 2–4 条允许在测试自身文件与 `.test.ts` 中出现被检测关键字（否则测试无法写），扫描时排除 `*.test.ts`。

### 15.4 CI 门禁

见 §11.1：`typecheck → test → build` 三段串行，任一失败即红。本地提交前建议按同序执行一遍。

### 15.5 已由测试捕获并修复的真实缺陷（留存价值）

- `sb.runningTotal` 英文版缺少 `{v0}` 占位符 → 补齐，并由 i18n 契约测试守护（PRD §10.1）。
- 伸缩事件反向生成时出现"扩容后规模反而变小"的越界样本 → 生成器中翻转方向并 clamp 到 `[min, max]`，末值强制等于资源实际规格。
- 生产包静态打入 MSW 与全部 fixture → 改动态导入 + `manualChunks`（§11.2）。
