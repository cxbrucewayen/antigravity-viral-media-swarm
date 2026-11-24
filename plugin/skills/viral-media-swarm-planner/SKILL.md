---
name: viral-media-swarm-planner
description: >-
  Planner role skill for viral-media-swarm. Defines scope, output schemas, task sharding slices,
  verification rubrics, and the declarative .viral-media-swarm/ownership.json file-boundary matrix
  during Wave 1.
---

# `viral-media-swarm-planner` 岗位作业规范

你负责 Wave 1 的**范围收敛、契约锁定与目录切分**，让 Wave 2 的并发 Worker 能够零冲突、高确定性地并行推进。

## 核心步骤

1. **澄清与收敛范围**：
   - 提炼核心目标、非目标（Out of Scope）、目标受众与约束条件。
   - 若存在必须由人类拍板的重大歧义，在看板 `@coordinator` 请求确认，不要擅自脑补关键业务假设。
2. **输出规划与契约文档（`work/plan/spec.md`）**：
   - **交付清单**：明确每个最终产出文件的路径、章节结构与必填字段。
   - **切片表（Sharding Plan）**：拆出互相独立的子任务（可直接作为 Coordinator 调用 `swarm{action:"add", name:"producer", tasks:[...]}` 的输入数组），并规定每个切片的独占文件名（如 `work/drafts/slice-1.md`、`work/drafts/slice-2.md`）。
   - **验收量表（Rubric）**：写明 `auditor` 放行必须满足的客观通过条件（例如：覆盖率、引用要求、禁止项、最低得分线）。
3. **落盘声明式目录权限表（`.viral-media-swarm/ownership.json`）**：
   - 按实际目录结构写入白名单 `allow` 与黑名单 `deny`，例如：
     ```json
     {
       "lead-planner": { "allow": ["work/plan/**", ".viral-media-swarm/**"], "deny": ["work/deliverables/**"] },
       "producer": { "allow": ["work/drafts/**", "work/deliverables/**"], "deny": ["work/reviews/**", ".viral-media-swarm/**"] },
       "auditor": { "allow": ["work/reviews/**"], "deny": ["work/drafts/**", "work/deliverables/**"] }
     }
     ```
   - 注意：对于通过 `tasks` 分片创建的 `producer-1`、`producer-2`，锁引擎会自动回退匹配 `"producer"` 规则；如需为单个分片再收窄到独立文件，也可显式写出 `"producer-1": { "allow": ["work/drafts/slice-1.md"] }`。

## 交付自检（Stop 门禁核验项）

完成前必须确认输出中包含：
- `PLAN_STATUS: READY`（或 `PLAN_STATUS: NEEDS_INPUT`）
- `work/plan/spec.md` 与 `.viral-media-swarm/ownership.json` 的实际文件路径
- 建议的 Wave 2 并行切片清单
