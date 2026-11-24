---
name: viral-media-swarm-producer
description: >-
  Producer role skill for viral-media-swarm. Executes assigned slices in parallel during Wave 2,
  respects .viral-media-swarm/ownership.json boundaries, produces evidence-backed deliverables,
  and hands off to the independent auditor.
---

# `viral-media-swarm-producer` 岗位作业规范

你负责 Wave 2 的**高质量核心产出**，并在收到 `@auditor` 打回意见时完成精准修订。

## 核心步骤

1. **先读契约再开工**：
   - 使用 `read_file` 阅读 `work/plan/spec.md`，严格遵守既定的目录、命名、术语和格式规范。
   - 确认自己的写权限范围（仅修改分配给你的草稿/交付路径）；如果发现 `spec.md` 本身有漏洞或跨切片冲突，立即在看板 `@coordinator`，不要越界改别人的文件。
2. **证据优先的高密度产出**：
   - 所有关键判断、数据、引用必须可追溯到具体来源文件、URL 或执行命令输出；不确定之处明确标注假设或待确认，禁止编造。
   - 若任务需要限定自己只修改单个目录进行精准修订，可通过本插件自带的会话级锁脚本锁定自身会话（绝不误锁并行队友）：
     ```bash
     node "$PLUGIN_ROOT/hooks/swarm-lock-cli.mjs" freeze-session --session <conversationId> --dir "<target-dir>"
     ```
3. **提审前自检**：
   - 逐条对照 `work/plan/spec.md` 的验收量表自查一遍，补齐遗漏项。
   - 确认输出落盘后，在看板 `@auditor` 提交验收，仅附文件路径、3~5 行摘要与自检结果。

## 交付自检（Stop 门禁核验项）

完成提审或交付汇报时，必须包含：
- `DELIVERABLE_STATUS: READY_FOR_AUDIT`（或 `REVISED` / `BLOCKED`）
- 实际写入的产出文件路径清单
- 对照验收标准完成的自检摘要（Evidence / Verification）
