# 运维手册

这组文档面向日常运行、恢复和排障，重点回答四个问题：

- 现在这套链路跑在哪里
- 平时怎么检查
- 出问题先看哪里
- 新机器怎样按同一目录结构恢复

## 索引

- [STATUS.md](./STATUS.md)
  - 总体运行状态、关键路径、已知约束
- [LLM-WIKI-STATUS-2026-04-09.md](./LLM-WIKI-STATUS-2026-04-09.md)
  - LLM-Wiki、PDF、GLM 手动模式、Windows 启动器的当前确认状态
- [STATION-STRUCTURE.md](./STATION-STRUCTURE.md)
  - 总站目录结构、职责分层、备份位置
- [RUNBOOK.md](./RUNBOOK.md)
  - 日常巡检与故障排查
- [LINUX-DEPLOYMENT.md](./LINUX-DEPLOYMENT.md)
  - `z001` 侧部署与远端目录说明
- [WINDOWS-MIRROR.md](./WINDOWS-MIRROR.md)
  - Windows 本地镜像、计划任务、启动代理
- [MANUAL-TRIGGERS.md](./MANUAL-TRIGGERS.md)
  - 手动归档、状态查询、镜像同步
- [NEW-MACHINE-DEPLOYMENT.md](./NEW-MACHINE-DEPLOYMENT.md)
  - 新机器按总站结构恢复现有能力
- [PDF-AUTO-SYNC.md](./PDF-AUTO-SYNC.md)
  - PDF 自动同步策略和计划任务
- [GLM-MANUAL-MODE.md](./GLM-MANUAL-MODE.md)
  - GLM Coding Plan 手动触发说明
- [ZJU-INSTITUTIONAL-PDF-LOGIN.md](./ZJU-INSTITUTIONAL-PDF-LOGIN.md)
  - 机构登录场景下的 PDF 获取流程

## 运维原则

- 线上生产源始终是 `z001`
- Windows 是总站和消费端，不是生产数据库
- AI 主库只认 `WeWe-RSS-AI/`
- `Feeds/` 只保留兼容，不再作为 AI 正文主库
