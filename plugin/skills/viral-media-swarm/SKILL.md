---
name: viral-media-swarm
description: >-
  Orchestrator skill for the "viral-media-swarm" multi-agent team on Antigravity native /swarm.
  Use ONLY when /swarm is active and the user explicitly invokes viral-media-swarm or requests
  work in this plugin's target domain. Coordinates Wave 1 planning/contract locking,
  Wave 2 parallel or sharded production, independent verification, and scoped file-ownership hooks.
---

# `viral-media-swarm` 多智能体编排总控规范（Antigravity Native `/swarm` Template）

> **模板改造提示**：将本文中的 `viral-media-swarm`、领域说明、角色清单和验收标准替换为你的目标业务领域（也可以直接运行仓库根目录的 `npm run scaffold` 一键生成新插件）。

你当前是 Antigravity 原生 `/swarm` 会话的 **Swarm Coordinator（总控）**。本插件建立在 Antigravity 原生 `/swarm` 协议之上，**不替代原生看板与工具**，而是为原生多智能体协作提供标准岗位编制、分波次契约、命名空间隔离锁和交付门禁。

---

## 一、原生 `/swarm` 协议铁律（所有领域通用）

1. **绝不擅自启动 `/swarm`**：只有在用户显式通过 `/swarm` 启动会话时才调用 `swarm` 工具；若任务属于固定批量流水线且无需角色间反复协商打回，优先考虑 `run_workflow` 而非 `/swarm`。
2. **首轮启动四件套（Title + Workers + Overview UI + `open_board`）**：
   - 先调用 `swarm{action:"title", title:"<简明任务标题>"}` 为本次 Swarm 命名。
   - 阅读内置 `swarm_pane` 技能，在拉起首批 Worker 后立即写入 `<appData>/brain/<conversation-id>/.system_generated/swarm/plan.json`（含 `goal`、`tasks`、`threads`），驱动右侧 Swarm Overview 面板展示实时分组进度。
   - 若技能列表中有 `swarm_monitor`，同步拉起一个 `monitor`（不要默认拉起 `narrator`，除非用户点名）。
   - **视觉时间线联动（适用于作图 / 分镜 / UI 等可视化任务）**：通知产出预览图的 Worker 将图片存放在其自身的 `<appData>/brain/<worker-conversation-id>/` 目录下，并在看板发帖单起一行附 `Screenshot: <绝对路径> | <10字内改动说明>`，Overview 面板会自动渲染演化时间线（纯文本/数据任务跳过此项）。
   - **透传 `open_board` 卡片**：首轮回复用户的最末尾一行，**必须原样输出**最新一次 `swarm{action:"add"}` 或 `status` 返回的 `open_board` 字符串（切勿手写看板链接），随后立即结束本轮回合（`post_message`/`read_board`/`swarm_wait` 会在下一轮自动挂载）。
3. **Worker 创建与命名规范（多 Swarm 防冲突）**：
   - `name` 必须小写、字母或数字开头、最多 24 字符（`a-z0-9-_`），禁止使用 `all`、`coordinator`、`coordinator-*`。
   - **避免与其它全局插件撞名**：例如全局已装 `gstack-swarm` 时，其全局钩子会拦截 `pm-*`、`qa-*`、`reviewer*` 写源码；本模板默认使用清晰且不易碰撞的领域岗位名（如 `lead-planner`、`producer`、`auditor`），或加领域前缀（如 `res-planner`、`res-analyst`、`res-auditor`）。
   - **每个 Worker 的 `brief` 必须包含本插件隔离标记 `[swarm:viral-media-swarm]`**（放在首行），以便本插件的 `PreToolUse` / `Stop` 钩子精准识别会话归属，同时对其它 Swarm 或普通对话保持零干扰！
   - **`brief` 必须完全自包含**：Worker 默认空白上下文启动（看不到主对话历史），必须在 `brief` 中写明：加载哪个岗位 `SKILL.md`、输入文件路径、独占输出目录、完成标准，以及完成后 `@mention` 谁。仅在确实需要继承历史时使用 `fork: "coordinator"`。
   - **保留 `model` 留空**：默认继承用户当前选择的模型，除非用户明确要求给特定岗位换模型。
4. **善用原生 `tasks` / `n` 并行分片**：
   - 当存在多个同质独立子任务（例如调研 5 个竞品、分析 4 份财报、撰写 6 个章节）时，直接传 `swarm{action:"add", name:"producer", tasks:["子任务1", "子任务2", ...]}`。
   - Antigravity 会自动拉起 `producer-1` ~ `producer-k`，且本插件的 `ownership.json` 锁引擎会自动将 `producer-1` 映射匹配到 `producer` 的目录规则！
5. **按需选择 `workspace` 隔离模式**：
   - 文档/调研/分析/运营/内容创作等按目录隔离的协作：保持默认 `workspace: "inherit"`，由 `.viral-media-swarm/ownership.json` 钩子锁死各岗位写目录即可。
   - 仅当多个 Worker 必须**并发修改同一 Git 仓库代码并运行构建测试**时，才使用 `workspace: "share"`（共享对象库独立工作副本）或 `workspace: "branch"`；且在 `swarm{action:"kill"}` 前务必先合回改动（`kill` 会永久删除其工作副本）。
6. **事件驱动、3-Strike 返工熔断与优雅收尾**：
   - 首轮 `add` 完首批 Worker 并输出 `open_board` 后立即结束回合，等待看板消息自动唤醒，**禁止轮询**。
   - **3-Strike 返工熔断机制（`MAX_REVISION_ROUNDS = 3`）**：`@producer` 与 `@auditor` 针对同一分片的打回修改最多不超过 **3 轮**；若第 3 轮复审仍未通过，`@auditor` 严禁发起第 4 轮死磕，必须发送 `@coordinator [escalate]` 附分歧焦点由总控或人类拍板，防止无限循环耗尽配额。
   - 看板传参坚持“**文件路径 + 3~5 行摘要 + `#seq` 引用**”，禁止把几千字大段正文直接粘贴进看板消息。
   - 全部验收通过并汇总前，在看板发一条**不含任何 `@`** 的 `[done] <最终总结>` 让 `monitor` 休眠，并清理本会话临时锁。

---

## 二、标准岗位编制与角色分工（按需增删改名）

完整自包含派单模板见 [brief-templates.md](./references/brief-templates.md)。

| Worker 角色名 | 职责定位 | 加载技能 | 默认写权限（`.viral-media-swarm/ownership.json`） | 核心交付物 |
| :--- | :--- | :--- | :--- | :--- |
| `lead-planner` | 需求收敛与总控规划员 | `viral-media-swarm-planner` | `work/plan/**`、`.viral-media-swarm/**`（禁改 `work/deliverables/**`） | 任务规格书、切片计划、`.viral-media-swarm/ownership.json` |
| `producer`（或 `tasks` 分片 `producer-1..k`） | 并行执行 / 生产专家 | `viral-media-swarm-producer` | `work/drafts/**`、`work/deliverables/**` | 章节/调研/分析/策略等核心产出 + 来源证据 |
| `auditor` | 独立核验 / 审校官 | `viral-media-swarm-verifier` | `work/reviews/**`（零信任禁止直接修改生产目录） | 结构化核验报告、缺陷清单与放行结论 |
| `monitor` | 看板防卡死巡检员 | `swarm_monitor` | 只读 | 定时检测静默并唤醒阻塞节点 |

---

## 三、两波次零冲突推进流（Wave 1 → Wave 2）

```text
Wave 1（规划锁死契约）
  Coordinator ──add──► @lead-planner
                           │
                           ├─ 产出 work/plan/spec.md（目标、边界、验收口径、切片表）
                           ├─ 产出 .viral-media-swarm/ownership.json（锁死 Wave 2 各角色读写目录）
                           └─ @coordinator [done]

Wave 2（并行生产 ◄──► 独立核验闭环）
  Coordinator ──add──► @producer (或 tasks 分片 producer-1..k) + @auditor
                           │
                           ├─ @producer 按 spec 产出至 work/drafts/ & work/deliverables/
                           │    └─ 完成后 @auditor（附文件路径与自检摘要）
                           ├─ @auditor 独立核验（Hook 禁止直接改产出，防双写冲突）
                           │    ├─ 未达标 ──► @producer 精准指出问题并打回返工
                           │    └─ 达标   ──► 写入 work/reviews/audit-report.md 并 @coordinator [done]
                           └─ Coordinator 汇总最终交付物，发无 @ 的 [done] 结束 Swarm
```

---

## 四、快速定制清单（基于本模板开发新 Swarm 时）

1. 在 `plugin/skills/viral-media-swarm/SKILL.md` 中替换领域背景、岗位表与波次图。
2. 在 `plugin/skills/viral-media-swarm/references/brief-templates.md` 中完善每个岗位的自包含派单模板（**保留首行 `[swarm:<slug>]` 标记**）。
3. 在各岗位子目录 `plugin/skills/<slug>-<role>/SKILL.md` 中填入领域专业方法论、禁止事项和输出格式模板。
4. 在 `plugin/hooks/lib-swarm-scope.mjs` 与 `plugin/hooks/stop-gate.mjs` 中调整：
   - 零信任角色不变量（哪些角色天生不可写最终产出目录）；
   - `Stop` 钩子的必填交付证据正则（防止 Worker 漏交核心章节或评分结论）。
5. 运行 `npm run validate && npm test` 确认符合 Antigravity 官方规范且与其它插件完全隔离。
