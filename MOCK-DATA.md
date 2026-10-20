# Mock 数据约束规范（MOCK-DATA）

> 配套文档：`PRD.md`（产品需求） · `ARCHITECTURE.md`（架构说明） · `DESIGN-SYSTEM.md`（UI 规范）
> 版本：**v1.5 · 2026-10-20** · 适用：RunSun GPU Cloud 控制台当前设计基线
> 本规范是 Mock 数据量级、单位、硬件参数、派生公式、状态与事件一致性的权威来源；用户可见行为以 `PRD.md` 为准。

---

## 0. 本规范的目的与强制等级

前端原型的数据**全部来自 Mock 层**（PRD §1、ARCH §6）。若 Mock 数据失真，会导致：

1. **评审失真**：图表、告警、阈值、计费在原型阶段无法验证，联调时才发现 UI 不能承载真实量级；
2. **设计返工**：真实 GPU 利用率曲线、延迟长尾、日志噪音形态与"拍脑袋数字"完全不同，组件布局需重做；
3. **可信度损失**：GPU 用户（ML 工程师 / 平台运维）对数值极其敏感，`利用率 100%`、`延迟 0ms`、`显存 200/80GB` 这类数据会直接摧毁产品专业形象。

因此本文件规定：**所有 Mock 数据必须"物理可解释、单位正确、量级公认、状态自洽、可由公式派生"**。

**强制等级定义**

| 等级 | 含义 | 违反后果 |
| --- | --- | --- |
| **MUST** | 必须满足，验收硬性拦截 | 文档/原型不予通过 |
| **SHOULD** | 强烈建议，除非有书面理由 | 需在设计评审说明偏差 |
| **MAY** | 可选增强 | 无 |

---

## 1. 通用约束原则

### G1 真实量级（MUST）
所有数值必须落在**真实公有云 / 真实 GPU 硬件**的公认范围内。本文件 §3–§6 给出的每张区间表是**唯一口径来源**，禁止自行发明。

### G2 派生优先于杜撰（MUST）
凡是能由公式算出的量，**不允许硬编码常量**。必须走 §7 派生公式引擎。例：

- ❌ `{ tokensPerSecond: 86400 }`
- ✅ `deriveTokensPerSecond({ mfu, gpuCount, peakDenseFlops, params, recompute })`

派生可以保证：改 MFU 时吞吐量、goodput、费用、配额同步变化，不会出现"数字互不认识"的割裂。

### G3 单位与精度统一（MUST）

| 量 | 单位 | 小数位 | 示例 |
| --- | --- | --- | --- |
| 利用率 / 占用率 | `%` | 1 | `78.4` |
| 显存 | `GB`（展示）/ `MiB`（接口） | 1 / 0 | `124.5 GB` |
| 显存带宽 | `GB/s` | 0 | `3350` |
| 网络吞吐 | `Gb/s`（链路）/ `MB/s`（实例网卡） | 0 / 1 | `400 Gb/s` |
| 功耗 | `W`（卡）/ `kW`（机柜·节点） | 0 / 1 | `658 W`、`14.3 kW` |
| 温度 | `°C` | 0 | `72` |
| 延迟 | `ms`（< 1s）/ `s`（≥ 1s） | 0 / 2 | `412 ms`、`2.41 s` |
| 吞吐 | `tokens/s` | 0 | `18420` |
| 单价 | `$/GPU·h` | 2 | `3.49` |
| 金额 | `$` | 2 | `1284.36` |
| 时间戳 | ISO 8601 UTC，`Z` 结尾 | — | `2026-10-17T06:12:44Z` |

> **禁止伪精度**：不得出现 `78.4213%`、`$3.4900001`。金额不做浮点累加展示，一律在派生后 `round(2)`。

### G4 状态自洽（MUST）
数据与资源生命周期状态（PRD §5.4、ARCH §9）必须一致：

| 资源状态 | GPU 利用率 | 显存 | 功耗 | 网络 | 计费 |
| --- | --- | --- | --- | --- | --- |
| `provisioning` | **无指标**（展示"采集中"，禁止显示 0 或随机数） | 无 | 无 | 无 | 不计 |
| `running` | 有，且符合该工作负载形态 | 有 | ≥ idle 功耗 | 有 | 算力+存储 |
| `stopped` | **无**（非 0） | 无 | 无 | 无 | 仅存储 |
| `error` | 最后已知值冻结 + 故障原因 | 冻结 | 冻结/未知 | 冻结 | 仅存储 |
| `terminating` | 逐步归零或直接下线 | — | — | — | 秒级结算 |

### G5 确定性可复现（MUST）
- 所有 fixture 由**固定种子**的伪随机数生成器（推荐 `seedrandom` 或自实现 mulberry32）产出，`MOCK_SEED` 见 ARCH §12.7。
- 同一 `resourceUuid` 在同一时刻多次刷新，必须得到**同一条时间序列**（禁止 `Math.random()` 直接用于初始值）。
- 实时追加点（`VITE_WS_URL`）允许随机游走，但**必须围绕种子基线**，且遵守 §8 噪声模型。

### G9 区域维度真实切换（MUST）

区域过滤只适用于具有区域维度的资源、供给目录、计费和监控数据；组织级实体不得被伪装成区域数据。总览必须同屏汇总四个区域，不受当前区域筛选影响（PRD §3.3、§4.1）。

- 区域维度数据必须带 `region`：资源、可售节点池目录、`billing_usage` 聚合和监控基线按区域过滤；项目、数据集与流水线等组织级数据不强制增加区域字段。
- **价格**：通过 `region_multiplier`（§4.2）真实作用于 `billing_rates`，不同区域单价不同（已定义，须落地到每条计费记录）。
- **供给/容量**：`poolSupply(region, pool)` 按 §5.4 区域×节点池矩阵给出不同可用量（如 `GB300_NVL72` 仅 `us` 有货）。
- **指标基线**：时序生成器必须以 `region` 参与种子（`mulberry32(seed + region + uuid)`），使同一资源在不同区域的曲线基线不同；禁止"切区域曲线不变"。
- **成本/状态栏**：区域页面的 `cost_mtd` 按 `billing_period + region` 聚合；未选择区域时按全部适用区域聚合并标明口径。总览固定展示四区域，不从全局 region 状态过滤（PRD §3.2、§4.1）。
- **红旗**：切换区域后列表/指标/成本数值完全相同 → 视为不合格（命中 G8 同类缺陷）。

### G6 事件必须携带度量上下文（MUST）
详情页「事件时间线」不得出现 `系统更新完成`、`操作成功` 这类无信息量文案。每条事件应满足 §9 的事件契约：**谁 / 何时 / 哪个组件 / 触发了什么度量阈值 / before→after 快照 / 建议动作**。这是"有意义的监控事件"的核心要求。

### G7 不完美即真实（SHOULD）
- 平台内部节点种子应包含 **非 Ready 节点**（占比见 §6.1），以验证内部供给事件与故障派生；该分布不得作为租户总览或节点健康预览展示；
- 监控曲线必须包含**合理噪声与偶发毛刺**，但禁止连续超限（否则会触发未设计的告警分支）；
- 成本曲线禁止完美线性，必须包含启停、扩容、折扣、代金券抵扣等真实形态。

### G8 假数据红旗清单（MUST NOT）
以下内容**命中即视为不合格**：

| 红旗 | 说明 |
| --- | --- |
| 显存占用 > 显存容量 | 物理不可能 |
| `P99 < P50` 或 `P50 < P.min` | 分位数矛盾 |
| GPU 利用率长期恒定（如一直 63.0%） | 无真实工作负载如此 |
| 利用率为 0 但 tokens/s > 0 | 逻辑矛盾 |
| `stopped` 资源展示运行中指标 | 违反 G4 |
| 延迟 = 0 ms 或 错误率 = 0.00% 恒久不变 | 无系统如此 |
| 单价与 §4 价格表不一致 | 违反 G1 |
| 时间戳为未来时间或早于组织创建时间 | 不可能 |
| 工期/供给时长不符合 §5.5（如裸金属 5 秒供给完成） | 违反公认常识 |
| 成本随时间严格线性且整除 | 违反 G7 |

### G10 国际化文案约束（MUST）

> 呼应 PRD §3.1 / ARCH §2：i18n 中英双语落地后，Mock 层必须保证**两种语言下数据自洽、无硬编码泄漏**。

- **UI 文案零硬编码**：组件内禁止出现中文字面量；导航/表头/按钮/空态/Toast 一律 `t('namespace.key')`（字典 `src/i18n/locales/`，键规范见 DESIGN §5.24）。
- **枚举显示名单一来源**：资源类型 / 区域 / 节点池 / 状态 / `strategy_model` / `scaling_trigger` 等枚举的显示名只在字典 `common.*` 段定义一份，fixture 与组件共用；**禁止 fixture 内另存一套英文名**。
- **数据值双语文案**：fixture 中的实体名称（项目名 / 资源名 / 标签 / 事件 reason）以**中文为源**；英译经字典 `data.*` 段按 id 查找输出（如 `t('data.project.1')`），保证 `en-US` 下不出现未翻译中文。
- **缺键回退**：`en-US` 缺失键回退 `zh-CN` 值并在 dev 环境 `console.warn`；**验收时 en-US 下不得出现控制台 warn**（键覆盖率 100%）。
- **格式随 locale**：日期/数字走 `Intl`（随 `stores/locale`），**币种恒 USD 不做换算**（PRD §7.1）；图表轴与 tooltip 同样走字典。
- **切语言不触发重取**：locale 是纯客户端状态，**不得进入 TanStack Query key**（避免切换语言引发接口重取）。

---

### G11 四区域已分配总卡数锚点（MUST）

> 呼应 PRD §4.1 / §9.2：总览页需**不切换区域**即展示全部四区域，且展示「本用户已分配 GPU 总卡数」。

- **锚点值**：当前用户授权资源范围内，四个区域（`jp` / `th` / `sg` / `us`）已分配的 GPU 卡数合计恒为 **1040**。
- **口径**：`Σ resources.gpu_count`，仅过滤 `deleted_at IS NULL` 的当前用户授权资源记录；**不根据 `quotas.used_value`、GPU 配额占用状态或平台容量过滤**。这是已分配资源卡数，不是配额值、配额占用量或可售容量（PRD §4.1、§9.2）。
- **生成约束（MUST）**：
  1. `fixtures/resources.ts` 的种子资源四区域 `gpu_count` 之和 **必须等于 1040**；任一区域的增删必须成对调整，保持总和不变。
  2. **禁止写死**：1040 只能由种子资源真实求和得到（`resources` 派生），不得在组件、fixture 常量或 i18n 文案中出现字面量 `1040` 作为展示值；一致性断言（§8.3）须校验 `Σ gpu_count === 1040`。
  3. **派生一致性**：该总和同时是总览「关键指标条 · 已分配总卡数」与「资源分布」矩阵四区域求和口径的**同一来源**，两处不得各算一套。
  4. **区域矩阵自洽**：分区域卡数之和 = 1040；某区域无资源时按 §6.0/PRD §4.1 空态规则展示，但**不改变总和锚点**。
- **与平台容量区分**：1040 是**本用户已分配**口径，**不是**平台节点池容量（`node_pools` 容量为平台内部数据，不对租户展示，见 PRD §4.4.2）；两者禁止混用同一展示位。

---

## 2. 数据来源与引用规则

| 类别 | 来源 | 在本文件中的位置 |
| --- | --- | --- |
| GPU 硬件规格 | NVIDIA 官方 DGX/HGX 产品页与公开数据表 | §3 |
| 云上单价 | 2026-10 公开 list pricing（RunPod / Lambda / CoreWeave / Nebius / AWS / GCP 观察值） | §4 |
| 推理服务指标 | vLLM / SGLang 暴露的 Prometheus 指标语义 | §6.5 |
| 训练吞吐口径 | MFU / HFU（6ND、含重计算 8ND）业界共识 | §7.2 |
| 节点可靠性 | CoreWeave Mission Control 的 goodput / straggler 定义 | §6.6 |
| K8s GPU 虚拟化 | NVIDIA GPU Operator / MIG / Device Plugin 语义 | §6.4 |

> **口径标注义务（SHOULD）**：fixture 文件中对每张 DERIVED 常量表加注释标注来源与采集日期；若某值与 NVIDIA 多个口径冲突（例如 B200 显存 180/186/192 GB），必须在 §3 注明所采口径，全文统一，不得混用。

---

## 3. GPU 硬件基线（权威规格，唯一口径）

> 本表为**所有 Derived 计算的上游常量**，前端 `mocks/fixtures/gpu-specs.ts` 必须与此逐字一致。

### 3.1 5 类节点池 GPU 规格

| 字段 | `H100_SXM` | `H200_NVL` | `B200_NVL72` | `B300` | `GB300_NVL72` |
| --- | --- | --- | --- | --- | --- |
| 产品名 | H100 SXM5 | H200 SXM | B200（GB200 NVL72 节点） | B300 SXM | GB300 NVL72 机柜 |
| 架构 | Hopper (TSMC 4N) | Hopper (TSMC 4N) | Blackwell (TSMC 4NP) | Blackwell Ultra | Blackwell Ultra |
| GPU/节点 | 8 | 8 | 8（柜 72） | 8 | 72 |
| 显存/GPU | 80 GB HBM3 | 141 GB HBM3e | 192 GB HBM3e | 288 GB HBM3e | 288 GB HBM3e |
| 显存带宽/GPU | 3.35 TB/s | 4.8 TB/s | 8 TB/s | 8 TB/s | 8 TB/s |
| BF16/FP16 dense | 989 TFLOPS | 989 TFLOPS | 2,250 TFLOPS | 2,250 TFLOPS | 2,250 TFLOPS |
| FP8 dense | 1,979 TFLOPS | 1,979 TFLOPS | 4,500 TFLOPS | 4,500 TFLOPS | 4,500 TFLOPS |
| FP4 dense | 不支持 | 不支持 | 9,000 TFLOPS | 13,500 TFLOPS | 13,500 TFLOPS |
| FP64 dense | 34 TFLOPS | 34 TFLOPS | 40 TFLOPS | ~1.4 TFLOPS | ~1.4 TFLOPS |
| NVLink | Gen4 · 900 GB/s（双向/GPU） | Gen4 · 900 GB/s | Gen5 · 1.8 TB/s | Gen5 · 1.8 TB/s | Gen5 · 全域 130 TB/s |
| TDP/GPU | 700 W | 700 W | 1,000 W | 1,400 W | 1,400 W |
| 节点功耗 | ~10.2 kW | ~10.2 kW | ~14.3 kW | ~14.5 kW | ~132 kW/柜 |
| MIG 实例 | 7 × 10 GB | 7 × 20 GB | 7 × 24 GB | 7 × 34 GB | 7 × 34 GB |
| 散热 | 风冷 | 风冷 | 液冷（机柜级） | 液冷 | 液冷（仅限） |

> **口径声明**：B200/B300 的 FP8 dense 取 NVIDIA DGX 口径（DGX B200/B300 FP8 均为 72 PFLOPS sparse / 8 GPU = 9 PFLOPS sparse = **4.5 PFLOPS dense** 每卡）；FP4 dense 取 DGX B200 72 PFLOPS / DGX B300 108 PFLOPS 每 8 卡，即 9 / 13.5 PFLOPS 每卡。全文统一采用此口径，禁止混用其他第三方估算值。
> **`B200_NVL72` 命名说明**：NVIDIA 官方对应产品为 **GB200 NVL72**（Grace CPU + B200 GPU 的 72-GPU 单一 NVLink 域机柜）。本控制台节点池键名沿用 `B200_NVL72`（PRD §9.1），展示名应写 **「B200 NVL72（GB200 机柜）」** 以免误解。

### 3.2 节点 / 服务器配套规格（用于裸金属与云服务器的实例规格派生）

| 池 | CPU | 系统内存 | 本地 NVMe | 节点网络 |
| --- | --- | --- | --- | --- |
| `H100_SXM` | 2 × Xeon Platinum 8480（56C/112T） | 2,048 GB DDR5 | 8 × 3.84 TB | 8 × 400 Gb/s NDR IB（总 400 GB/s） |
| `H200_NVL` | 2 × Xeon Platinum 8568Y+（48C/96T） | 2,048 GB DDR5 | 8 × 3.84 TB | 8 × 400 Gb/s NDR IB |
| `B200_NVL72` | 2 × Xeon Platinum 8570（56C）+ Grace 管理通道 | 2,252 GB DDR5 | 8 × 3.84 TB | 8 × 400 Gb/s NDR IB + Spectrum-X |
| `B300` | 2 × Xeon Platinum 8580（60C） | 2,252 GB DDR5 | 8 × 3.84 TB | 8 × ConnectX-8 800 Gb/s（总 800 GB/s） |
| `GB300_NVL72` | 36 × Grace CPU（72C） | 17 TB LPDDR5X | 柜级 NVMe 层 | NVLink 域 + 800 Gb/s 上联 |

**主机内存配额**：内存不是显存或云盘容量。VM 依据实例 `memoryGb × quantity`；裸金属按每台系统内存 × machineCount；vGPU 按各节点池系统内存 × 节点数；推理按所分配 GPU 对应的主机内存份额计算。H100/H200 每台 8 卡配 2048 GB RAM，B200/B300 每台 8 卡配 2252 GB RAM，几百张卡的节点集群应对应数十至数百 TB 系统内存。停止与释放后主机内存配额归零；云盘/PVC 的 cloud storage 配额独立保留，整机本地 NVMe 不重复计入云盘费用。旧浏览器状态恢复时规范化 VM 磁盘与 vGPU PVC 容量，保留资源和历史账单。

**裸金属设备派生**：集群每台设备使用稳定 UUID/设备名、独立主机名、私网 IP 和 BMC IP；单台内存和 NVMe 按规格提供，集群合计按台数乘算。`/machines` 与 placement.nodes、按 node 索引查询的硬件/BMC 使用同一身份来源；监控的随机种子包含设备索引，切换设备不能复用上一设备的缓存或曲线。

### 3.3 派生余量（must derive）

- **节点总显存** = GPU/节点 × 显存/GPU
  - H100：8 × 80 = **640 GB**（与 DGX H100 官方 640 GB 一致 ✅）
  - H200：8 × 141 = **1,128 GB**（与 AWS p5e 1128 GB 一致 ✅）
  - B200：8 × 192 = **1,536 GB**（与 Lambda 8×B200 1536 GB 一致 ✅）
  - B300：8 × 288 = **2,304 GB**
  - GB300 机柜：72 × 288 = **20,736 GB ≈ 20.7 TB**（官方标称 ~20 TB ✅）
- **节点 peak BF16** = GPU 数 × BF16 dense；**节点 idle 功耗** = GPU 数 × (60–100 W) + CPU/系统基线（约 300–500 W）。

---

## 4. 价格、区域系数与计费参数

### 4.1 按需单价（USD / GPU·小时）

> 口径：2026-10 公开 list pricing 观察区间，取平台自身定价落在区间中低位（新云平台定价策略）。

| 节点池 | 市场观察区间 | 本平台单价 | 备注 |
| --- | --- | --- | --- |
| `H100_SXM` | 2.69 – 6.16 | **3.49** | RunPod 2.89 / Lambda 3.29–3.99 / CoreWeave 6.16 |
| `H200_NVL` | 3.59 – 6.31 | **4.79** | RunPod 4.59 / CoreWeave 6.31 |
| `B200_NVL72` | 6.69 – 8.60 | **7.49** | Lambda 6.69–6.99 / RunPod 6.79–7.99 / CoreWeave 8.60 |
| `B300` | 7.89 – 9.50 | **8.49** | RunPod 7.89–8.99 / Nebius 9.50 |
| `GB300_NVL72` | ~10.50（柜拆算） | **10.99** | CoreWeave 42 $/h per 4-GPU slice = 10.50/GPU·h |

### 4.2 区域系数（Region Multiplier）

| 区域 | 键名 | 系数 | 说明 |
| --- | --- | --- | --- |
| 美国 | `US` | `1.00` | 基准，容量最大 |
| 新加坡 | `SG` | `1.08` | 亚太枢纽，电力与网络溢价 |
| 日本 | `JP` | `1.12` | 电力成本高，合规要求严 |
| 泰国 | `TH` | `0.95` | 新建 Region，推广期让利 |

- **有效单价** = 基准单价 × 区域系数，展示时保留 2 位小数。
- 区域系数必须同时作用于 `billing_rates`（ARCH §12.4），不得只在 UI 里乘一次。

### 4.3 存储与其他单价

| 计费项 | 单位 | 单价 | 口径 |
| --- | --- | --- | --- |
| 块存储（跟随实例） | `$/GB·月` | 0.08 | 停止后仍计（PRD §7.4） |
| 对象存储 | `$/GB·月` | 0.023 | 阶梯计价 v1 不启用 |
| 出网流量 | `$/GB` | 0.05（同区免费 / 跨区 0.03） | 入网免费 |
| 公网 IP | `$/小时` | 0.005 | 停止是否释放见实例策略 |
| vGPU 控制面（托管 K8s） | `$/集群·小时` | 0.10 | Ha 控制面 ×3 时 0.30 |

### 4.4 折扣体系（用于费用 / 资产页真实形态）

| 类型 | 折扣 | 约束 |
| --- | --- | --- |
| Spot / 抢占式 | **−45% ~ −60%** | 可被抢占（evict），列表需展示抢占风险标记与预计回收时间 |
| 1 年预留 | **−30%** | 未开始可全额退，已开始不退预留费（PRD §7.6） |
| 3 年预留 | **−55%** | 同上 |
| 代金券 | 面额抵扣 | 有有效期与适用范围，先到期先用 |

> 金额派生必须体现上述折扣，`cost_per_hour` 不得恒等于 `rate × qty`。

---

## 5. 资源生命周期的 Mock 表现（状态监控的"公认数值"）

### 5.1 状态与预计时长（供给时长必须类型区分）

| 资源类型 | provision 典型时长 | 子阶段 | 失败率 |
| --- | --- | --- | --- |
| GPU 云服务器 | **45 – 95 s** | 配额校验 → 资源预留 → 镜像拉取 → 启动 → 健康检查 | ~3% |
| GPU 裸金属 | **8 – 20 min** | 硬件分配 → RAID 配置 → 固件校验 → OS 灌装 → PXE → 带外纳管 | ~5% |
| vGPU（托管 K8s） | **3 – 7 min** | 控制面创建 → 节点注册 → GPU Operator 部署 → 设备插件就绪 → CNI/CSI | ~4% |
| 推理服务 | **60 s – 12 min** | 副本调度 → 镜像拉取 → **权重加载（与模型体积成正比）** → CUDA graph 捕获 → 预热 → 探活 | ~6% |

- 权重加载时间 **MUST** 按模型体积 × 磁盘读取带宽派生（§7.4），不得写死。
- 失败必须有**具体原因**（常见：容量不足 `InsufficientCapacity`、镜像拉取超时 `ImagePullBackOff`、权重加载 OOM `ModelOOM`、驱动不匹配 `DriverVersionMismatch`）。

### 5.2 Provisioning 进度展示（ARCH §13 的子任务映射）

`resource_provisioning_steps` 每条含 `started_at / finished_at / progress`，UI 进度条**必须由已完成步骤数派生**，不得是独立随机数。

### 5.3 节点状态占比（节点基础设施层，落实 G7"不完美即真实"）

| 节点状态 | 占比区间 | 典型成因（用于事件文案） |
| --- | --- | --- |
| `Ready` | 88 – 94% | — |
| `Cordoned` | 2 – 4% | 计划维护、固件升级窗口 |
| `Draining` | 0.5 – 2% | cordon 后驱逐 Pod / 迁移实例 |
| `Remediation` | 0.5 – 2% | Xid 错误后自愈、单卡隔离、重启 |
| `NotReady` | 1 – 3% | NVLink down、NIC 故障、掉卡、 ECC 不可纠 |

> 每个**必须**至少有一个非 Ready 节点，且每一个非 Ready 节点 **MUST** 有对应的 `node_events` 记录与指标证据，否则视为悬空状态。

### 5.4 容量分布（真实的新算力铺开节奏）

| 池 | 可用区域 | 节点 / 机柜数 | 说明 |
| --- | --- | --- | --- |
| `H100_SXM` | US, JP, SG, TH | US 512 / JP 256 / SG 192 / TH 128 | 成熟容量，4 区全铺 |
| `H200_NVL` | US, JP, SG | US 256 / JP 128 / SG 96 | 主流容量 |
| `B200_NVL72` | US, JP | US 24 柜 / JP 8 柜 | 按机柜售卖，最小单位 1 柜 |
| `B300` | US, SG | US 64 / SG 32 | 新池，容量有限 |
| `GB300_NVL72` | US | US 12 柜 | 旗舰，**仅美国**，需申请配额 |

> 结论：`GB300_NVL72` 在 TH/JP/SG 应为**不可选**（灰 + 申请配额），此即顶部状态栏「算力供给」中"仅部分区域有货"的真实依据（PRD §3.2）。

> 上表为平台侧节点池容量，仅用于内部供给模拟与部署目录派生，不直接展示给租户。总览的 1040 是当前用户实际分配的资源卡数，与平台可售容量、`quotas.used_value` 均为不同口径。

---

## 6. 监控指标字典（详情页监控区块的唯一来源）

> 每条指标定义：`键 / 单位 / 正常区间 / 告警阈值 / 采样频率 / 聚合方式 / 资源类型适用性`。
> 告警阈值同时写入 DESIGN-SYSTEM §8（图表阈值线与状态色），两处必须一致。

### 6.0 通用采样约定

| 项 | 值 |
| --- | --- |
| 原始采样间隔 | 15 s（GPU/NIC/温度，对应 DCGM 常规采集） |
| 展示降采样 | 近 1h → 15s 原始；近 6h → 1min；近 24h → 5min；近 7d → 1h |
| 降采样聚合 | 利用率/功耗/温度取**均值**；带宽/吞吐取**均值**；峰值伴 `max`；延迟取 **P50/P90/P95/P99** |
| 实时追加 | 2 – 5 s（ARCH §8，`VITE_WS_URL`） |
| 缺省值 | 无数据用 `null`（图表断点），**禁止用 0 填充** |

### 6.1 GPU 核心指标（适用：GPU 云服务器 / 裸金属 / vGPU 节点 / 推理实例）

| 指标键 | 单位 | 正常区间 | 告警阈值 | 说明 |
| --- | --- | --- | --- | --- |
| `gpu_utilization` | % | 训练 75–98；推理 30–85；开发 5–60 | < 20 持续 30min = **低利用率提醒** | SM 占用率，训练应高且平稳 |
| `gpu_memory_used` | GB | ≤ 容量 × 0.95 | > 95% = 显存压力 | 需与 `gpu_memory_total` 同源 |
| `gpu_memory_util` | % | 40–95 | > 95 告警 | 含碎片，非 used/total 简单比值 |
| `hbm_bandwidth_util` | % | 30–90 | — | **memory-bound 的关键判据** |
| `gpu_power_draw` | W | idle 60–100；满载 ≤ TDP | > TDP×0.98 持续 = 功耗墙 | 按 §3.1 卡型取 TDP |
| `gpu_temperature` | °C | 40–80 | > 85 警告；> 88 严重（接近 HW Slowdown） | 见下表 IDC 入风修正 |
| `gpu_memory_temperature` | °C | 50–90 | > 95 严重 | HBM 结温，通常高于核心温 |
| `fan_speed` | % | 30–80 | > 95 或 0 | 液冷机柜无此指标，置 `null` |
| `pcie_throughput` | MB/s | 0–25,000 | — | Gen5 x16 ≈ 64 GB/s 理论 |
| `nvlink_throughput` | GB/s | 见 §3.1 链路值 | 低于理论 60% = 链路降级 | NVL72 域取卡均值 |
| `sm_clock / mem_clock` | MHz | boost 附近 | **持续大幅低于 boost = 降频（throttle）** | 需联动 `clocks_throttle_reasons` |
| `ecc_sbe_total` | 次 | 0–偶发 | 单日增速 > 10 = 关注 | 单比特可纠正 |
| `ecc_dbe_total` | 次 | **0** | **≥ 1 = 立即隔离**（Xid 48） | 双比特不可纠正 |
| `xid_errors` | 次 | 0 | ≥ 1 记录并挂节点事件 | 见 §6.6.1 |

**温度入风修正（SHOULD）**：液冷（B200/B300/GB300）入口温度 25–35 °C，GPU 核心满载 55–75 °C；风冷（H100/H200）入风 22–27 °C，满载 65–82 °C。Mock 应体现此差异。

### 6.2 GPU 云服务器（GPU Cloud Server，`kind='gpu_vm'`）

详情页监控区块组成（PRD §4.3.1）：

| 区块 | 指标 | 参照竞品 |
| --- | --- | --- |
| **算力概览卡** | `gpu_utilization` `gpu_memory_used/total` `gpu_power_draw` `gpu_temperature` | RunPod Pod 卡片（`GPU % / VRAM % / $ accrued`） |
| **GPU 明细（按卡）** | 上述 ×每张卡 + `mig_mode` 标识 | AutoDL 实例控制台多卡视图 |
| **主机资源** | `cpu_util` %、`host_memory_used/total` GB、`swap_used`、`load_avg_1/5/15` | AutoDL"（进程/资源）面板 |
| **存储** | `disk_used/total` GB、`disk_read/write_iops`、`disk_read/write_bw` MB/s、`disk_latency` ms | Vast.ai 的 `dlperf`/磁盘列 |
| **网络** | `net_in/out` MB/s、`net_rx/tx_pps`、`tcp_retransmit` %、`public_ip` 出网 GB 累计 | Vast.ai `inet up/down` |
| **进程 TOP（可选）** | `pid / command / gpu_mem / user / start_time` | AutoDL 进程面板 |
| **费用实时** | `cost_per_hour` $/h、`cost_today` $、`cost_this_month` $、剩余可用时长估算 | AutoDL 按量/包月余额显示 |

**典型形态（按用途，SHOULD）**：
- 开发/交互型：利用率 **锯齿脉冲**（0–60）—— 用户敲代码时空转，跑一步冲高；
- 批处理型：利用率 **高台 85–98%**，接近恒定但有 ±3% 抖动，显存稳定；
- 空闲未关型：利用率 `< 5%` 且持续 > 2h → **必须产生"资源闲置"提醒事件**（这是 AutoDL/Vast.ai 的核心省钱诉求）。

### 6.3 GPU 裸金属（GPU Bare Metal，`kind='gpu_baremetal'`）

硬件健康是裸金属的差异化毛利点（PRD §4.3.2），必须比云服务器多一层**带外（OOB）**指标：

| 区块 | 指标 | 说明 |
| --- | --- | --- |
| **GPU 健康** | `ecc_sbe/dbe` `row_remap_failed` `retired_pages` `nvlink_crc_errors` `pcie_correctable/uncorrectable` | 任一非零必须与事件对应 |
| **PCIe / 拓扑** | `pcie_link_gen`（应为 Gen5）、`pcie_link_width`（应为 x16）、`acs_enabled`、`aer_errors` | 链路降级为 x8 是典型故障 |
| **NIC / InfiniBand** | `ib_port_state`、`ib_tx/rx_bytes` GB/s、`ib_symbol_errors`、`ib_link_down_events`、端口速率应显示 `400 Gb/s` | 训练集群关键指标 |
| **NVMe** | SMART：`nvme_media_errors`、`nvme_percentage_used` %、`nvme_critical_warning`、`nvme_temperature` °C | 百分比用到 100% 应告警 |
| **PSU / 冗余** | `psu_status` ×N、`psu_redundancy`（应为 2N）、`psu_input_power` W | 单电源失效必须告警但不宕机 |
| **风扇 / 散热** | `fan_rpm` ×N、`fan_status`、`inlet_temp` °C | 液冷节点置 `null` |
| **BMC / 带外** | `bmc_firmware`、`bmc_reachability`、`sel_log_count`（System Event Log）、`last_sel_entry` | IPMI 控制台入口的数据支撑 |
| **固件版本** | `vbios`、`driver_version`、`cuda_version`、`firmware_compliance` | Vast.ai 卡片展示 `cuda 12.8 / driver 570` |

> **数据来源声明**：以上指标全部由 Mock TSDB 提供，均**不落 PostgreSQL**（ARCH §12.8 边界声明）。

### 6.4 vGPU · 托管 K8s（`kind='vgpu'`）

参照 CoreWeave CKS / Mission Control 的集群视图语义：

| 区块 | 指标 | 说明 |
| --- | --- | --- |
| **控制面健康** | `apiserver_latency_p99` ms（正常 < 500，告警 > 1000）、`etcd_fsync_p99` ms（正常 < 10，告警 > 25）、`etcd_db_size` MB、`scheduler_pending_pods`、`controller_queue_depth`、`api_error_rate` % | 托管 K8s 的核心 SLA 指标 |
| **节点池** | `node_count`、`ready_node_ratio` %、`allocatable_gpu` vs `capacity_gpu`、`gpu_allocation` %、`node_pool_autoscaler_status` | 用于列表页占比条 |
| **GPU 切片** | `mig_profile`（例如 `1g.24gb`）、`mig_free/total`、`time_slice_share`、`gpu_sharing_mode`（MIG / Time-Slicing / MPS） | MUST 与 §3.1 MIG 行一致 |
| **设备插件** | `device_plugin_healthy`、`gpu_operator_version`、`nfd_version`、`driver_daemonset_ready` | 插件异常 → GPU 不可调度 |
| **工作负载** | Pod 各 phase 计数（`Running/Pending/Failed/Succeeded`）、`pod_restarts`、`oom_killed_count`、`container_waiting_reason`（`ImagePullBackOff` / `CrashLoopBackOff` / `ContainerCreating`） | 详情页 Namespace → Deployment → Pod 三级下钻 |
| **调度失败原因** | `FailedScheduling` 原因 TopN：`Insufficient nvidia.com/gpu`、`node(s) had taint`、`didn't match PodTopologySpread`、`Insufficient cpu/memory` | **必须出现 `Insufficient nvidia.com/gpu` 才有说服力** |
| **网络** | `cni_errors`、`service_latency_p99`、`ingress_qps`、`vpc_peering_status` | — |
| **存储** | `pvc_bound/pending`、`pv_capacity` GB、`csi_errors` | Pending PVC 需有原因 |

**典型形态（SHOULD）**：至少一个 Namespace 存在 `Pending` Pod 且原因为 `Insufficient nvidia.com/gpu`；至少一个 Pod 有 ≥ 1 次重启；至少一个节点池处于扩容中（`scaling_up`）。

### 6.5 推理服务（Inference Service，`kind='inference'`）

采用 **vLLM / SGLang 的 Prometheus 指标语义**（这是事实标准，评审者一眼可辨）：

| 指标键 | 单位 | 正常区间（参考） | 告警阈值 | 说明 |
| --- | --- | --- | --- | --- |
| `ttft_p50 / p90 / p99` | ms | P50 150–600；P99 1,200–4,000 | P99 > 5,000 | Time To First Token，prefill 主导 |
| `tpot_p50 / p99` | ms | P50 12–40；P99 30–80 | P99 > 100 | Time Per Output Token，decode 主导 |
| `e2e_latency_p50 / p99` | s | P50 2.5–8；P99 8–25 | P99 > 30 | 端到端请求延迟 |
| `requests_per_second` | req/s | 2–200 | — | 与副本数线性相关 |
| `num_requests_running` | 个 | ≥ 0 | 持续等于 `max_num_seqs` → 已达并发上限，新请求排队 | 并发在跑请求 |
| `num_requests_waiting` | 个 | 0–20 | > 50 = 需扩容 | 排队请求 |
| `num_requests_swapped` | 个 | 0–5 | > 20 = 显存不足触发 swap | CPU swap |
| `generation_tokens_total` | tokens/s | 见下说明 | — | 聚合输出吞吐（MUST 按模型/副本派生） |
| `prompt_tokens_total` | tokens/s | — | — | 输入吞吐 |
| `gpu_cache_usage_perc` | % | 45–88 | > 92 = KV cache 将满 | vLLM KV cache 占用 |
| `prefix_cache_hit_rate` | % | 25–70 | — | 前缀缓存命中率，> 90 为极优 |
| `avg_generation_length` | tokens | 120–600 | — | 平均生成长度 |
| `active_lora_adapters` | 个 | 0–8 | — | 多 LoRA 场景才有非零值 |
| `http_error_rate_4xx/5xx` | % | < 0.5 / < 0.1 | 5xx > 1 | 含超时与 OOM 拒绝 |
| `replica_count` / `desired_replicas` | 个 | 与 HPA 一致 | 长时间不等 = HPA 卡住 | 实例↔Serving 共享 |

**按模型规模的公认吞吐参考（用于派生校准，SHOULD）**

| 模型规模 | 部署形态 | 单请求 TPOT | 单节点聚合输出吞吐 |
| --- | --- | --- | --- |
| 8B 级（BF16/FP8） | 1 × H100 | 8 – 15 ms/tok（66–125 tok/s） | 1,500 – 3,500 tok/s |
| 70B 级（FP8, TP=8） | 8 × H100/H200 | 15 – 40 ms/tok（25–66 tok/s） | 1,200 – 3,000 tok/s |
| 70B 级（FP4/FP8） | 8 × B200/B300 | 10 – 25 ms/tok | 2,500 – 6,000 tok/s |
| 400B+ MoE | GB300 NVL72 域 | 20 – 50 ms/tok | 8,000 – 20,000 tok/s（专家并行） |

> 上述值必须与 §3.1 带宽/算力派生一致：**70B FP8 的 decode 带宽受限**，`tokens/s ≈ bandwidth × efficiency / weights_bytes` 可作为上界校验（§7.3）。

**日志流（Modal 风格）**：详情页「日志与监控」标签必须提供**结构化逐行日志**，含 `ts / level / request_id / route / status / latency_ms / prompt_tokens / gen_tokens / cache_hit`，滚动追加；错误行用 danger 色并有 `Traceback` 折叠块。禁止只有"正常日志刷屏"。

### 6.6 节点基础设施层（平台内部，不对租户页面展示）

本节指标用于平台内部供给与故障模拟；可作为资源故障事件或供给状态的派生依据，但不得呈现为租户节点列表、节点健康预览或独立运维菜单。vGPU 详情仅展示该用户资源的节点池与工作负载视图，不暴露平台节点明细。

#### 6.6.1 节点故障判据（NVIDIA Xid 标准）

| Xid | 含义 | 触发动作（Mock 应体现） |
| --- | --- | --- |
| 13 / 31 | Graphics Engine Exception / MMU Fault | 进程终止，节点保持 `Ready`，但记录事件 |
| 48 | **Double Bit ECC Error (DBE)** | 立即 Cordoned → Remediation |
| 63 | Row remapping event（页退役） | 事件记录，计数累加 |
| 64 | Row remapping **failure** | → Remediation |
| 74 / 79 | NVLink Error / **GPU fallen off the bus** | → NotReady → Remediation |
| 94 | Contained ECC error | 事件记录，重启可回收 |
| 109 | Context switch timeout | 事件记录，进程级 |

> Mock 中每一个 `NotReady`/`Remediation` 节点 **MUST** 至少有一条匹配上述 Xid 的 `node_events` 记录。

#### 6.6.2 训练效能指标（CoreWeave goodput 语义）

| 指标 | 定义 | 公认区间 | 说明 |
| --- | --- | --- | --- |
| `mfu` | Model FLOPs Utilization = 有效模型 FLOPs / 峰值 FLOPs | 训练良好 **35 – 55%**；> 55% 优秀；< 20% 需优化 | 含激活值语义 |
| `hfu` | Hardware FLOPs Utilization（含重计算） | 通常比 MFU 高 5–15 pp | 与 MFU 需一致：不得 HFU < MFU |
| `goodput` | 有用训练进度 / 理论应有进度（扣除故障、重启、straggler 损失） | 健康集群 **85 – 97%** | CoreWeave 核心卖点指标 |
| `step_time_p50 / p99` | s | 视模型，P99/P50 < 1.2 为健康 | 用于 straggler 判定 |
| `straggler_ratio` | `step_time_p99 / step_time_p50` | < 1.2 健康；**≥ 1.2 标记 straggler**；≥ 1.5 严重 | 见 §7.5 |
| `communication_overhead` | % step time | 5 – 25%；> 35% 需优化拓扑 | all-reduce 占比 |
| `data_loading_stall` | % step time | < 5%；> 15% 数据管道瓶颈 | — |
| `node_availability` | % | ≥ 99.0（月度）；< 98 需事件说明 | 与 §5.3 状态分布联动 |
| `mean_time_to_remediation` | min | 10 – 60 | 自愈能力体现 |

**goodput 必须可按此派生（MUST）**
`goodput = mfu_ratio × node_availability × (1 - restart_overhead) × (1 - straggler_penalty)`
其中 `straggler_penalty = clamp(straggler_ratio - 1, 0, 0.3)`。

### 6.7 顶部状态栏所需指标（PRD §3.2）

> 状态栏只消费 PRD §3.2 定义的服务状态与聚合数据；金额必须真实派生，区域维度只用于适用字段，不生成固定健康百分比或固定延迟数值。

| 展示位 | 指标 | 派生来源 |
| --- | --- | --- |
| 服务健康 | `service_status ∈ {normal, degraded, fault}`、`active_incidents` | 服务故障/降级事件与可用状态聚合；不计算或展示健康百分比，不返回节点级详情 |
| 当前区域算力供给 | `available_gpu / total_gpu`（按模型分，按 region） | `node_pools`；紧张阈值 `available/total < 0.15` |
| 账户余额 | `credit_balance`（真实，非写死） | `orgs.credit_balance`（§4 扣减规则） |
| 本月花费 | `cost_mtd`（真实聚合，非写死） | `billing_usage` 按 `billing_period + region` 聚合，含折扣与代金券 |
| 实时指示 | WS 心跳**可达性**（连通/断连），非写死延迟 | 真实 WS；断连转灰并提示 |

---

### 6.8 详情页字段 → 数据源 → 派生方式 映射表（MUST）

> **回应"引入数据库的目的是让整体 Mock 数据更有真实性，详情与计费信息更严谨"**。
> PRD §4.3.1–4.3.4 上展示的**每一个字段，都必须能在下表中查到来源**。凡不在表中的字段 = 装饰性字段 = 视为不合格。
> 记法：`DB:表.列` = 直接取库；`TSDB:指标键` = 时序接口（不落 PG，§11）；`ƒ()` = 由 §7 派生公式算出。

#### 6.8.1 四类共用（详情页头部 + 概览）

| UI 字段             | 来源                                    | 说明                            |
| ------------------ | ------------------------------------- | ----------------------------- |
| 类型图标 / 类型名         | `DB:resources.kind` → ARCH §12.6      | 图标取 `lib/ids.ts` 唯一来源         |
| 名称                 | `DB:resources.name`                   |                               |
| `display_id`       | `DB:resources.display_id`             | 前缀按类型（§5.2.1）                 |
| 生命周期状态             | `DB:resources.status`（+`deleted_at`）   | 5 枚举态 + 「已释放」派生态，色见 DESIGN §8.2            |
| 区域 / 节点池           | `DB:resources.region` + `.node_pool`  | **切区域必须变化**（G9）               |
| 创建时间 / 运行时长         | `DB:resources.created_at` / `.running_since` | 时长 = `now − running_since`   |
| 所有者 / 项目           | `DB:users.display_name` / `DB:projects.name` | **project 必填**（ARCH C1）  |
| 来源（镜像/模型/模板）        | `DB:deployment_orders.source_type` + `.source_ref_id` | → `images`/`models`/`app_templates` |
| 物理落位（机架/交换机/节点）     | `DB:resource_placements.rack_id/.node_id` → `gpu_nodes` |                               |
| **`$`/时**          | `ƒ(costPerHour)` §7.1                 | 单位随类型：GPU·h / **台·h**         |
| 今日 / 本月花费           | `DB:billing_usage` 聚合                 | 按 `billing_period` + `region` |
| **预计可运行 X 小时**      | `ƒ(remainingHours)` = `orgs.credit_balance / costPerHour` | AutoDL 心智，余额不足时提示   |
| 下单时预估 vs 实际         | `DB:deployment_orders.price_snapshot` vs 当前 ƒ() | 差异 > 10% 时详情页标注原因（如换池/折扣到期） |

#### 6.8.2 GPU 云服务器（§4.3.1）

| UI 字段                     | 来源                                                      |
| ------------------------- | ------------------------------------------------------- |
| 规格族 / GPU 型号·数量 / vCPU / 内存 | `DB:resources.spec_json.{gpu_model,gpu_count,vcpu,memory_gb}` |
| 镜像（名称/tag/CUDA）             | `DB:images.*` ← `deployment_orders.source_ref_id`        |
| 私网 / 公网 IP                  | `DB:spec_json` + `resource_placements`                   |
| 安全组 / VPC / 子网              | `DB:spec_json`（网络段）                                      |
| 算力概览四卡（利用率/显存/功耗/温度）        | `TSDB:gpu_utilization` `gpu_memory_used/total` `gpu_power_draw` `gpu_temperature`（§6.1） |
| 按卡明细                        | 同上 × 每卡（`gpu_indices` 来自 `DB:resource_placements`）        |
| 主机资源（CPU/内存/swap/load）      | `TSDB:` §6.2 主机资源键                                      |
| 存储 / 网络 / 进程 TOP            | `TSDB:` §6.2 存储/网络/进程键                                   |
| 控制台（Jupyter/Terminal/SSH）   | `DB:notebooks.url_path` + 由 `resource_uuid` 派生的 SSH 串     |
| 数据盘 / 挂载 / 环境变量             | `DB:spec_json.{storage_gb,env}`                          |

#### 6.8.3 GPU 裸金属（§4.3.2，**台**语义）

| UI 字段                     | 来源                                                      |
| ------------------------- | ------------------------------------------------------- |
| 机型                         | `DB:spec_json.machine_type`                              |
| **台数**                     | `DB:spec_json.machine_count`（1–32）**← 计费数量 = 此值**         |
| 整机总卡数（仅展示）                  | `ƒ()` = `machine_count × node_pools.gpus_per_node`         |
| CPU / 内存 / 本地 NVMe / RAID  | `DB:spec_json.{cpu_model,memory_gb,local_nvme_gb,raid_level}` |
| 直通策略 / MIG 分区               | `DB:spec_json.{passthrough,mig_partition?}`              |
| 机架位 / 节点 UID 列表             | `DB:resource_placements.rack_id` → `gpu_nodes.node_uid`    |
| GPU 健康（ECC/row-remap/retired） | `TSDB:` §6.3 GPU 健康键（`ecc_dbe` ≥1 红色）                      |
| PCIe 链路（gen/width/AER）       | `TSDB:` §6.3；`width` 应为 x16，**x8 即告警**                     |
| NIC / InfiniBand            | `TSDB:` §6.3（端口速率应 400 Gb/s）                              |
| NVMe SMART / PSU / 风扇        | `TSDB:` §6.3                                             |
| BMC / SEL 日志                 | `TSDB:bmc_*` + `sel_log_count`                            |
| 固件 / 驱动 / CUDA              | `TSDB:vbios` `driver_version` `cuda_version`              |
| **单价行**                     | `DB:billing_rates(unit='per_machine_hour')` × 区域系数 → `ƒ(costPerHour)` |

#### 6.8.4 vGPU（§4.3.3）

| UI 字段              | 来源                                                      |
| ------------------ | ------------------------------------------------------- |
| K8s 版本 / 控制面规格       | `DB:spec_json.{k8s_version,control_plane_tier}`          |
| 节点池列表 / 每池节点数        | `DB:spec_json.node_pools[].{poolCode,nodeCount}`          |
| 切片策略 / MIG profile  | `DB:spec_json.node_pools[].{slicingPolicy,migProfile?}`   |
| GPU 容量 vs 已分配        | `ƒ()` = 各池 `nodeCount × gpusPerNode` vs 实际占用（来自 placements 聚合） |
| 控制面健康（apiserver/etcd） | `TSDB:` §6.4 控制面键                                        |
| 节点状态 5 态 / straggler  | `DB:gpu_nodes.state/.straggler`                          |
| 工作负载（NS/Deploy/Pod）   | `TSDB:` §6.4 工作负载键（phase/restarts/waiting_reason）        |
| 调度失败原因 TopN           | `TSDB:` §6.4；**必须包含 `Insufficient nvidia.com/gpu`**       |
| 网络 / 存储（PVC）          | `TSDB:` §6.4                                            |
| 拓扑视图                  | `DB:resource_placements` → `gpu_nodes{rack_id,switch_group}` → `node_pools` |
| 费用三行                  | 控制面费（§4.3 表）+ 各池 GPU·h + 附加存储 → `ƒ(costPerHour)`          |

#### 6.8.5 推理服务（§4.3.4）

| UI 字段                    | 来源                                                      |
| ------------------------ | ------------------------------------------------------- |
| 模型（名称/参数量/量化/许可）           | `DB:models.*` ← `deployment_orders.source_ref_id`        |
| 副本数 / 期望副本数 / 弹性策略       | `DB:spec_json.replicas` + `spec_json.scaling?{strategy_model,trigger_metric,min_size,max_size,scale_to_zero}` |
| 单副本 GPU 数 / 引擎 / 端口        | `DB:spec_json.{gpu_per_replica,engine,port}`             |
| 端点 URL / 鉴权                | `DB:spec_json`（API Key 仅创建时展示一次）                          |
| `max_model_len` / 批处理参数      | `DB:spec_json.{maxModelLen,max_batch_size}`              |
| 延迟分位 TTFT / TPOT / E2E      | `TSDB:` §6.5 键（P50/P90/P99）                              |
| 吞吐 / 并发（running/waiting/swapped） | `TSDB:` §6.5                                             |
| KV cache / 前缀缓存命中率         | `TSDB:gpu_cache_usage_perc` / `prefix_cache_hit_rate`      |
| 错误率 4xx/5xx                | `TSDB:` §6.5                                             |
| 结构化日志                     | `TSDB/日志流`（§6.5 日志契约，含 request_id）                       |
| **显存可行性闸门**               | `ƒ(weightsGb)` §7.3 + `ƒ(kvRequiredGb)` §7.4，创建时校验（PRD §4.2.4） |

**服务治理 Mock 口径**：`GET /api/resources/:uuid/governance` 从当前推理资源和同资源伸缩策略派生。版本标签固定为 `${modelRef}-v1`（stable）与 `${modelRef}-v2`（canary），是同一已选模型的两个服务修订，不新增模型或 GPU 分配；运行态为 ready，其他状态为未就绪。灰度版本权重取 `spec.canaryPercent`，稳定版本取 `100-canaryPercent`，合计恒为 100%。网关从 `spec.gateway` 读取，旧种子默认 100 req/s、30000 ms；写入验证和状态约束见 ARCH §12.11.5。配置保存在现有浏览器 Mock 状态；真实多版本部署、流量路由、限流与请求超时执行由后端网关承担。接口与持久化数据不包含 API Key。

#### 6.8.6 计费 Tab（PRD §7.8 四段，四类共用）

| UI 段                 | 来源                                                           |
| -------------------- | ------------------------------------------------------------ |
| ① 实时费用卡              | `ƒ(costPerHour)` §7.1 + `DB:billing_usage` 聚合 + `DB:orgs.credit_balance` |
| ② 单价构成明细             | `DB:billing_rates{price,unit}` × 区域系数 §4.2 × 折扣 §4.4（逐项列出）      |
| ③ 用量明细表              | `DB:billing_usage{usage_hour,unit,quantity,unit_price,amount}` |
| ④ 扣费流水               | `DB:billing_transactions{type,amount,balance_after,reference_type,reference_id}` |
| 停止态提示                 | `DB:resources.status='stopped'` → 算力行 0、存储行继续（§7.4）             |

> **禁止项**：上表之外不得出现"按调用量计费""令牌单价"等 v1 未启用的计费行（PRD §7.1）。

### 6.9 弹性伸缩指标（PRD §4.2.6 / §4.5.2、ARCH §12.12）

> 伸缩策略的触发判定与事件展示所需数值，**必须可由 §6 指标字典复算**，不得另造一套。

| 指标键                   | 适用模型              | 阈值口径（示例）                              | 派生方式                          |
| --------------------- | ----------------- | -------------------------------------- | ----------------------------- |
| `queue_depth`         | `node_pool`（云服务器/vGPU） | > 20 持续 2min 触发扩容                     | 离线队列长度（`pending_pods` 同源，vGPU 用 Pod phase） |
| `gpu_allocation_rate` | `node_pool`（裸金属）   | < 35% 持续 10min 触发缩容                   | 已分配 GPU / 总 GPU（§6.6 节点口径）   |
| `qpm`                 | 两类                 | > 300 触发扩容 / < 80 持续 5min 缩容          | 推理 §6.5 `requests_per_min`    |
| `ttft_p99`            | `replica`         | > 800ms 触发扩容                          | 推理 §6.5 首 token 延迟分位        |
| `kv_cache_usage`      | `replica`         | > 85% 触发扩容                            | 推理 §6.5 KV cache 使用率        |
| `concurrency`         | `replica`         | > 64 触发扩容                            | 推理 §6.5 running/waiting 之和    |

- **warm pool 命中率**：推理策略事件中 `warm_pool_hit=true` 占比 ≥ 60%（秒级扩容），冷启动事件 `duration_s` 取 30–720s（与 §5.1 供给时长口径一致）。
- **冷启动耗时（伸缩场景，必须按形态区分）**：裸金属 300–1800s（装机 5–30min）、GPU 云服务器 60–300s、vGPU 30–120s、推理 warm pool ≤5s / 冷启动 30–720s；**UI 必须在裸金属策略卡与向导开关处明示**（PRD §4.2.6.2）。
- **当前值**：策略卡展示的"当前 N 台/副本"必须与 `resources.spec_json` 的实际规格一致（扩容成功后同步更新，事件 `to_size` 即新值）。
- **指标与策略阈值一致性**：`trigger_snapshot.value` 必须落在该指标同窗口序列的合理范围内（G8：不得出现 snapshot 与曲线矛盾）。

### 6.10 数据模块 Mock 约束（PRD §4.6）

> 数据模块（数据集 / 对象存储 / 流水线）同样受 §1 通用约束：真实量级、派生优先、单位统一、确定性可复现。

| 实体 | 量级基线（示例，必须落在此范围） | 关键字段与口径 |
| --- | --- | --- |
| **数据集** | 每组织 3–12 个；单版本 0.5–800 GB；格式标签 ∈ {parquet, jsonl, image, csv} | `size_gb` 保留 2 位小数；`latest_version` 与版本列表最大值一致；`ref_count` = `dataset_references` 行数 |
| **数据集版本** | 每个数据集 1–6 个版本；版本号单调（v1→v6） | `change_note` 非空且不重复模板句 |
| **对象存储桶** | 每组织 1–6 个桶；对象 20–2000 个/桶；单对象 1 KB–50 GB | 桶绑定单一 `region`；`access` ∈ {private, public_read}；对象 `storage_class` ∈ {standard, infrequent} |
| **流水线** | 每组织 2–10 条；节点 3–12 个 | `dag_json` 必须无环（构建期校验）；节点类型 ∈ {source, process, train, output} |
| **流水线运行** | 每条流水线 0–40 次运行；失败率 8–20%（G7） | `status` ∈ {success, running, failed, never}；`duration_sec` 与 `finished_at − started_at` 一致；失败的运行**必须至少一个节点 status='failed' 且带非空日志** |
| **节点级明细** | 每次运行节点数 = DAG 节点数 | `outputs_json` 非空且指向真实数据集 / 桶路径；日志行数 ≥ 3 |

**强制红线（G8 数据模块追加）**

- 对象总容量 = 桶内对象 `size_bytes` 之和，**不得另写一个"展示用容量"**。
- 流水线「最近运行状态」= `pipeline_runs` 最近一条 `created_at` 的状态，**不得独立字段**。
- 数据集删除若 `ref_count > 0`，Mock 必须返回 409 而非静默删除（引用完整性）。
- 数据集与流水线为组织级（不随区域变化）；桶为区域级，切区域后桶列表**必须变化**。

---

## 7. 派生公式引擎（禁止硬编码，ARCH §6 / `mocks/lib/derive.ts`）

> 所有公式对应一个纯函数，输入输出皆有类型。**基础常量值由 `mocks/fixtures` 提供，滤波/派生由 `mocks/lib/derive.ts` 计算。**

### 7.1 资源费用派生

```
# 按类型区分计费数量（裸金属按「台」，其余按「卡」）
if kind == 'gpu_baremetal':
    machine_hourly_cost = base_machine_rate(pool) × region_multiplier(region)
                          × machine_count(台) × discount_factor(plan)
    compute_cost        = machine_hourly_cost              # 禁止再乘 gpu_count
else:
    gpu_hourly_cost     = base_rate(pool) × region_multiplier(region) × gpu_count × discount_factor(plan)
    # vgpu: gpu_count = Σ(每池 nodeCount × gpusPerNode)
    # inference: gpu_count = replicas × gpu_per_replica
    compute_cost        = gpu_hourly_cost
    if kind == 'vgpu':  compute_cost += control_plane_rate(0.10, HA ×3 → 0.30)

storage_monthly_cost = storage_gb × storage_rate_gb_month
running_cost_per_hour= (status == 'running' ? compute_cost : 0) + storage_monthly_cost / 730
cost_today           = Σ hourly_usage_last_24h + today_transactions_adjust
remaining_hours      = credit_balance / running_cost_per_hour      // 用于"预计可运行 X 小时"
```
- `discount_factor`：按需 1.0；Spot `0.40–0.55`；1 年预留 `0.70`；3 年 `0.45`。
- **`730`** 为一月小时数（365×24/12），全文统一。
- **`base_machine_rate`** 取自 `billing_rates(unit='per_machine_hour')`，**不得**由 `base_rate × 8` 臆造（整机价含整机溢价/折扣，是一等公民价格）。

### 7.2 训练吞吐（6ND / 8ND）

```
flops_per_token   = 6 × params                       // 无激活重计算
                  = 8 × params                       // 全激活重计算（大模型默认）
peak_node_flops   = gpu_per_node × bf16_dense_flops  // §3.1
tokens_per_second = mfu × peak_node_flops × node_count / flops_per_token
```
- **校准锚点**：LLaMA-65B on 2,048 A100 = 771 k tokens/s，反推 MFU ≈ 47%（公认合理区间 ✅）。使用该锚点校验 Mock 生成器不会输出离谱值。
- 若工作负载为 **memory-bound 推理 decode**，不得套用此公式，改用 §7.3。

### 7.3 推理 decode 上界（带宽受限）

```
weights_bytes       = params × bytes_per_param        // BF16=2, FP8=1, FP4=0.5
theoretical_max_tps ≈ hbm_bandwidth_gbs / weights_bytes × efficiency
efficiency          = 0.5 – 0.8（batch 越大越高，上限受 KV cache 制约）
```
示例（**必须能自洽**）：Llama-3.1-70B FP8 单张 H100 → weights ≈ 70 GB，带宽 3.35 TB/s → 上界 ≈ 47 tok/s 单请求串行解码；因此 **70B 必须多卡 TP**，Mock 不得让单张 80GB 卡跑 70B BF16（140 GB > 80 GB，物理不可能 → G8 红旗）。

### 7.4 KV cache 与加载时长

```
kv_bytes_per_token = 2 × layers × kv_heads × head_dim × bytes_per_kv
kv_required_gb     = concurrency × avg_context_tokens × kv_bytes_per_token / 1e9
weights_load_sec   = weights_gb × 1024 / disk_read_mb_s + 5   // +5s 校验/初始化开销
```
- Llama-3.1-8B（32L / 8 kv-heads / head_dim 128 / BF16）→ **128 KiB/token**，即每 1,000 tokens ≈ 128 MB。
- `gpu_cache_usage_perc` = `kv_used_gb / kv_allocated_gb`，`kv_allocated = capacity - weights - activation_reserved(≥ 2 GB)`。
- **一致性要求**：`kv_used ≤ kv_allocated ≤ total_memory - weights` 恒成立，违反即 G8。

### 7.5 straggler 判定

```
straggler_ratio = step_time_p99 / step_time_p50
flags: r >= 1.2 → 'straggler';  r >= 1.5 → 'severe'
penalty: clamp(r - 1, 0, 0.3)
```

### 7.6 显存占用分解（用于详情页面"显存去哪了"，SHOULD）

```
gpu_memory_used = model_weights + kv_cache + activations + fragmentation + framework_overhead
// framework_overhead：PyTorch/CUDA context 通常 0.5 – 1.5 GB（必须计入，否则数字对不上）
```

### 7.7 计费派生（支撑 PRD §7.8 四段）

> 详情页「计费」Tab 展示的每一个数字，都必须能由本节公式从 `billing_usage` 复算得到。

```
# ① 逐小时用量行（写入 billing_usage；UNIQUE(resource_id, usage_hour, unit) 幂等）
if r.kind == 'gpu_baremetal':
    quantity = spec.machine_count;        unit = 'per_machine_hour'
elif r.kind == 'vgpu':
    quantity = Σ(各池 nodeCount × gpusPerNode); unit = 'per_gpu_hour'
elif r.kind == 'inference':
    quantity = replicas × gpu_per_replica;     unit = 'per_gpu_hour'
else:
    quantity = spec.gpu_count;                 unit = 'per_gpu_hour'

unit_price = billing_rates(kind, pool, region, unit).price × region_multiplier(region) × discount_factor
amount     = quantity × unit_price                 # 不可变快照（改价不追溯）

# vGPU 控制面单独成行（kind 相同但 unit 不同，靠 UNIQUE 的 unit 列区分）
vgpu_control_plane: quantity = 1; unit = 'per_instance_hour'; unit_price = 0.10 (HA: 0.30)

# 存储行（running 与 stopped 都写）
storage: quantity = storage_gb; unit = 'per_gb_hour'; unit_price = 0.08 / 730

# ② 汇总（供详情页费用卡 / 状态栏 / 成本页）
cost_per_hour  = Σ(当前生效单价行 amount)
cost_today     = Σ(amount WHERE usage_hour ≥ start_of_today)
cost_mtd       = Σ(amount WHERE billing_period = 当前账期)
remaining_hours= credit_balance / cost_per_hour

# ③ 扣费流水（billing_transactions）
charge : amount = −Σ(本小时 amount)；balance_after = credit_balance − Σ
refund / adjustment / credit：见 PRD §7.6，均须写 reference_type + reference_id
```

- **停止态**：`status='stopped'` 时**不写算力行**，只写存储行 → 详情页费用卡显示「算力停计中 · 仅计存储 $X/月」。
- **`provisioning`**：不写任何用量行 → 费用卡显示「供给中 · 尚未计费」（非 0）。
- **删除时**：最后一小时按实际秒数比例结算（`quantity × 秒数/3600`），随即停写（PRD §7.4）。

---

## 8. 生成器实现规范（`mocks/lib/`）

### 8.1 结构

```
mocks/
├─ fixtures/            # 静态常量与种子（带来源注释）
│   ├─ gpu-specs.ts             # §3.1/.2 硬件常量（唯一来源）
│   ├─ pricing.ts               # §4 价格与系数
│   ├─ models.ts                # 模型库真实模型/显存需求/上下文
│   ├─ images.ts                # 镜像商城（NGC/PyTorch/vLLM/SGLang 等）
│   ├─ pool-regions.ts          # §5.4 区域×池可用矩阵（ARCH C2，切区域差异的根源）
│   ├─ projects.ts              # 项目种子（含 isDefault 的 default 项目，PRD §3.5）
│   ├─ resources.ts             # 4 类资源种子（每类必带 region + project_id）
│   ├─ orders-steps.ts          # 工作项与 Provisioning 子步骤（ARCH §13）
│   ├─ usage.ts                 # 逐小时用量种子（§7.7，供 §7.8 三表）
│   ├─ scaling.ts               # v0.7：弹性策略与伸缩事件种子（PRD §4.2.6 / §4.5.2）
│   └─ users-orgs.ts            # 租户/角色/配额/余额
├─ lib/
│   ├─ derive.ts                # §7 全部纯函数（可单测）
│   ├─ rng.ts                   # mulberry32 种子随机
│   ├─ timeseries.ts            # 曲线生成：昼夜节律 + 噪声 + 毛刺
│   ├─ fault-injector.ts        # 受控异常注入（见 8.4）
│   └─ consistency.ts           # G8 断言（开发态 runtime check）
└─ handlers/            # MSW 拦截器（按资源分组）
```

### 8.2 时间序列形态（SHOULD）

不同工作负载必须使用**不同形态模板**，不可全用同一种：

| 模板 | 适用 | 形态 |
| --- | --- | --- |
| `steady-high` | 训练 | 85–98% 平台 + ±3% 噪声 + 每 step 边界的规律性小凹（通信/同步） |
| `spiky-interactive` | Notebook/开发 | 0–10% 基底 + 随机 30–120 s 的 40–90% 脉冲 + 冷却 |
| `traffic-following` | 推理服务 | 昼夜正弦（白天峰值 3–5× 夜间谷值）+ 突发叠加 |
| `batch-sawtooth` | 批处理作业 | 快速爬升 → 高台 → 骤降归零 → 间隔 |
| `idle` | 停止前的空转 | 0–5%，并触发闲置提醒事件 |

- 昼夜节律：以 UTC 时间为基准，亚太客户高峰 ≈ 02:00–10:00 UTC，北美 ≈ 14:00–22:00 UTC。
- 噪声：高斯白噪声 σ = 量程的 1–3%；叠加稀疏毛刺（每 100–300 点 1 次，幅度 < 阈值）。

### 8.3 一致性运行时校验（`consistency.ts`，开发态 MUST）

开发模式下每个 fixture / 每次 WS 推送前执行断言，失败则 console.error 并抛出可见 Toast（原型期即可发现数据问题）：

```
assert(memory_used_gb <= memory_total_gb)
assert(p50 <= p90 <= p95 <= p99)
assert(status !== 'provisioning' ? metrics_present : metrics_absent)
assert(status === 'stopped'  -> gpu_utilization === null)
assert(kv_used <= kv_allocated <= total - weights)
assert(cost_per_hour === derive.costPerHour(spec, region, plan))
assert(0 <= utilization <= 100)
assert(power_draw <= tdp * 1.02)
assert(mfu <= 1 && hfu >= mfu)
assert(available_gpu <= total_gpu && available_gpu >= 0)

// v0.6 新增（对应 ARCH §12.10.3 C1–C12）
assert(resource.project_id != null)                       // C1
assert(POOL_REGIONS.has(`${pool}@${region}`))             // C2 区域×池矩阵
assert(kind !== 'gpu_baremetal'
    || (spec.machine_count >= 1 && spec.machine_count <= 32
        && spec.gpu_count === spec.machine_count * gpusPerNode))   // C3 台数
assert(kind === 'gpu_baremetal' || (gpu_count >= 1 && gpu_count <= 8)) // C4
assert(unitMatchesKind(kind, unit))                       // C5 计费单位
assert(status !== 'running' || running_since != null)      // C7
assert(deleted_at === null || status === 'terminating')    // C8
assert(kind !== 'inference'
    || weights_gb + kv_gb + 2 <= gpu_per_replica * vram_gb) // C9 显存可行性
assert(region != null)                                     // C10
assert(state !== 'ready' || node_events.length >= 0)
assert(nodeState === 'ready' || nodeEvents.some(e => XID_CODES.has(e.xid))) // C12
assert(cost_per_hour === derive.costPerHour(spec, region, plan, kind)) // 含台/卡分支
assert(listByRegion(r1).totalCount !== listByRegion(r2).totalCount
    || listByRegion(r1).digest !== listByRegion(r2).digest)  // G9：切区域必变（至少数据指纹不同）
```

### 8.4 受控异常注入（SHOULD）

每个"演示脚本"必须能被 Story/Query 参数触发，以便演示告警分支：

| 场景键 | 效果 |
| --- | --- |
| `?fault=oom` | 推理服务 ->irá OOM，事件出现 `torch.OutOfMemoryError: CUDA out of memory`，副本 CrashLoopBackOff |
| `?fault=xid48` | 某 GPU 出现 Double-Bit ECC → 节点 Cordoned → Remediation |
| `?fault=network` | IB 端口 link down，训练 communication_overhead 从 12% → 43% |
| `?fault=straggler` | 某节点 step_time P99/P50 = 1.6，goodput 从 93% → 78% |
| `?fault=insufficient` | vGPU 出现 `Insufficient nvidia.com/gpu` 的 Pending Pod |
| `?fault=billing` | 余额不足触发限新建 → 宽限期告警 |

> 异常必须与 TTL 一起生效（默认 15 min 后自愈），避免原型"永久红"。

### 8.5 分页 / 延迟 / 错误模拟（SHOULD）

- 列表默认 20 条，MSW 返回 `X-Total-Count`，支持 `?page&size&sort&filter`。
- 人为延迟：列表 120–320 ms，详情 200–500 ms，写操作 400–900 ms，且 5% 请求返回 429/503 以验证重试与 Toast。
- 时间戳统一 UTC；UI 按用户偏好显示本地时区，并在 Tooltip 显示原始 UTC（避免跨时区评审歧义）。

---

## 9. 有意义的事件规范（详情页「事件时间线」）

### 9.1 事件契约（`resource_events` / `node_events`）

```ts
interface MonitorEvent {
  id: string;
  occurredAt: string;              // ISO 8601 UTC
  level: 'info' | 'warning' | 'error' | 'success';
  source: string;                  // 'dcgm' | 'k8s-scheduler' | 'vllm' | 'billing' | 'ib-fabric' | 'user'
  code: string;                    // 'GPU_MEMORY_PRESSURE' | 'XID_48' | 'HPA_SCALE_UP' | 'INSUFFICIENT_GPU'
  title: string;                   // 人读摘要
  detail: string;                  // 带具体数值的说明
  metricsBefore?: Record<string, number | string>;
  metricsAfter?: Record<string, number | string>;
  relatedResource?: { kind: string; uuid: string; label: string };
  correlationId?: string;          // 关联 requestId / traceId / orderId
  suggestedAction?: string;        // 建议动作（可点击跳详情页/执行操作）
}
```

### 9.2 事件必须"带度量"（MUST）

| ❌ 无意义 | ✅ 有意义（须采用此形态） |
| --- | --- |
| `资源状态更新` | `GPU 3 显存压力：已用 77.2/80 GB（96.5%）持续 12 min，建议降低 batch_size 或扩容到 141 GB 机型` |
| `节点异常` | `检测到 Xid 48（Double-Bit ECC Error）于 GPU 5，节点已自动 Cordoned 并进入 Remediation；受影响实例 2 个` |
| `扩缩容完成` | `HPA 触发扩容：平均 TTFT P99 4.2 s > 目标 1.5 s 持续 3 min，副本 3 → 6，预计月度成本 +$1,283` |
| `Pod 调度失败` | `Pod qwen-72b-0 Pending 6 min：0/64 节点满足 nvidia.com/gpu（每 Pod 需 8，最大可用节点余量 4）` |
| `训练变慢` | `检测 straggler：node-jp-042 step_time P99 3.42 s / P50 2.13 s = 1.61×，goodput 由 93% 降至 78%` |
| `费用变动` | `本月花费已达预算 82%（$4,100 / $5,000），按当前速率预计 10-24 触顶` |
| `网络抖动` | `InfiniBand mlx5_2 link down 8 s，all-reduce 开销由 12% 升至 43%，已切换到 mlx5_3` |
| `推理降级` | `KV cache 占用 93.4%，已触发请求排队（waiting 37），TPOT P99 升至 112 ms` |

### 9.3 事件密度与时序（SHOULD）

- 每个资源详情默认 **8 – 20 条**事件，覆盖：创建 → 首次就绪 → 配置变更 → 至少 1 次告警/自愈 → 最近操作。
- 事件必须**单调递增**且全部早于当前时间；同一 `correlationId` 的事件构成因果链（例如 `HPA_SCALE_UP` 与后续的 `SCALE_COMPLETE`）。
- Provisioning 阶段的事件**必须**与 `resource_provisioning_steps` 一一对应（ARCH §13），禁止两套时间互相矛盾。

### 9.4 弹性伸缩事件规范（`scaling_events`，ARCH §12.12）

> 伸缩事件是工作台·弹性伸缩页时间线与资源详情「弹性」Tab 的数据源；除满足 §9.1/§9.2 通用契约外，还须满足：

| 契约 | 要求 |
| --- | --- |
| **方向与数值自洽** | `scale_out` 必有 `to_size > from_size`，`scale_in` 反之；`to_size` 不得超出该策略 `min_size`/`max_size`（缩容后 ≥ min，含裸金属 warm floor ≥ 1） |
| **触发快照带度量** | `trigger_snapshot = { metric, value, target, windowS }`；`value` 与 §6.9 指标同窗口序列一致（G9：region 参与种子） |
| **耗时口径** | `duration_s` 按形态区分（§6.9：裸金属 300–1800s / 云服务器 60–300s / vGPU 30–120s / 推理 warm ≤5s、冷启动 30–720s）；`warm_pool_hit=true` 时 `duration_s ≤ 10` |
| **密度** | 每条生效策略默认 6–15 条事件，覆盖：创建后首次评估 → ≥2 次扩容 → ≥1 次缩容 → ≥1 次 `paused`/`resumed` 人工干预；时间倒序、全部早于当前时间 |
| **与计费联动可解释** | 扩容事件之后的小时用量行 `quantity` 必须变为 `to_size` 对应值（§7.7）；缩容事件后停止新增算力行 |
| **异常事件** | 允许 1 条失败事件（`reason` 非空，如"库存不足，回退至 H200_NVL"），体现 `fallback_enabled` 语义；禁止全部成功（违反 G7） |

---

## 10. 竞品设计映射（本规范的规则来源）

| 竞品（PRD §2 设计原则） | 借鉴点 | 落到本文件的位置 |
| --- | --- | --- |
| **阿里云 ECS/ACK** | 地域可用区→规格族→镜像→存储网络→确认的五段购买流；右侧费用明细；规格族命名 `gpu.8xh100.128c.1024g`；实例详情分区 Tabs；账单/用量/流水三表 | §6.8 字段映射（规格/镜像/网络/安全组字段的库表来源）；§7.7 计费派生三表；§4.1–4.3 单价与存储价（供费用明细逐项计算） |
| **火山引擎** | 可用区+VPC+安全组为购买前置；按量/包年包月/抢占式三计费模式；详情页摘要字段（实例 ID/规格/镜像/到期/计费方式）；费用中心三表 | §6.8 摘要卡字段来源；§4.4 三模式折扣；§7.7 用量明细与扣费流水结构 |
| **Lambda** | **整机（1 台 = 8 卡）裸金属采购语义**；1-Click Cluster 多节点整机下单；On-Demand/Reserved 两价 | §6.8 裸金属行（`machine_count` 台 / `unit='per_machine_hour'`）；§4.1 单价；§5.1 裸金属 8–20 min 供给时长 |
| **CoreWeave** Mission Control / CKS / SUNK | goodput、straggler 检测、拓扑感知、cordon/drain 与节点健康 | §6.6.2 goodput/MFU/straggler 定义与派生；§6.6.1 Xid 判据；§5.3 状态分布 |
| **RunPod** | Pod 卡片的 GPU% / VRAM% /累计费用；部署步序与秒级计费 | §6.2 算力概览卡四项；§4.1 单价；§7.1 费用派生与"预计可运行 X 小时" |
| **AutoDL** | 实例控制台（进程/资源面板）、按时/按量、关机仅收存储费 | §6.2 主机资源与进程 TOP；§4.3 块存储 $/GB·月；§6.2 闲置 > 2h 提醒 |
| **Vast.ai** | 复杂筛选与比价、可靠性评分、机器 `cuda/driver` 与磁盘/网络列 | §4.1 价格区间用于排序比价；§6.3 固件版本；§6.2 网络/磁盘列；节点可用性作为可靠性分 |
| **优云智算 / Nebius** | 镜像商城卡片、AI 应用一键部署、模型分类 | §8.1 `fixtures/images.ts` 与 `models.ts`；§6.5 模型→显存→单卡可行性校验 |
| **Modal** | 开发者体验、结构化日志流、冷启动、逐请求指标 | §6.5 结构化逐行日志契约；§5.1 推理冷启动（含权重加载派生）；§9.2 带 request_id 的事件 |

---

## 11. Mock → 真实 API 的切换约束（MUST）

1. **契约同源**：`mocks/schema` 的 Zod schema 必须与 ARCH §12 DDL 同构；时序类（§6 全部指标）**不属于 PG**，由独立的 `/api/metrics/*` 契约承载，未来指向 TSDB，不得混入业务实体接口。
2. **派生在后端**：§7 的派生日后应由后端/TSDB 计算；前端 `derive.ts` 仅用于 Mock。为避免双份逻辑，所有派生函数集中在一处，且在 `VITE_ENABLE_MOCK=false` 时**不得被调用**。
3. **单位不翻译**：接口一律使用本文件 §G3 的基础单位（KiB→MiB、ms/s 不自动换算），单位转换只在 UI 层格式化函数中发生。
4. **阈值不下放到前端**：告警阈值为产品配置，应由后端下发；Mock 阶段放在 `fixtures/thresholds.ts`，UI 只读消费，禁止组件内硬编码数字比较。

---

## 12. 验收清单（Mock 数据专项）

- [ ] `gpu-specs.ts` 每个字段可在 NVIDIA 官方口径下核对；若某值与第二来源冲突，已在注释标注所采口径。
- [ ] 四类资源的指标在列表、详情、图表三处**单位一致**（例如显存统一用 GB 展示、接口用 MiB），无混用。
- [ ] 详情页每个监控区块的指标均来自 §6 对应表，无自定义字段名。
- [ ] 所有金额类数值由 §7.1 派生；`cost_per_hour` 与 §4 单价、区域系数、折扣三者一致。
- [ ] `provisioning` 资源无任何运行时指标；`stopped` 资源 GPU 指标为空而非 0。
- [ ] 每个非 Ready 节点都有对应的 Xid / node_events 记录（§6.6.1）。
- [ ] 每条资源事件满足 §9.1 契约并携带 before/after 度量（§9.2）。
- [ ] `?fault=*` 六个场景均可触发且能在 15 min 内自愈。
- [ ] 开发模式下 `consistency.ts` 全部断言通过，控制台无 G8 红旗告警。
- [ ] 同一 seed 连续两次加载，所有 fixture 与历史曲线完全一致。
- [ ] 推理服务指标覆盖 vLLM 语义全集（TTFT/TPOT/e2e/KV cache/waiting/running/hit-rate/error-rate）。
- [ ] 集群 goodput ≤ 100%，MFU ≤ HFU，straggler 标记可由 P99/P50 复算得到。
- [ ] 所有派生公式有对应单测，且锚点校验（LLaMA-65B MFU≈47%）通过。
- [ ] **区域维度真实切换（G9）**：切换区域后，列表/供给/指标基线/成本数值**可见且自洽地变化**；同一资源跨区指标基线由 `region` 参与种子派生，禁止"切区域不变"。
- [ ] **顶部状态栏真实（PRD §3.2）**：余额/花费/运行中数均来自接口聚合，无写死常量；不展示写死延迟。
- [ ] **项目真实（§3.3）**：`project` 来自 `projects`，创建资源必选并写入 `project_id`；资源列表/成本可按 project 过滤；无写死 `PROJECTS[0]`。
- [ ] **裸金属按「台·小时」计（§7.1/ARCH §12.4）**：`gpu_baremetal` 计费 `unit='per_machine_hour'`、`quantity=machine_count`，不按 GPU·小时。
- [ ] **删除真实（§12.10）**：`DELETE /api/resources/:uuid` 置 `deleted_at` 软删并释放配额/停计；前端删除按钮调用该接口并失效缓存。
- [ ] **四区域已分配总卡数锚点（G11）**：`fixtures/resources.ts` 种子资源四区域 `gpu_count` 之和恒为 **1040**；一致性断言 `Σ gpu_count === 1040` 通过；总览「关键指标条」与「资源分布」矩阵两处求和口径一致，且代码/文案中**无 `1040` 字面量**（仅由派生求和得出）。

**资源来源与派生补充验收项**

- [ ] **详情页字段全部有来源（§6.8）**：PRD §4.3.1–4.3.4 的每个展示字段都能在 §6.8 查到 `DB:表.列` / `TSDB:指标键` / `ƒ()` 三种来源之一；**表中不存在的字段一律视为装饰性字段并删除**。
- [ ] **裸金属整机价不臆造**：`base_machine_rate` 取自 `billing_rates(unit='per_machine_hour')`，**代码里不得出现 `rate × 8`**；整机总卡数仅展示、不计费。
- [ ] **计费可复算**：详情页计费 Tab 四段（§7.8）的每个数字都能由 §7.7 从 `billing_usage` 复算得到；无独立于用量表的"展示金额"。
- [ ] **停止态与供给态计费正确**：`stopped` 只写存储行；`provisioning` 不写任何行且费用卡显示"尚未计费"而非 0；删除时最后一小时按秒折算。
- [ ] **项目种子真实**：`fixtures/projects.ts` 含 `isDefault` 的 default 项目；每条资源种子都有非空 `project_id`；删除有资源的项目返回 409。
- [ ] **区域×池矩阵生效**：`fixtures/pool-regions.ts` 落地；`GB300_NVL72` 仅 `us`、`B200_NVL72` 仅 `us/jp`、`B300` 仅 `us/sg`；切换区域后节点池可用量与列表条数**可见地变化**。
- [ ] **§8.3 全部断言通过**：含 v0.6 新增的 C1–C12 与"切区域数据指纹不同"断言；dev 控制台无 G8 红旗。
- [ ] **推理显存闸门**：创建推理服务时 `weights + kv + 2 ≤ 单副本卡数 × 单卡显存` 校验生效；70B BF16 单卡 80GB 场景被阻断。

**弹性伸缩、工作台、项目与国际化验收项**

- [ ] **弹性策略种子自洽**：`fixtures/scaling.ts` 每条策略满足 §9.4（方向数值自洽 / 快照带度量 / 耗时按形态 / 密度 6–15 条 / 含 1 条失败回退事件）；`strategy_model` 与绑定资源类型匹配（裸金属/vGPU/云服务器 → `node_pool`，推理 → `replica`）。
- [ ] **策略最小规模符合 PRD**：GPU 云服务器与裸金属 `node_pool.min_size ≥ 1`；推理服务仅当显式开启 `scale_to_zero` 并确认后允许 `replica.min_size=0`；vGPU 缩至零的语义未由 PRD 定义，不生成或展示该能力；一个资源最多一条 `status='active'` 策略。
- [ ] **伸缩指标可复算**：§6.9 全部指标键的值与 `trigger_snapshot` 可由 §6 指标字典复算；warm pool 命中率 ≥ 60%；裸金属冷启动事件 300–1800s。
- [ ] **下单预检含伸缩档**：开启弹性的下单按 `max_size` 校验配额，超限返回 `409 QUOTA_EXCEEDED`（与 ARCH §12.11 一致）。
- [ ] **Notebook 挂靠三类**：`notebooks.resource_kind ∈ {gpu_vm, gpu_baremetal, vgpu}`；每条 notebook 的 `resource_id` 指向同 region 的真实资源；删除 notebook 不删除宿主资源。
- [ ] **项目页聚合真实**：`/api/projects/:id/summary` 的 GPU/四类计数/本月成本/配额水位可由 fixtures 复算；默认项目 `isDefault=true` 不可删除。
- [ ] **i18n 覆盖（G10）**：en-US 下无控制台缺键 warn；组件无中文硬编码；枚举显示名只有字典一套；fixture 数据值经 `data.*` 段出英译；切语言不触发接口重取（locale 不入 Query key）。

---

## 13. 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.0 | 2026-10-17 | 初版。建立 Mock 数据真实值约束、硬件基线、价格与区域系数、四类资源与集群的指标字典、派生公式引擎、有意义事件规范、生成器与验收清单；同步 PRD / ARCHITECTURE / DESIGN-SYSTEM 交叉引用。 |
| **v1.1** | **2026-10-18** | **第二轮评审修订**：①新增 **§6.8 详情页字段→数据源→派生方式映射表**（四类 + 计费段），落实"引入数据库让 Mock 更真实"；②新增 **§7.7 计费派生**（逐小时用量行/汇总/扣费流水，支撑 PRD §7.8 四段）；③§7.1 按类型区分计费数量，新增 `base_machine_rate`（整机价，禁止 `rate×8`）；④§8.1 fixtures 新增 `pool-regions.ts`/`projects.ts`/`usage.ts`；⑤§8.3 断言扩充至 ARCH §12.10.3 的 C1–C12 与"切区域数据指纹必变"；⑥§10 竞品表补齐**阿里云 / 火山引擎 / Lambda / Nebius**；⑦§6.6 标题按新导航改为「运营&运维·节点基础设施层」；⑧§12 验收清单新增 8 项。 |
| **v1.4** | **2026-10-19** | 对齐当前 PRD：G11 定义为用户授权范围内未软删资源的实际 GPU 卡数求和，与配额占用、平台容量分离；区域筛选限定为区域维度数据；总览同屏覆盖四区域。 |
| **v1.3** | **2026-10-19** | 增加 G11 四区域已分配 GPU 卡数锚点及相应种子一致性校验。 |
| **v1.2** | **2026-10-19** | 增加国际化约束、弹性伸缩指标与事件规范，以及对应种子一致性校验。 |

## 15. 网络数据一致性（M7）

以 PRD §14、ARCHITECTURE §16 为现行网络契约。初始算力 21 个逻辑资源、1040 张卡保持不变。每个现有项目在 JP/TH/SG/US 各有默认 VPC、两台交换机及 default/ssh-only/web/restricted 安全组；仅 default 安全组受删除保护。默认 VPC CIDR 按区域选 10.16/10.32/10.48/10.64 的 /16，各项目完全隔离，允许重叠地址。

地址使用确定的首次可用地址扫描，跳过首地址和末尾三个保留地址。每个算力成员占一接口，vGPU 另计控制面。释放接口保留历史记录，下一次分配产生新接口身份；使用中的私网地址在同交换机内唯一。隧道网关也占一个私网地址并受相同依赖检查。

公网地址使用文档保留网段 198.51.100.0/24、203.0.113.0/24，不表示真实公网分配。500 个分配序号耗尽返回 EIP_POOL_EXHAUSTED。既有公网标志迁移为逐 VM 成员的独立 EIP，创建时间为迁移时刻，避免重记既有历史账单。

公网 IP 配额只计 `releasedAt=null` 的 EIP，包含空闲/停机绑定/隧道网关。后续 EIP 用量独立按小时桶、精确时长累计与余额流水对账；算力新账单排除 IP 计费行。EIP 在解绑/关机/删除算力后继续计费；账户欠费宽限到第 8 天释放 EIP 并停用相应隧道。历史账单、接口和审计保留。安全组、路由与启停均为配置模型，不生成真实连通指标。

PSK 只用于输入校验，无明文/密文快照字段，仅保留 pskConfigured。任何 API、存储序列化及审计内容均不可包含输入密钥。

区域网络额度（VPC / 交换机 / 安全组 / 隧道）：JP 20/100/100/20，TH 10/50/50/10，SG 20/100/100/20，US 30/150/150/30。EIP 沿用 16/8/12/32。用量来自有效实体；默认网络计入，已删除不计入。规则上限按单安全组 100 条校验；私网地址上限由交换机 CIDR 推导，独立于区域 EIP 配额。
