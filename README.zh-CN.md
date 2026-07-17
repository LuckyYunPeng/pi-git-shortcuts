# pi-git-shortcuts

[English](./README.md) | **简体中文**

为 [Pi coding agent](https://pi.dev) 提供不污染主会话上下文的 Git 快捷指令。

`pi-git-shortcuts` 使用隔离的内存 Agent Session 生成 commit message 和解决 rebase 冲突。模型可以协助 Git 操作，但相关 prompt、tool call 和结果都不会进入主会话上下文。

- `/commit`：暂存全部变更并创建 AI 生成的 Conventional Commit。
- `/pull`：拉取并 rebase 当前分支，冲突时由隔离 Agent 协助解决。
- `/push`：只推送当前分支，不创建 commit。
- `/cp`：一次完成 commit 和 push。
- `/git-shortcuts-config`：选择英文或简体中文 commit message。
- non-fast-forward push 可自动 rebase，并由仅具备文件工具的隔离 Agent 解决冲突。
- 临时进度面板展示全部 Git 和模型阶段，不污染 session。

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

### `/pull`

拉取并 rebase 当前分支。如果 rebase 出现冲突，会启动仅具备文件工具的隔离 Agent 解决冲突，然后由 extension 继续 rebase。

```text
/pull
```

存在 upstream 时使用已配置的 upstream；没有 upstream 时拉取 `origin/<当前分支>`，但不创建 tracking 配置。该命令不会自动 stash 未提交变更。如果 Git 因本地修改拒绝 pull，命令会停止并保持工作区不变。

### `/push`

推送当前分支，不暂存变更，也不创建 commit。

```text
/push
```

没有 upstream 时会自动创建；远端分支领先时，复用 `/cp` 的 rebase 和隔离冲突解决流程。现有未提交工作区变更不会被修改，除非 Git 本身因为这些变更而拒绝 rebase。

### `/git-shortcuts-config`

打开模型生成 commit message 的语言选择器：

```text
English
简体中文
```

默认使用英文。选择会立即生效，并全局持久化到：

```text
~/.pi/agent/pi-git-shortcuts.json
```

选择中文时，Conventional Commit 的 type 和可选 scope 保持英文，description 和 body 使用简体中文。

## 进度界面

执行 `/commit`、`/cp`、`/pull` 或 `/push` 时，编辑器上方会出现临时的 TUI 进度面板：

```text
◆ pi-git-shortcuts  commit + push  3s
├─ ✓ 检查 Git 仓库
├─ ✓ 暂存变更 · git add -A
├─ ✓ 读取 staged diff
└─ ○ 生成 commit message · 简体中文 · 4 个文件
```

面板会依次展示 commit、push、rebase 和冲突解决阶段。成功后显示 commit hash 或最终 push 结果，并在 6 秒后自动收起；错误状态会保留更久，并显示恢复信息。

面板收起后，聊天记录中会保留一条简洁结果。该结果以 Pi custom entry 保存，因此重新打开 session 后仍然可见；custom entry 不参与 LLM context，也不占用模型上下文 token。展开结果可查看耗时和时间戳。

进度面板通过 `setWidget()` 渲染。进度更新和持久结果都不会发送给模型。

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

- 仅通过 `pi.registerCommand()` 注册 `/commit`、`/cp`、`/pull`、`/push` 和 `/git-shortcuts-config`。
- 不注册 LLM tool。
- 不调用 `sendUserMessage()` 或 `sendMessage()`。
- 不向 session 追加 entry。
- 偏好设置写入独立 JSON 配置文件，而不是 session。
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

需要 Pi `0.80.7` 或更高版本。

### npm

```bash
pi install npm:pi-git-shortcuts
```

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
│   ├── commands.ts   # /commit、/cp、/pull 和 /push 流程
│   ├── config.ts     # 持久化 commit message 语言偏好
│   ├── git.ts        # Git helper 和校验
│   ├── progress.ts   # 临时 TUI 进度面板
│   └── index.ts      # Pi extension 入口
├── test/
├── README.md
├── README.zh-CN.md
└── package.json
```

## 许可证

MIT，详情见 [LICENSE](./LICENSE)。
