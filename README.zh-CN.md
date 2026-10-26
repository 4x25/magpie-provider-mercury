# Magpie Mercury 插件

[English](README.md)

在 [Magpie](https://usemagpie.ai) 中使用 **Inception Labs Mercury** 模型。支持输入一个或多个 Inception API Key，也可以输入 `playground`，通过 Inception 官方 Playground 服务体验模型。

## 快速开始

安装 Magpie 0.1.1323 或更新版本后运行：

```bash
magpie plugin add github:4x25/magpie-provider-mercury
magpie plugin login inception
magpie provider test inception
```

按提示输入一个或多个以英文逗号、空格分隔的 API Key，或输入 `playground`，然后在 Magpie 中为 Agent 选择 **`inception/mercury-3`** 等模型。

也可以从本地克隆目录安装：

```bash
magpie plugin add /path/to/magpie-provider-mercury
```

在应用中，打开 **Plugins → Add a plugin**，填入 GitHub 安装地址或本地目录，再为 **Inception (Mercury)** 登录。

## 登录方式

### 使用自己的 API Key

1. 在 [Inception 控制台](https://platform.inceptionlabs.ai/dashboard/api-keys) 创建 API Key。
2. 运行 `magpie plugin login inception`，或打开供应商的登录窗口。
3. 在密码输入框中粘贴一个 Key，或以英文逗号、空格分隔的多个 Key。

请求使用 Inception 的 OpenAI 兼容接口 `https://api.inceptionlabs.ai/v1`。编码 Agent 和日常使用推荐选择此模式。

### 多个 API Key

在同一个输入框中批量导入，例如：

```text
sk_example_A, sk_example_B sk_example_A
```

解析时去掉首尾空白及空项，重复 Key 只保留一次，真实 API Key 的大小写保持不变。再次导入已有 Key 时复用原账号，保留其设置。账号名称显示 Key 的末四位和一段短指纹，因此末尾相同的 Key 仍能区分。

每个唯一 Key 在 **Inception (Mercury)** 下独立显示为一个账号。通过 Magpie 的账号控件选择优先账号，或启停其他账号。API 返回用量时，Magpie 按实际使用的账号记录请求用量；遇到拒绝或限流时，原生路由可切换到其他已启用账号。插件逐个保存凭证，而不是保存拼接的 Key 列表。

在终端查看账号：

```bash
magpie accounts inception
```

### 使用 Playground

在同一个输入框中输入 `playground`，即可使用 Inception 官方体验服务。大小写及首尾空白不影响识别。

Playground 适合试用模型，其能力和可用性可能变化，不适合依赖工具调用的工作流。

| 功能 | API Key | Playground |
| --- | --- | --- |
| 文本聊天与流式回复 | 支持 | 支持 |
| 工具调用 | 聊天模型支持 | 不支持 |
| 模型目录 | 从 Inception 刷新 | 插件内置 |
| 采样及结构化输出选项 | 传递给正式 API | 仅使用体验服务支持的参数 |
| Token 用量 | 按 API 返回值记录 | 流式回复不提供 |
| 费用 | 按 Inception 账号计费 | 免费体验 |

Playground 接受消息、模型、输出 token 上限、流式开关和推理强度。即使客户端要求完整回复，Magpie 通常也会向上游发送流式请求，因此 Playground 用量可能显示为零；这不代表实际测得的 token 数。

同时启用 Playground 和 API Key 账号时，携带非空 `tools`、`functions`、强制工具选择，或消息历史中包含工具调用、工具结果的请求，会被 Playground 适配器本地拒绝。正常启用账号故障切换时，Magpie 尝试其他已启用账号；这些请求不会发往 Playground 服务。本地拒绝保留 Playground 的登录状态，也不会触发账号冷却，因此普通文本聊天仍可使用它。仅携带空工具数组不会触发此检查。

没有已启用的 API Key 账号能处理请求时会返回错误，而不是静默丢弃工具流程。固定到 Playground 账号的请求无法切换到其他账号。路由诊断中可能看到一次本地 Playground 尝试，然后才转到其他账号。

## 模型

插件预置以下聊天模型：

| 模型 ID | 上下文 token | 最大输出 token |
| --- | --- | --- |
| `inception/mercury-3` | 1,000,000 | 131,072 |
| `inception/mercury-2.5` | 260,000 | 65,536 |
| `inception/mercury-2` | 128,000 | 50,000 |

使用 API Key 时，Magpie 从 Inception 刷新目录，仅列出支持聊天接口的模型。获取失败时保留已知目录。

公开目录中的模型不一定都能被当前账号调用，实际访问权限由 Inception 的账号权限和服务可用性决定。最新能力、限制及价格请以 [官方模型文档](https://docs.inceptionlabs.ai/get-started/models) 为准。

Magpie 提供 `none`、`low`、`medium`、`high` 四档推理强度。API Key 和 Playground 两种账号均在发送上游请求前，将 `reasoning_effort: "none"` 转换为 Inception 的 `reasoning_effort: "instant"`，其余三档保持原名。使用 `none` 能让最低延迟档位经过 Magpie 的协议转换后仍然保留。

调用方省略 `reasoning_effort` 时，两种账号默认向 Inception 显式发送 `reasoning_effort: "instant"`。显式指定档位时，仍按上述规则处理。

这表示选择 Inception 的最低延迟模式，不承诺推理 token 为零。Magpie 的路由及用量诊断可能显示兼容名称 `none`，而 Inception 实际收到 `instant`。详见 [Inception 推理档位文档](https://docs.inceptionlabs.ai/capabilities/reasoning-efforts)。

查看可用模型：

```bash
magpie models
```

## 凭证管理

登录信息由 Magpie 管理，保存在配置目录中的 `plugin-auth.json`。普通安装使用 `~/.config/magpie` 或 `$XDG_CONFIG_HOME/magpie`，便携版使用自身的数据目录。每个导入的 Key 单独保存为一个账号。请妥善保管此文件。API Key 模式使用当前选中账号的 Key，Playground 请求不携带账号凭证。

## 开发

插件运行在 Magpie 的 Bun 插件宿主中。本地检查需要 Node.js 20 或更新版本：

```bash
npm run check
```

单元测试使用模拟网络响应。普通安装的集成测试可将 `HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 指向独立的沙箱目录；便携版请使用独立的 Magpie 程序及数据目录。修改本地安装的插件后，在 Magpie 中禁用再启用以重新加载。

## 许可证

[MIT](LICENSE)
