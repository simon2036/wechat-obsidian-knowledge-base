# Windows 本地镜像

## 目标

Windows 这台机器是总站和本地消费端，不是生产源。

职责：

- 保存 `z001` 远端 bare repo 的本地镜像
- 为 Obsidian 提供固定打开路径
- 为 Codex Desktop / CLI 提供本地读取入口

## 关键路径

- 总站根目录：`D:\opt\app\wechat-obsidian-knowledge-base`
- vault 根目录：`D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base`
- AI 主库：`D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base\WeWe-RSS-AI`

## 首次同步

在 `wechat-backend` 根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-z001-obsidian-vault.ps1
```

如果库较大，首次建议：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-z001-obsidian-vault.ps1 -Shallow
```

## 自动同步

### 计划任务

```powershell
pnpm archive:obsidian:mirror:install
pnpm archive:obsidian:mirror:status
pnpm archive:obsidian:mirror:run
pnpm archive:obsidian:mirror:uninstall
```

### 无管理员权限时的启动代理

```powershell
pnpm archive:obsidian:mirror:startup:install
pnpm archive:obsidian:mirror:startup:status
pnpm archive:obsidian:mirror:startup:run
pnpm archive:obsidian:mirror:startup:uninstall
```

## 使用原则

- Windows 保持只读镜像思路
- 不把 Windows 当作生产数据库
- 人工检查正文时优先看 `WeWe-RSS-AI`
- 不再把 `Feeds\` 当作 AI 正文主库

## 常用检查

- `git -C D:\opt\app\wechat-obsidian-knowledge-base\obsidian-knowledge-base status`
- `pnpm archive:obsidian:mirror:status`
- `pnpm archive:obsidian:status`

## 相关脚本

- [sync-z001-obsidian-vault.ps1](../../../scripts/sync-z001-obsidian-vault.ps1)
- [manage-z001-obsidian-mirror-task.ps1](../../../scripts/manage-z001-obsidian-mirror-task.ps1)
- [manage-z001-obsidian-mirror-agent-startup.ps1](../../../scripts/manage-z001-obsidian-mirror-agent-startup.ps1)
