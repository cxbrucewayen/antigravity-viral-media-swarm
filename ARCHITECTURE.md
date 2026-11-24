# Architecture & Antigravity `/swarm` Adaptation Guide

本文档沉淀了在 **Google Antigravity 2.0** 上从零构建多个可共存垂直领域 Agent Swarm 插件的完整架构规范、官方契约细节与避坑清单。

---

## 1. Native `/swarm` Protocol vs. Plugin Layer（分层职责）

开发 Antigravity Swarm 时，**不要重造通信和调度轮子**。原生协议与自定义插件的分层边界如下：

| 层级 | 负责方 | 职责 |
| :--- | :--- | :--- |
| **调度与看板协议层** | **Antigravity 原生 `/swarm`** | Worker 创建与销毁（`swarm` 工具的 `add`/`status`/`model`/`kill`/`title`）、共享看板（`@mention`、`post_message`、`read_board`、`swarm_wait`）、Git 副本隔离（`workspace: "inherit" \| "share" \| "branch"`）、同质分片（`tasks` / `n`）、Overview UI（`swarm_pane` + `plan.json`）与防卡死巡检（`swarm_monitor`）。 |
| **组织编制与 SOP 层** | **Plugin `skills/` + `rules/`** | 定义领域专属的岗位清单、Wave 分波次流转、自包含 `brief` 派单模板，以及每个角色的专业方法论。 |
| **领域工具接入层** | **Plugin `mcp_config.json`（可选）** | 为该领域接入数据源/外部 API/文档工具（服务名必须加 `<plugin-slug>-` 前缀）。 |
| **零信任隔离与门禁层** | **Plugin `hooks.json` + `hooks/*.mjs`** | 补齐原生 `/swarm` 没有提供的跨角色文件写锁（`PreToolUse`）和交付契约防漏检（`Stop`）。 |

---

## 2. Official Antigravity Plugin Spec Constraints（官方硬规范）

本模板自带的 `npm run validate`（[scripts/validate-plugin.mjs](./scripts/validate-plugin.mjs)）会自动校验以下所有官方限制：

1. **`plugin.json` 严格字段白名单**：
   - 仅支持 `name`、`displayName`、`version`、`description`、`logo`、`suggestedPrompts`、`author`、`homepage`、`repository`、`disabled`。
   - **禁止添加自定义顶层字段**（加载器会静默丢弃，不会报错）。
   - `name` 必须全局唯一且为小写 kebab-case；两个插件重名时，后发现的会被**静默丢弃**。
   - `logo` 必须为插件内相对路径（`.svg/.png/.jpg/.jpeg/.webp`），方形 ≥ 128×128、透明底、自带 ~10% 安全留白。
   - `suggestedPrompts` 最多 3 条（超出部分会被忽略）。
2. **`rules/AGENTS.md` 预算与格式**：
   - 必须是**纯 Markdown，严禁带 YAML frontmatter**。
   - 只要插件处于启用状态，`rules/AGENTS.md` 就**全局常驻**；单文件上限 `24 KB`，所有全局/插件规则共享 `20,000 tokens` 预算。
   - **最佳实践**：保持在 `1 KB` 以内，只写“何时触发本插件总控 Skill”，所有长篇 SOP 全放进渐进披露的 `skills/*/SKILL.md` 与 `references/` 中。
3. **`hooks.json` 位置与事件结构**：
   - 原生插件**必须把 `hooks.json` 放在插件根目录**（不能放 `hooks/hooks.json`）。
   - `PreToolUse` / `PostToolUse` 必须是**分组结构** `[{ "matcher": "write_file|edit_file", "hooks": [{ "type": "command", "command": "..." }] }]`。
   - `SessionStart` / `PreInvocation` / `PostInvocation` / `Stop` 必须是**扁平数组** `[{ "type": "command", "command": "..." }]`。
   - 运行 Hook 时工作目录固定为 `hooks.json` 所在插件根目录，且官方自动注入 `PLUGIN_ROOT` 和 `PLUGIN_DATA` 环境变量。
4. **MCP 命名空间**：
   - 所有已启用插件的 MCP Server 共享同一全局命名空间，因此必须在 `mcp_config.json` 中用 `<plugin-slug>-` 作为服务名前缀。

---

## 3. Multi-Swarm Coexistence Architecture（多 Swarm 并存防打架设计）

当一台机器上同时安装 3~5 套不同领域的 Swarm（例如软件研发 `gstack-swarm` + 深度调研 `research-swarm` + 内容生产 `content-swarm`）时，必须遵守以下 4 条架构铁律：

### 3.1 禁止无条件抢占 `/swarm`
- 错误做法：在 `rules/AGENTS.md` 里写“只要 `/swarm` 激活就立刻加载本插件”。
- 正确做法（本模板默认实现）：
  - 在 `rules/AGENTS.md` 中声明**严格领域触发条件**（仅当用户点名 `<slug>` 或任务明确属于该领域关键词时才激活；点名其它 Swarm 时主动让权）。
  - 或者按项目维度，用 `./install.ps1 -Workspace <项目路径>` 把垂直领域插件装到 `<project>/.agents/plugins/<slug>`，完全不污染全局。

### 3.2 Hook 必须做“毫秒级作用域短路”
- Antigravity 会把所有已启用插件的同事件 Hook **合并后同步串行执行**，每次工具调用都会阻塞等待。
- 本模板的 [lib-swarm-scope.mjs](./plugin/hooks/lib-swarm-scope.mjs) 采用**四重命名空间隔离**：
  1. 状态目录隔离：优先写入官方 `PLUGIN_DATA`，回退至 `~/.antigravity-swarms/<slug>/`，绝不与其他插件共享状态目录。
  2. 显式会话标记：所有派单模板首行自带 `[swarm:<slug>]`。
  3. 项目权属文件隔离：仅识别当前工作区内的 `.<slug>/ownership.json`。
  4. **极速短路**：若既无本插件的会话锁/冻结，又无 `.<slug>/ownership.json`，且 `transcriptPath` 不含 `[swarm:<slug>]` 或本插件 `SKILL.md` 路径，立刻在 ~1ms 内返回 `{"decision":"allow"}`。

### 3.3 角色命名避让全局已有插件
- 若本机同时启用了基于 `gstack-swarm` 的研发插件，其内置全局角色守卫会匹配 `pm-*`、`qa-*`、`reviewer*`。
- 新领域 Swarm 推荐使用清晰且不碰撞的岗位名（如本模板默认的 `lead-planner`、`producer`、`auditor`，或带领域前缀的 `res-planner`、`res-analyst`、`res-auditor`）。`npm run validate` 会自动检测并提醒潜在撞名。

### 3.4 原生分片 Worker（`tasks` / `n`）自动继承权限
- 使用 Antigravity 原生 `swarm{action:"add", name:"producer", tasks:["A","B","C"]}` 时，系统会创建 `producer-1`、`producer-2`、`producer-3`。
- 本模板的锁引擎查找权属表时按 `map["producer-1"]` → `map["producer"]` 自动回退，既支持整组统一权限，也支持对单个分片精细收窄到独立文件。

---

## 4. When to Choose `/swarm` vs. `run_workflow` vs. `invoke_subagent`

并不是所有多智能体任务都应该做成 `/swarm` 插件：

| 协作形态 | 推荐原生机制 | 典型场景 |
| :--- | :--- | :--- |
| **多角色协商、打回返工、人类中途插话** | **`/swarm` 插件（本模板）** | 规划 → 生产 ↔ 独立核验/审校、0-to-1 产品研发、复杂深度研报、攻防对抗审查 |
| **固定 DAG 管道 / 大规模确定性 Map-Reduce** | **`run_workflow`（Python 编排脚本）** | 批量解析 50 份 PDF 并聚合字段、固定三阶段静态扫描、大规模批量迁移脚本 |
| **单次独立委派任务** | **`invoke_subagent`** | 单次代码库深查（`research`）、单次真机网页交互（`browser`）、单次生图（`image-generator`） |

---

## 5. Stop Gate Safe-Loop Checklist（防死循环检查清单）

编写或改造 [stop-gate.mjs](./plugin/hooks/stop-gate.mjs) 时，务必保留以下 5 个退出条件，否则容易把 Agent 锁死在无限重试里：

1. `payload.continuationActive === true` → 必须放行（本回合已经因为 `Stop` 钩子续跑过一次）。
2. `payload.terminationReason !== 'NO_TOOL_CALL'` → 必须放行（异常/取消/达到上限时绝不强行续跑）。
3. `payload.fullyIdle === false` → 必须放行（还有后台任务在跑）。
4. 本回合调用了 `ask_question` / `swarm_wait`，或回复以问号 / `NEEDS_INPUT` / `BLOCKED` 结尾 → 必须放行。
5. 未加载本插件对应的角色 `SKILL.md` → 必须放行（确保绝不误拦普通对话或其他 Swarm 插件）。
