# ARCH：架构与最小补丁面（单 VSIX）

目标：**最小破坏面 + 可审计 + 可回滚**（只接管 11 个 LLM 数据面端点）。

> 全量修改功能（对上游 VSIX 的“全量改动面”清单）：见仓库根目录 `README.md` 的同名章节。

## 范围（Scope）

- Goals：对齐 Augment 自定义协议（重点 `/chat-stream` NDJSON + tool use）；端点级路由（`byok|official|disabled`）；`globalState` 持久化 + 面板手填 + `Save` 热更新；错误/超时/取消可控 + 上游升级 fail-fast。
- Non-goals：不复刻控制面/权限/Secrets/遥测等能力（如 Remote Agents）；不引入 settings/env/yaml/SecretStorage 作为配置源；不做 autoAuth。
- Constraints：不读取/不写入 `augment.advanced.*` settings；构建产物必须包含 injector 且必须通过 `autoAuth=0` guard。
- Acceptance：BYOK 关闭立即回到官方链路；BYOK 开启时 11 个 LLM 数据面端点按路由工作（见 `docs/ENDPOINTS.md`）。

## 构建（Build）

单一真相：`tools/build/build-vsix.js`（内部复用 `tools/lib/upstream-vsix.js` 与 `tools/lib/byok-workflow.js`）。

- 下载/解包上游 VSIX → `.cache/work/*`
- overlay BYOK payload → `extension/out/byok/*`
- 执行补丁编排：`applyByokPatches()`（`tools/lib/byok-workflow.js`）
- 合约检查（fail-fast）：`runByokContractChecks()` / `tools/check/byok-contracts/main.js`
- 重新打包 → `dist/*.vsix`
- 写锁文件：`upstream.lock.json` / `dist/upstream.lock.json`

## 运行时（Runtime）

- `callApi/callApiStream` → `maybeHandleCallApi*()` → `decideRoute()` → `byok|official|disabled`
- `runtimeEnabled=false` 即软回滚：shim 返回 `undefined`/empty stream → 回到官方链路（不改配置）
- 端点覆盖范围：仅 11 个 LLM 数据面端点有 BYOK 语义实现（见 `docs/ENDPOINTS.md`）

## 代码布局（BYOK payload）

主要都在 `payload/extension/out/byok/*`：

- `runtime/bootstrap/*`、`runtime/shim/*`、`runtime/official/*`、`runtime/upstream/*`、`runtime/workspace/*`
- `config/*`
- `ui/config-panel/*`
- `core/*`
- `providers/*`

## core 约定（避免重复实现）

- `core/provider-text.js`：`{system, messages}` → provider 文本（complete + stream deltas）；`/completion`、`/prompt-enhancer`、`/generate-commit-message-stream` 等复用
- `core/provider-augment-chat.js`：Augment chat req → provider chat（complete + stream chunks）；`/chat`、`/chat-stream`、historySummary/self-test 复用
- `core/augment-chat/shared/tools.js`：区分 **业务语义层**（`resolveToolSchema`）与 **传输兼容层**（`sanitizeJsonSchemaForTransport` / `resolveToolSchemaForTransport`）；provider 转换统一走 transport sanitize，避免把“省略即默认”的 optional 参数错误提升为必填

## providers 约定（避免重复实现）

- `providers/chat-chunks-util.js`：tool_use / token_usage / final chunk 的统一构建（stop_reason、nodeId 递增规则）
- `providers/sse.js` / `providers/sse-json.js`：SSE 解析器 + SSE JSON 迭代器（事件类型推断/统计）
- `providers/provider-util.js`：跨 provider 的小工具（例如 invalid request fallback、并行工具策略）
- `providers/request-defaults-util.js`：跨 provider 的 requestDefaults 纯工具（max tokens 别名归一/清理）
- `providers/<provider>/{index,request,json-util}.js`：协议适配入口/HTTP 请求与兜底/JSON→Augment chunks

协议适配细节：见 `docs/PROVIDERS.md`；配置字段：见 `docs/CONFIG.md`。

## 开发约束（硬规则）

这些规则由脚本强制（避免结构再次失控）：

- 单文件 ≤ 400 行（强制：`npm run check:codestyle`）
- 文件/目录命名：kebab-case（强制：`npm run check:codestyle`）
- 禁止同目录出现 `foo.js` 与 `foo/`（强制：`npm run check:codestyle`）
- 禁止“纯转发”模块（仅 `module.exports = require(...)`）（强制：`npm run check:codestyle`）
- provider.type 分发收敛（强制：`npm run check:provider-dispatch`）

## 常用检查

- `npm run check:fast`：快速静态检查 + 单测（不依赖上游缓存）
- `npm run check`：完整检查（含合约；通常需要 `.cache/upstream/*.vsix`）
- `npm run check:codestyle`：硬规则（400 行、命名、模块布局）
- `npm run check:provider-dispatch`：确保 provider.type 分支集中在少数模块
