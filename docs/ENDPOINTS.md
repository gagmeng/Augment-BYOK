# ENDPOINTS：52 / 11（上游端点范围）

数据源：
- `.cache/reports/upstream-analysis.json`（端点全集；`npm run upstream:analyze`）
- `dist/endpoint-coverage.report.md`（LLM 端点覆盖矩阵；`npm run report:coverage`）

默认策略：
- BYOK 运行时代码只对 **11 个 LLM 数据面端点**提供语义实现（其余端点保持 official，或按需 disabled）。

## 11 个 LLM 数据面（BYOK 语义实现）

<!-- BEGIN GENERATED: LLM_ENDPOINTS -->
- `callApi`（5）：`/get-models`、`/chat`、`/completion`、`/chat-input-completion`、`/next_edit_loc`
- `callApiStream`（6）：`/chat-stream`、`/prompt-enhancer`、`/instruction-stream`、`/smart-paste-stream`、`/next-edit-stream`、`/generate-commit-message-stream`
<!-- END GENERATED: LLM_ENDPOINTS -->

## 真实环境触发方式（端点验收清单）

目标：**让每个 LLM 端点至少触发 1 次**（并确认 `mode=byok` 下均使用官方拼接）。

前置：
- 安装 BYOK VSIX → `BYOK: Enable`
- 确认 Endpoint Rules 对目标端点为 `byok`（面板默认已覆盖 11 个）

触发方式（可在命令面板搜同名关键词）：
- `/chat`、`/chat-stream`：正常对话（发送一条消息；流式输出会命中 `/chat-stream`）
- `/completion`：编辑器内联补全/代码补全（输入几字符等待建议）
- `/chat-input-completion`：Chat 输入框补全（在 Chat 输入框打字等待建议）
- `/next_edit_loc`：触发 Next Edit 定位（候选位置）
- `/next-edit-stream`：触发 Next Edit 生成（建议代码/补丁）
- `/prompt-enhancer`：触发“提示词增强/改写”功能
- `/instruction-stream`：触发“Instruction/指令生成”功能（通常为对选区下指令并流式产出替换内容）
- `/smart-paste-stream`：触发 Smart Paste（把一段代码粘贴到编辑器并走 Smart Paste 流程）
- `/generate-commit-message-stream`：SCM 里触发“生成提交信息/commit message”

验收（自动审计）：
- chat 与 non-chat 端点共用同一套 official delegation audit 文案；检查日志时只需关注 `delegated` / `delegated miss` / `delegation failed` 三类事件
- 生成日志：`npm run capture:logs`（自动从 VS Code logs 提取 `[Augment-BYOK]` 行到 `vscode.log`/`webview.log`）
- 严格检查：`npm run check:official-delegation -- --require-all`（要求 10 个“官方拼接端点”（除 `/get-models`）全部出现且 miss/fail=0）

维护（单一真相）：
- 修改 `tools/report/llm-endpoints-spec.js`
- 同步生成：`npm run gen:llm-endpoints`（更新 `docs/ENDPOINTS.md` + `payload/extension/out/byok/ui/config-panel/webview/render/index.js` + `payload/extension/out/byok/config/default-config.js` + `payload/extension/out/byok/core/official-delegation.js`）
- CI 校验：`npm run check:llm-endpoints`（未提交生成结果会失败）

## 其余 41 个端点（非 LLM，默认 official）

说明：
- 当前上游快照：`augment/vscode-augment@0.801.0`
- 这些端点变化频繁，不再在本文手工枚举；请以 `.cache/reports/upstream-analysis.json` 为准
- 路由策略：默认 official；仅个别本地敏感端点会在默认配置里显式 `disabled`
