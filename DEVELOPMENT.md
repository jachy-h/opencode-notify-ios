# Development

## 项目结构

```
├── index.ts                  # 插件入口（同时用于 npm 发布）
├── index.test.ts             # 单元测试
├── notify-ios.json           # 本地开发配置（gitignored）
├── notify-ios.example.json   # 配置示例
├── package.json              # npm 包信息
├── opencode.json             # 项目级 OpenCode 配置
└── .opencode/plugins/        # 本地开发插件目录（gitignored）
```

## 开发

### 环境

需要 [Bun](https://bun.sh) ≥ 1.0。项目使用 TypeScript，零外部依赖。

### 本地运行

```bash
# 将 index.ts 复制到 .opencode/plugins/ 即可在本地加载插件
mkdir -p .opencode/plugins
cp index.ts .opencode/plugins/notify-ios.ts

# 跑测试
bun test

# 手动触发通知验证
bun run test-manual.ts   # 需先创建 test-manual.ts
```

### 测试

```bash
bun test
```

测试覆盖：配置加载、模板解析、enable 过滤、热重载、Bark API 调用。

### 本地安装到当前项目

**方式一（推荐，适合开发调试）**：将 `index.ts` 复制到 `.opencode/plugins/`，OpenCode 会自动加载该目录下的插件文件，无需 npm 发布：

```bash
mkdir -p .opencode/plugins
cp index.ts .opencode/plugins/notify-ios.ts
```

**方式二（需先发布到 npm）**：在项目 `opencode.json` 中声明 npm 包：

```json
{ "plugin": ["@jachy/opencode-notify-ios"] }
```

> **注意**：`@jachy/opencode-notify-ios` 当前为 `private` 包，未发布前使用方式二会导致 OpenCode 启动时报错。开发阶段请使用方式一。

## 全部支持的事件

| 类别 | 事件 | 说明 |
|------|------|------|
| **Session** | `session.idle` | 会话空闲，等待用户操作 |
| | `session.error` | 会话发生错误 |
| | `session.created` | 会话已创建 |
| | `session.deleted` | 会话已删除 |
| | `session.compacted` | 会话上下文压缩 |
| | `session.diff` | 会话产生变更 |
| | `session.status` | 会话状态变更 |
| | `session.updated` | 会话已更新 |
| **Permission** | `permission.asked` | 请求用户确认 |
| | `permission.replied` | 权限已回复 |
| **Tool** | `tool.execute.before` | 工具执行前 |
| | `tool.execute.after` | 工具执行后 |
| **Message** | `message.updated` | 消息已更新 |
| | `message.removed` | 消息已移除 |
| | `message.part.updated` | 消息片段更新 |
| | `message.part.removed` | 消息片段移除 |
| **Command** | `command.executed` | 命令已执行 |
| **File** | `file.edited` | 文件已编辑 |
| | `file.watcher.updated` | 文件监控更新 |
| **Todo** | `todo.updated` | Todo 已更新 |
| **TUI** | `tui.prompt.append` | 提示已追加 |
| | `tui.command.execute` | TUI 命令执行 |
| | `tui.toast.show` | Toast 消息 |
| **LSP** | `lsp.client.diagnostics` | LSP 诊断更新 |
| | `lsp.updated` | LSP 已更新 |
| **其他** | `installation.updated` | 安装已更新 |
| | `server.connected` | 服务器连接 |
| | `shell.env` | Shell 环境变量 |

## 发布

### 前检查

```bash
bun test                  # 确保所有测试通过
git status               # 确认无遗漏文件
```

### 发布到 npm

```bash
npm login                # 首次需要登录
npm version patch        # 升级版本号 (1.0.0 → 1.0.1)
npm publish
```

## 架构

```
BarkNotifyPlugin(directory)
  └── event({ type })
        ├── loadConfig(directory)     # 读 notify-ios.json（每次事件触发，实现热重载）
        ├── enable.includes(type)?    # 过滤未启用事件
        ├── resolveTemplate()         # 模板解析，无配置则回退
        └── sendBarkNotification()    # 调 Bark API 推送
```
