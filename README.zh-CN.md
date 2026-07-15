# pi-git-shortcuts

[English](./README.md) | **简体中文**

为 [Pi coding agent](https://pi.dev) 提供不污染主会话上下文的 Git 快捷指令。

`pi-git-shortcuts` 使用隔离的内存 Agent Session 生成 commit message 和解决 rebase 冲突。模型可以协助 Git 操作，但相关 prompt、tool call 和结果都不会进入主会话上下文。

## 指令

### `/commit [附加要求]`

暂存工作区的全部变更，使用隔离 Agent 生成 Conventional Commit message，校验返回结果并创建 commit。

```text
/commit
/commit 使用 docs scope
/commit 使用中文提交信息
```

### `/cp [附加要求]`

提交变更并推送当前分支。

```text
/cp
/cp 准确描述这次认证修复
```

push 流程：

1. 复用 `/commit` 流程。
2. 推送当前分支。
3. 没有 upstream 时执行 `git push -u origin <branch>`。
4. 遇到 non-fast-forward 拒绝时执行 `git pull --rebase`。
5. rebase 出现冲突时启动隔离的冲突解决 Agent。
6. 继续 rebase 并重试 push。

如果自动冲突解决失败，仓库会保留正在进行的 rebase 状态，方便人工恢复。插件不会静默 reset 或 abort 你的工作。

## 上下文隔离

该插件刻意采用 command-only 设计：

- 仅通过 `pi.registerCommand()` 注册 `/commit` 和 `/cp`。
- 不注册 LLM tool。
- 不调用 `sendUserMessage()` 或 `sendMessage()`。
- 不向 session 追加 entry。
- 模型任务使用 `SessionManager.inMemory()`。
- 进度和结果仅通过 Pi UI 通知显示。

生成 commit message 的 Agent 没有任何工具。解决冲突的 Agent 仅拥有以下仓库文件工具：

```text
read, edit, grep, find, ls
```

它不能执行 shell 或 Git 命令。rebase 状态完全由 extension 控制。

## 安全策略

- `/commit` 使用 `git add -A` 暂存全部变更。
- 模型生成的提交信息必须符合 Conventional Commit 格式。
- commit header 最长 72 个字符。
- detached HEAD 不会被自动推送。
- 仅在已有 `origin` remote 时自动创建 upstream。
- 自动 rebase 冲突解决最多执行 20 轮。
- 冲突解决失败时保留当前 rebase 状态，不执行破坏性恢复。

## 安装

### GitHub

```bash
pi install git:github.com/LuckyYunPeng/pi-git-shortcuts
```

### 本地开发

```bash
pi install /absolute/path/to/pi-git-shortcuts
```

修改本地源码后，在 Pi 中执行 `/reload`。

## 开发

```bash
npm install
npm run check
```

## 包结构

```text
pi-git-shortcuts/
├── src/
│   ├── agent.ts      # 隔离模型会话
│   ├── commands.ts   # /commit 和 /cp 流程
│   ├── git.ts        # Git helper 和校验
│   └── index.ts      # Pi extension 入口
├── test/
├── README.md
├── README.zh-CN.md
└── package.json
```

## 致谢

隔离生成 commit message 的思路参考了 [`tmonk/pi-committer`](https://github.com/tmonk/pi-committer)。`pi-git-shortcuts` 刻意保持更小的 command-only 功能面，专注显式快捷指令和主上下文隔离。

## 许可证

MIT，详情见 [LICENSE](./LICENSE)。
