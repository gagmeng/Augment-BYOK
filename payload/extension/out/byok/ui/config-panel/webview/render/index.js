(function () {
  "use strict";

  const ns = (window.__byokCfgPanel = window.__byokCfgPanel || {});
  const { normalizeStr, uniq, escapeHtml, optionHtml, computeProviderIndexById } = ns;

  const ENDPOINT_GROUPS_V1 = [
    {
      id: "llm_data_plane",
      label: "LLM 数据面（11）",
      endpoints: [
        /* BEGIN GENERATED: LLM_ENDPOINTS */
        "/get-models",
        "/chat",
        "/completion",
        "/chat-input-completion",
        "/next_edit_loc",
        "/chat-stream",
        "/prompt-enhancer",
        "/instruction-stream",
        "/smart-paste-stream",
        "/next-edit-stream",
        "/generate-commit-message-stream"
        /* END GENERATED: LLM_ENDPOINTS */
      ]
    },
    {
      id: "remote_agents",
      label: "Remote Agents（15）",
      endpoints: [
        "/remote-agents/create",
        "/remote-agents/update",
        "/remote-agents/delete",
        "/remote-agents/list",
        "/remote-agents/list-stream",
        "/remote-agents/chat",
        "/remote-agents/get-chat-history",
        "/remote-agents/agent-history-stream",
        "/remote-agents/logs",
        "/remote-agents/interrupt",
        "/remote-agents/pause",
        "/remote-agents/resume",
        "/remote-agents/resume-hint",
        "/remote-agents/generate-summary",
        "/remote-agents/add-ssh-key"
      ]
    },
    {
      id: "agents_tools",
      label: "Agents / Tools（6）",
      endpoints: [
        "/agents/check-tool-safety",
        "/agents/revoke-tool-access",
        "/agents/list-remote-tools",
        "/agents/run-remote-tool",
        "/agents/edit-file",
        "/agents/codebase-retrieval"
      ]
    },
    {
      id: "blobs_context_sync",
      label: "文件/Blob/上下文同步（7）",
      endpoints: [
        "/batch-upload",
        "/checkpoint-blobs",
        "/find-missing",
        "/save-chat",
        "/context-canvas/list",
        "/get-implicit-external-sources",
        "/search-external-sources"
      ]
    },
    {
      id: "github",
      label: "GitHub 集成（4）",
      endpoints: [
        "/github/is-user-configured",
        "/github/list-repos",
        "/github/list-branches",
        "/github/get-repo"
      ]
    },
    {
      id: "auth_subscription_secrets",
      label: "账号/订阅/权限/Secrets（7）",
      endpoints: [
        "/token",
        "/get-credit-info",
        "/subscription-banner",
        "/settings/get-tenant-tool-permissions",
        "/user-secrets/list",
        "/user-secrets/upsert",
        "/user-secrets/delete"
      ]
    },
    {
      id: "feedback_telemetry_debug",
      label: "反馈/遥测/调试（17）",
      endpoints: [
        "/chat-feedback",
        "/completion-feedback",
        "/next-edit-feedback",
        "/client-metrics",
        "/client-completion-timelines",
        "/record-session-events",
        "/record-user-events",
        "/record-preference-sample",
        "/record-request-events",
        "/report-error",
        "/report-feature-vector",
        "/resolve-completions",
        "/resolve-chat-input-completion",
        "/resolve-edit",
        "/resolve-instruction",
        "/resolve-next-edit",
        "/resolve-smart-paste"
      ]
    },
    {
      id: "notifications",
      label: "通知（2）",
      endpoints: [
        "/notifications/read",
        "/notifications/mark-as-read"
      ]
    }
  ];

  const ENDPOINT_MEANINGS_V1 = {
    /* BEGIN GENERATED: LLM_ENDPOINT_MEANINGS */
    "/get-models": "拉取可用模型/feature flags（并可注入 BYOK models registry）",
    "/chat": "非流式 chat（或某些场景的 chat 请求）",
    "/completion": "编辑器 inline completion（短文本）",
    "/chat-input-completion": "Chat 输入框智能补全",
    "/next_edit_loc": "Next Edit 定位（候选位置 JSON）",
    "/chat-stream": "核心聊天流（Augment NDJSON）",
    "/prompt-enhancer": "提示词增强（stream）",
    "/instruction-stream": "指令生成/改写（stream）",
    "/smart-paste-stream": "Smart Paste（stream）",
    "/next-edit-stream": "Next Edit 建议（stream）",
    "/generate-commit-message-stream": "Commit message（stream）",
    /* END GENERATED: LLM_ENDPOINT_MEANINGS */

    "/remote-agents/create": "创建远程 agent",
    "/remote-agents/update": "更新配置",
    "/remote-agents/delete": "删除",
    "/remote-agents/list": "列表（一次性）",
    "/remote-agents/list-stream": "列表（流式更新）",
    "/remote-agents/chat": "与远程 agent 对话/下达任务",
    "/remote-agents/get-chat-history": "拉取对话历史（一次性）",
    "/remote-agents/agent-history-stream": "对话/事件历史流",
    "/remote-agents/logs": "日志",
    "/remote-agents/interrupt": "中断执行",
    "/remote-agents/pause": "暂停",
    "/remote-agents/resume": "恢复",
    "/remote-agents/resume-hint": "恢复提示/状态同步",
    "/remote-agents/generate-summary": "生成摘要",
    "/remote-agents/add-ssh-key": "写入 SSH key",

    "/agents/check-tool-safety": "工具安全性检查/准入",
    "/agents/revoke-tool-access": "撤销工具权限",
    "/agents/list-remote-tools": "列出可用远程工具",
    "/agents/run-remote-tool": "执行远程工具",
    "/agents/edit-file": "通过 agent 执行文件编辑",
    "/agents/codebase-retrieval": "代码库检索",

    "/batch-upload": "批量上传 blobs（文件内容/上下文）",
    "/checkpoint-blobs": "checkpoint 相关 blobs 操作",
    "/find-missing": "查找缺失 blob",
    "/save-chat": "保存会话/记录（服务端持久化）",
    "/context-canvas/list": "Context Canvas 列表",
    "/get-implicit-external-sources": "隐式外部来源",
    "/search-external-sources": "外部来源搜索",

    "/github/is-user-configured": "是否已配置 GitHub",
    "/github/list-repos": "仓库列表",
    "/github/list-branches": "分支列表",
    "/github/get-repo": "获取指定 repo 信息/元数据",

    "/token": "token 获取/刷新（鉴权相关）",
    "/get-credit-info": "额度/credits 信息",
    "/subscription-banner": "订阅提示 banner",
    "/settings/get-tenant-tool-permissions": "tenant 级工具权限配置",
    "/user-secrets/list": "列出用户 secrets",
    "/user-secrets/upsert": "写入/更新 secrets",
    "/user-secrets/delete": "删除 secrets",

    "/chat-feedback": "聊天反馈",
    "/completion-feedback": "补全反馈",
    "/next-edit-feedback": "Next Edit 反馈",
    "/client-metrics": "客户端指标",
    "/client-completion-timelines": "completion timeline（行为序列）",
    "/record-session-events": "会话事件",
    "/record-user-events": "用户事件",
    "/record-preference-sample": "偏好样本（用于训练/评估）",
    "/record-request-events": "请求事件记录",
    "/report-error": "错误上报",
    "/report-feature-vector": "特征向量上报",
    "/resolve-completions": "resolve*（日志/归因类）",
    "/resolve-chat-input-completion": "resolve*（日志/归因类）",
    "/resolve-edit": "resolve*（日志/归因类）",
    "/resolve-instruction": "resolve*（日志/归因类）",
    "/resolve-next-edit": "resolve*（日志/归因类）",
    "/resolve-smart-paste": "resolve*（日志/归因类）",

    "/notifications/read": "拉取通知",
    "/notifications/mark-as-read": "标记已读"
  };

  ns.ENDPOINT_GROUPS_V1 = ENDPOINT_GROUPS_V1;
  ns.ENDPOINT_MEANINGS_V1 = ENDPOINT_MEANINGS_V1;

  // Keep namespace shape stable (avoid unused warnings in older bundlers).
  void normalizeStr;
  void uniq;
  void optionHtml;
  void computeProviderIndexById;
})();
