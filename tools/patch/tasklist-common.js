#!/usr/bin/env node
"use strict";

function requireCapture(match, index, label) {
  const value = String(match && match[index] ? match[index] : "");
  if (!value) throw new Error(`${label} capture missing`);
  return value;
}

function buildEnsureRootSnippet({ rootVar, conversationIdVar, errorFnVar }) {
  return (
    `let ${rootVar}=this._taskManager.getRootTaskUuid(${conversationIdVar});` +
    `if(!${rootVar}&&${conversationIdVar}&&typeof this._taskManager.createNewTaskList==="function"){${rootVar}=await this._taskManager.createNewTaskList(${conversationIdVar});}` +
    `if(!${rootVar})return ${errorFnVar}("No root task found.");`
  );
}

function buildTaskFailuresSummarySnippet({ resultsVar, errorFnVar, textVar, planVar }) {
  return (
    `let __byok_failed=${resultsVar}.filter(t=>t&&t.success===!1);` +
    `if(__byok_failed.length){` +
    `let __byok_lines=__byok_failed.slice(0,10).map(t=>"- "+String(t.taskName)+": "+String(t.error||"unknown")).join("\\n");` +
    `let __byok_more=__byok_failed.length>10?"\\n… ("+String(__byok_failed.length-10)+" more)":"";` +
    `let __byok_msg="\\n\\nTask creation failures ("+String(__byok_failed.length)+"/"+String(${resultsVar}.length)+"):\\n"+__byok_lines+__byok_more;` +
    `if(__byok_failed.length===${resultsVar}.length)return{...${errorFnVar}("Failed to add task(s)."+__byok_msg),plan:${planVar}};` +
    `${textVar}+=__byok_msg;` +
    `}`
  );
}

function buildSanitizeOptionalTaskIdsSnippet(itemVar) {
  return (
    `typeof ${itemVar}.parent_task_id==="string"&&${itemVar}.parent_task_id.trim()===""&&delete ${itemVar}.parent_task_id;` +
    `typeof ${itemVar}.after_task_id==="string"&&${itemVar}.after_task_id.trim()===""&&delete ${itemVar}.after_task_id;`
  );
}

function buildTasklistNoopGuardSnippet({ diffVar, diffFnVar, beforeVar, afterVar, errorFnVar, planVar, textVar, formatterVar, okFnVar, returnPrefix }) {
  const returnLead = returnPrefix ? `return ${returnPrefix}` : "return";
  return (
    `if(!${planVar})return ${errorFnVar}("Failed to retrieve updated task tree after reorganization.");` +
    `let ${diffVar}=${diffFnVar}(${beforeVar},${afterVar});` +
    `let __byok_reorg_count=[${diffVar}&&${diffVar}.created,${diffVar}&&${diffVar}.updated,${diffVar}&&${diffVar}.deleted].reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);` +
    `if(__byok_reorg_count===0)return{...${errorFnVar}("Task list reorganization produced no changes."),plan:${planVar}};` +
    `let ${textVar}=${formatterVar}.formatBulkUpdateResponse(${diffVar});` +
    `${returnLead}{...${okFnVar}(${textVar}),plan:${planVar}}`
  );
}

module.exports = {
  requireCapture,
  buildEnsureRootSnippet,
  buildTaskFailuresSummarySnippet,
  buildSanitizeOptionalTaskIdsSnippet,
  buildTasklistNoopGuardSnippet
};
