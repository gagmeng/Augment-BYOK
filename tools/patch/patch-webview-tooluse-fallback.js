#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker, replaceOnceRegex } = require("../lib/patch");

const MARKER_TOOL_LIST = "__augment_byok_webview_tooluse_fallback_v1";
const MARKER_TOOL_LIST_UNGROUPED = "__augment_byok_webview_tooluse_fallback_v1_ungrouped";
const MARKER_TOOL_STATE = "__augment_byok_webview_tooluse_fallback_v1_tool_state";

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patchAugmentMessageAsset(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");

  let out = original;
  let changed = false;
  const applied = [];

  // 1) $displayableToolUseNodes 在重启后可能为空（store 未恢复），但 turn.structured_output_nodes 仍包含 TOOL_USE。
  //    兜底：优先用 store 的 displayable nodes；为空时回退到 t.toolUseNodes。
  if (!out.includes(MARKER_TOOL_LIST)) {
    const alreadyPatched = out.includes("__byok_tool_list_fallback");
    if (!alreadyPatched) {
      let listVar = null;
      let srcFn = null;

      out = replaceOnceRegex(
        out,
        /const ([A-Za-z_$][0-9A-Za-z_$]*)=([A-Za-z_$][0-9A-Za-z_$]*)\(\(\(\)=>\s*([A-Za-z_$][0-9A-Za-z_$]*)\(\)\.filter\(\(([A-Za-z_$][0-9A-Za-z_$]*)=>!!\4\.tool_use\)\)\)\);/g,
        (m) => {
          listVar = m[1];
          const wrapFn = m[2];
          srcFn = m[3];
          const itemVar = m[4];
          return `const ${listVar}=${wrapFn}((()=>{const __byok_tool_list_fallback=1;const __byok_list=${srcFn}();const __byok_arr=Array.isArray(__byok_list)?__byok_list.filter((${itemVar}=>!!${itemVar}.tool_use)):[];return __byok_arr.length?__byok_arr:t.toolUseNodes.filter((${itemVar}=>!!${itemVar}.tool_use))}));`;
        },
        "AugmentMessage tool list nodes fallback"
      );

      if (!listVar || !srcFn) throw new Error("AugmentMessage tool list nodes fallback: failed to capture vars");

      out = replaceOnceRegex(
        out,
        new RegExp(
          `${escapeRegExp(srcFn)}\\(\\)\\.length===1\\?([A-Za-z_$][0-9A-Za-z_$]*)\\(([A-Za-z_$][0-9A-Za-z_$]*)\\):\\1\\(([A-Za-z_$][0-9A-Za-z_$]*),!1\\)`,
          "g"
        ),
        (m) => `e(${listVar}).length===1?${m[1]}(${m[2]}):${m[1]}(${m[3]},!1)`,
        "AugmentMessage tool list layout"
      );
      out = replaceOnceRegex(
        out,
        new RegExp(`${escapeRegExp(srcFn)}\\(\\)\\?\\.length&&([A-Za-z_$][0-9A-Za-z_$]*)\\(([A-Za-z_$][0-9A-Za-z_$]*)\\)`, "g"),
        (m) => `e(${listVar}).length&&${m[1]}(${m[2]})`,
        "AugmentMessage tool list render gate"
      );

      changed = true;
      applied.push("tool_list");
    }
    out = ensureMarker(out, MARKER_TOOL_LIST);
  }

  // 3) enableGroupedTools=false 时走 _p：它直接依赖 $displayableToolUseNodes.map(...).filter(...)，
  //    重启后 store 未恢复会导致列表为空 -> 工具区域“有容器但空白”。
  //    兜底：displayable 为空时，回退到 turn.toolUseNodes（与 grouped 分支一致）。
  if (!out.includes(MARKER_TOOL_LIST_UNGROUPED)) {
    const alreadyPatched = out.includes("__byok_tool_list_ungrouped_fallback");
    if (!alreadyPatched) {
      out = replaceOnceRegex(
        out,
        /([A-Za-z_$][0-9A-Za-z_$]*)=([A-Za-z_$][0-9A-Za-z_$]*)\(\(\(\)=>([A-Za-z_$][0-9A-Za-z_$]*)\(e\(([A-Za-z_$][0-9A-Za-z_$]*)\),"\$displayableToolUseNodes",([A-Za-z_$][0-9A-Za-z_$]*)\)\.map\(\(([A-Za-z_$][0-9A-Za-z_$]*)=>\6\.tool_use\)\)\.filter\(\(\6=>!!\6\)\)\)\);/g,
        (m) =>
          `${m[1]}=${m[2]}((()=>{const __byok_tool_list_ungrouped_fallback=1;const u=${m[3]}(e(${m[4]}),\"$displayableToolUseNodes\",${m[5]});const f=Array.isArray(u)?u.map((x=>x.tool_use)).filter((x=>!!x)):[];return f.length?f:t.toolUseNodes.map((x=>x.tool_use)).filter((x=>!!x))}));`,
        "AugmentMessage ungrouped tool list fallback"
      );
      changed = true;
      applied.push("tool_list_ungrouped");
    }
    out = ensureMarker(out, MARKER_TOOL_LIST_UNGROUPED);
  }

  // 4) To（单工具卡片）渲染 gate 是 i()（$toolUseState）。重启后 toolUseState slice 可能为空 -> 卡片内容不渲染。
  //    兜底：当 store 不存在 toolUseState 时，从该 requestId 的 turn group 中回放 TOOL_RESULT 节点恢复状态。
  //    NOTE: 不引入“占位文案”，只恢复已存在于历史数据中的 tool_result_node.content / content_nodes。
  if (!out.includes(MARKER_TOOL_STATE)) {
    const alreadyPatched = out.includes("__byok_toolUseId");
    if (!alreadyPatched) {
      out = replaceOnceRegex(
        out,
        /([A-Za-z_$][0-9A-Za-z_$]*)=\(\)=>([A-Za-z_$][0-9A-Za-z_$]*)\(e\(([A-Za-z_$][0-9A-Za-z_$]*)\),"\$toolUseState",([A-Za-z_$][0-9A-Za-z_$]*)\)/g,
        (m) =>
          `${m[1]}=()=>{const s=${m[2]}(e(${m[3]}),\"$toolUseState\",${m[4]});if(s)return s;const __byok_toolUseId=String(t&&t.toolUse?(t.toolUse.tool_use_id||t.toolUse.toolUseId||\"\"):\"\");try{const __byok_store=(typeof no===\"function\"?no():null)?.store;const __byok_alt=__byok_store&&typeof cr!==\"undefined\"&&cr&&typeof cr.select===\"function\"?cr.select(__byok_store.getState(),t.requestId,__byok_toolUseId):null;if(__byok_alt)return __byok_alt}catch{}const __byok_msgs=typeof t!=\"undefined\"&&t&&typeof t.postToolUseMessages===\"function\"?t.postToolUseMessages():t&&Array.isArray(t.postToolUseMessages)?t.postToolUseMessages:[];if(Array.isArray(__byok_msgs)&&__byok_msgs.length>0)return{phase:he.completed,result:{text:String(__byok_msgs.join(\"\\n\\n\")),isError:!1,contentNodes:[]}};return{phase:he.completed,result:{text:\"\",isError:!1,contentNodes:[]}}}`,
        "AugmentMessage tool use state fallback"
      );
      changed = true;
      applied.push("tool_state");
    }
    out = ensureMarker(out, MARKER_TOOL_STATE);
  }

  const didChange = out !== original;
  if (didChange) fs.writeFileSync(filePath, out, "utf8");
  return { changed: didChange, reason: applied.length ? applied.join("+") : "already_patched" };
}

function patchWebviewToolUseFallback(extensionDir) {
  const extDir = path.resolve(String(extensionDir || ""));
  if (!extDir || extDir === path.parse(extDir).root) throw new Error("patchWebviewToolUseFallback: invalid extensionDir");

  const assetsDir = path.join(extDir, "common-webviews", "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`webview assets dir missing: ${assetsDir}`);

  const candidates = fs
    .readdirSync(assetsDir)
    .filter((name) => typeof name === "string" && name.startsWith("AugmentMessage-") && name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name));

  if (!candidates.length) throw new Error("AugmentMessage asset not found (upstream may have changed)");

  const results = [];
  for (const filePath of candidates) results.push({ filePath, ...patchAugmentMessageAsset(filePath) });
  return { changed: results.some((r) => r.changed), results };
}

module.exports = { patchWebviewToolUseFallback };

if (require.main === module) {
  const extensionDir = process.argv[2];
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir>`);
    process.exit(2);
  }
  patchWebviewToolUseFallback(extensionDir);
}
