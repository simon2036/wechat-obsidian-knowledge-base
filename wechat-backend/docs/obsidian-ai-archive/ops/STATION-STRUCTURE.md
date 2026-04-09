# 总站结构

## 目标

把代码、知识库、远端备份统一收敛到同一个总站目录，避免继续分散在多个盘符和多个老项目目录里。

## 固定目录

```text
D:\opt\app\wechat-obsidian-knowledge-base\
  wechat-backend\
  obsidian-knowledge-base\
  backups\
    z001-source\
    z001-deploy\
```

## 角色划分

### `wechat-backend`

- 主代码仓
- 对应 GitHub 仓库 `simon2036/wechat-obsidian-knowledge-base`
- 包含微信公众号订阅、刷新、feed、全文归档、部署脚本、Windows 镜像脚本、运维文档

### `obsidian-knowledge-base`

- 独立 Git 仓库
- 保存实际 vault 数据
- `WeWe-RSS-AI/` 是唯一 AI 主库
- 不并入 `wechat-backend` 主仓库，避免把大体量知识库数据混进代码仓

### `backups\z001-source`

- 备份远端 `/home/ifs1/app/wewe-rss-src`
- 这是运行源码副本，不是 Git 仓库
- 用于灾备、对照和离线检视

### `backups\z001-deploy`

- 备份远端 `/home/ifs1/app/wewe-rss-stack/deploy/z001`
- 保存 `.env`、`docker-compose.yml`、`feeds.json` 等部署资产

## 恢复顺序

1. 先恢复 `wechat-backend`
2. 再恢复 `obsidian-knowledge-base`
3. 然后确认 `backups` 可读
4. 最后验证 `z001` 远端运行状态

## 为什么这样拆

- 代码和知识库生命周期不同，应该分仓管理
- Windows 作为总站，应该是统一入口，但不应该把所有东西塞进同一个 Git 仓库
- 远端线上路径第一阶段保持不改名，降低运行风险
