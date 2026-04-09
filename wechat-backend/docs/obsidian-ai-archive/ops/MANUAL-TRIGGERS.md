# 手动触发

## 远端归档一次

在 `wechat-backend` 根目录执行：

```powershell
pnpm archive:obsidian:once
```

或直接调用脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-z001-obsidian-archive-once.ps1
```

## 查看远端归档状态

```powershell
pnpm archive:obsidian:status
```

## 后台启动整库重写

```powershell
pnpm archive:obsidian:repair-all
```

## 查看后台整库重写状态

```powershell
pnpm archive:obsidian:repair-all:status
```

## 手动同步 Windows 本地镜像

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-z001-obsidian-vault.ps1
```

## 兼容链路说明

`bridge` 仍然保留兼容链路，但不再是 AI 主库唯一来源。只有在兼容问题排查时才需要关注它。
