# Linux / z001 部署说明

## 定位

Linux 侧不是只跑一个 `wewe-rss` 容器，而是整条生产链路：

- `wewe-rss` 应用
- 数据库
- 反向代理
- `bridge`
- `obsidian-archive`
- vault git worktree / bare repo

## 当前生产主机

- 主机：`z001`
- 归档侧车：`obsidian-archive`
- 主库工作树位于 vault 内

## 各组件职责

### `wewe-rss`

- 管理 WeRead 登录
- 获取公众号文章列表
- 输出 RSS / Atom / JSON

### `bridge`

- 继续提供旧兼容链路
- 不再作为 AI 主库的唯一正文来源

### `obsidian-archive`

- 拉取 JSON feed
- 判定正文质量
- 必要时回抓原文页
- 写 Markdown 和 raw JSON
- 更新状态文件
- 在启用时提交并推送 vault 仓库

### vault repo

- worktree 负责远端写盘
- bare repo 负责给 Windows 镜像拉取

## 重要路径

- 远端部署目录：
  - `/home/ifs1/app/wewe-rss-stack/deploy/z001`
- 远端 source 目录：
  - `/home/ifs1/app/wewe-rss-src`
- 远端 vault worktree：
  - `/home/ifs1/app/wewe-rss-stack/data/obsidian/worktrees/folo-rss-vault`
- 远端 bare repo：
  - `/home/ifs1/app/wewe-rss-stack/data/obsidian/repos/folo-rss-vault.git`

## 运维原则

- `obsidian-archive` 和主服务职责分离
- worktree 必须是持久化存储
- `WeWe-RSS-AI/` 必须纳入 Git mirror 链路
- 整库重写优先使用 detached 模式，避免 SSH 长时间阻塞
