# GB300 NVL72 裸金属创建与 10 月 1 日起计费（证据记录）

## 1. 结果
| 项目 | 值 |
| --- | --- |
| 实例数 | 4 台 |
| 机型 / 节点池 | `GB300_NVL72`（每台 72× GB300，Grace CPU，17 TB 内存，61 TB 本地 NVMe） |
| 区域 / 项目 | `us` / `production` |
| displayId | `gbm-857197e8d6264115`、`gbm-9413d0cbfae043d0`、`gbm-d1370b3be6a340d3`、`gbm-ec1240a93a54469a` |
| 创建时间 | `2026-10-01T00:00:00.000Z`（provisioning） |
| 运行开始 | `2026-10-01T00:03:00.000Z`（running） |
| 计费起始 | `2026-10-01T00:00:00+00`（按小时逐段计量，无缺口） |
| 计费口径 | `per_machine_hour` 791.28 USD/台·时 + `per_gb_hour` 0.00012328767×100 GB，来自订单 price_snapshot |
| 用量行数 | 每台 1144 行（572 个小时 × 计算+存储两个计费项） |
| 用量金额 | 每台约 452,509.60 USD，四台合计约 1,810,038.4 USD |

创建走的是真实 API 流程（`POST /api/deployment-orders`），不是直接插入数据库。

## 2. 一次性历史回填
`scripts/backfill-gb300-oct-1.sql`（幂等，advisory lock 728154093）：
1. 清除创建后最初几分钟的实时计量；
2. 把 4 台资源的 `createdAt/provisioningSince/runningSince` 前移到 2026-10-01；
3. 按 price_snapshot 逐小时补 2026-10-01 00:00 → 最近整点的 `billing_usage`；
4. 重置 `billingCursors` 到当前整点，避免重复计费；
5. 写入 provisioning/ready 两条生命周期事件（actor `enzoOvOyu`）。

## 3. 记账修正（我引入的错误及其修复）
首次回填时插入了一条虚构的 `oct01-gb300-prepaid` credit（1,803,988.1856），
把 GB300 的真实费用全额抵消 —— 等于没有计费，与"计费从 10 月 1 日开始"相悖。
`scripts/fix-gb300-billing.sql` 删除该 credit，并按
`贷方合计 − 实际用量合计` 重算账户余额，同时修正 4 条 charge 的 `balanceAfter`。

修正后：余额 `120,238.1906`，账本 `1,079,451.2030`，实际用量 `2,872,901.4530`。

## 4. 遗留缺陷（先于本次任务存在，未修复，仅记录）
`src/mocks/handlers/index.ts` 的 `recordCharge` 按 `referenceId` 合并流水，
且 `db.transactions` 超过 5000 条时从头部截断。后果：
- `billing_transactions` 的 charge 合计（1,917,135.4803）小于
  `billing_usage` 的用量合计（2,872,901.4530），差额 951,652.6560；
- 账户余额是按实时用量逐次扣减的，因此余额本身正确，但账本可追溯性受损。

证据：`billing_transactions` charge 342 条 vs `billing_usage` 22,486 条。
这是既有设计缺陷，修复需要改变流水合并/截断策略，属于独立改动，未在本任务内实施。

## 5. 验证
- `pnpm typecheck`：通过
- `pnpm test`：150/150 通过
- `pnpm build`：通过
- API：`GET /api/resources?kind=gpu_baremetal&region=us&project=production` 返回 4 台 GB300
- UI：`/resources/baremetal?region=us&project=production` 渲染 6 行（含 4 台 GB300），无页面错误
- 计费：`GET /api/billing/report?period=2026-10` 中 4 台机器的 usage 首个小时均为
  `2026-10-01T00:00:00.000Z`
