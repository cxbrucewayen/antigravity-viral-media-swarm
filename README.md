# Viral Media Swarm ($(System.Collections.Hashtable.Repo))

> **Viral Media · 爆款自媒体增长运营军团**

[![CI](https://github.com/cxbrucewayen/antigravity-viral-media-swarm/actions/workflows/ci.yml/badge.svg)](https://github.com/cxbrucewayen/antigravity-viral-media-swarm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org/)
[![Chassis](https://img.shields.io/badge/Chassis-antigravity--swarm--template%20v0.2.0-0F766E.svg)](https://github.com/cxbrucewayen/antigravity-swarm-template)

---

## Overview / 项目定位

基于 **Google Antigravity 2.0 原生 /swarm** 构建的全自动化自媒体账号运营与流量增长多智能体系统——以点赞、完播率与流量转化为核心指标，驱动选题洞察、数据复盘与增长迭代，并可联动 [ntigravity-lumiere-film-swarm](https://github.com/cxbrucewayen/antigravity-lumiere-film-swarm) 生产视频内容。

Built on the hardened **[ntigravity-swarm-template v0.2.0](https://github.com/cxbrucewayen/antigravity-swarm-template)** chassis (see [**ARCHITECTURE.md**](./ARCHITECTURE.md)):
- **Coexistence-Safe Routing & Scoped Hooks**: Strictly isolated to [swarm:viral-media-swarm], .viral-media-swarm/ownership.json, and PLUGIN_DATA (~1ms fast-path skip for unrelated chats and other Swarms).
- **Coordinator Immunity & Native 	asks[] Sharding**: Protects Coordinator writes while automatically mapping sharded workers (producer-1..k) to role ownership rules.
- **Multi-Turn & Filesystem-Verified Stop Gate**: Retains loaded role skills across swarm_wait revise loops, inspects both post_message and planner outputs, enforces 3-Strike circuit breakers, and verifies physical artifact creation on disk.

---

## Repository Layout / 目录结构

``text
antigravity-viral-media-swarm/
├── plugin/                                      # Antigravity 2.0 Plugin payload ($(System.Collections.Hashtable.Slug))
│   ├── plugin.json                              # Plugin manifest
│   ├── hooks.json                               # Scoped PreToolUse + Multi-Turn Stop Gate
│   ├── rules/AGENTS.md                          # Coexistence-safe domain trigger rule
│   ├── hooks/                                   # Zero-Trust ownership & delivery contract engine
│   └── skills/
│       ├── viral-media-swarm/                          # Coordinator orchestrator + brief-templates.md
│       ├── viral-media-swarm-planner/                  # Wave 1 scope & contract planner skill
│       ├── viral-media-swarm-producer/                 # Wave 2 parallel/sharded producer skill
│       └── viral-media-swarm-verifier/                 # Independent zero-trust auditor skill
├── scripts/validate-plugin.mjs                  # Official Antigravity spec & coexistence validator
├── tests/template-plugin.test.mjs               # 13-case automated unit & integration test suite
├── install.ps1 / install.sh                     # Global or workspace-scoped (-Workspace) installer
└── ARCHITECTURE.md                              # Protocol & multi-swarm coexistence specification
``

---

## Quick Start / 安装与验证

``powershell
# Validate plugin spec & run 13 automated tests
npm run validate
npm test

# Install globally (~/.gemini/config/plugins/viral-media-swarm)
pwsh -ExecutionPolicy Bypass -File .\install.ps1    # macOS/Linux: bash ./install.sh
``

Launch in **Google Antigravity 2.0**:
``text
/swarm 启动 viral-media-swarm 团队，帮我完成：【在此输入你的目标任务】
``

---

## Antigravity Swarm Ecosystem / 矩阵项目

| Repository | Domain |
| :--- | :--- |
| [antigravity-swarm-template](https://github.com/cxbrucewayen/antigravity-swarm-template) | Official-Spec Starter Template (`v0.2.0` Base Chassis) |
| [antigravity-gstack-swarm](https://github.com/cxbrucewayen/antigravity-gstack-swarm) | Full-Stack Software Engineering Team |
| [antigravity-eureka-research-swarm](https://github.com/cxbrucewayen/antigravity-eureka-research-swarm) | End-to-End Automated Scientific Research |
| [antigravity-accept-paper-swarm](https://github.com/cxbrucewayen/antigravity-accept-paper-swarm) | Paper Writing, Peer-Review Simulation & Rebuttal Revision |
| [antigravity-atlas-figure-swarm](https://github.com/cxbrucewayen/antigravity-atlas-figure-swarm) | Scientific System Overview & Paper Figure Generation |
| [antigravity-lumiere-film-swarm](https://github.com/cxbrucewayen/antigravity-lumiere-film-swarm) | Full-Pipeline AI Microfilm Studio |
| [antigravity-viral-media-swarm](https://github.com/cxbrucewayen/antigravity-viral-media-swarm) | Data-Driven Social Media Operations & Viral Growth |

## License

Released under the [MIT License](./LICENSE).