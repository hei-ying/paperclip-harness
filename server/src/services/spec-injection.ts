/**
 * Spec Package Injection Service
 *
 * 为 AI Coding Agent 提供「规范包约束注入」能力。
 * 支持 OpenClaw Gateway、Claude Code CLI、Codex CLI 三种 adapter。
 *
 * 核心流程：
 * 1. Agent 被唤醒执行 Issue
 * 2. 检查 Issue 所属 Project 是否有 approved 状态的规范包
 * 3. 如果有，将规范包内容注入到 Agent 的 system prompt / 上下文中
 * 4. Agent 在约束边界内实现
 */

import type { GateCheckResult } from "./spec-gate-service-types.js";
import {
  runGate1Check,
  runGate2RuleCheck,
  runGate3Check,
  generateAgentCodingPrompt,
} from "./spec-gate-service.js";

// ── 规范包文件类型映射 ──
export const SPEC_FILE_TYPES = [
  "glossary",
  "openapi",
  "flow",
  "scenarios",
  "runtime_rules",
  "observability",
  "testcases",
] as const;

export type SpecFileType = (typeof SPEC_FILE_TYPES)[number];

// ── Adapter 类型 ──
export type SupportedAdapter = "openclaw_gateway" | "claude_local" | "codex_local";

// ── 规范包文件条目（DB 查询结果） ──
export interface SpecFileEntry {
  fileName: string;
  content: string | null;
  fileStatus: string;
  templateType: string;
  priority: number;
}

// ── 规范包（DB 查询结果） ──
export interface SpecPackageEntry {
  id: string;
  projectId: string;
  version: number;
  status: string;
  gate1Status: string;
  gate2Status: string;
  gate3Status: string;
}

// ── 注入结果 ──
export interface InjectionResult {
  injected: boolean;
  specPackageId: string | null;
  adapter: SupportedAdapter;
  // OpenClaw: 附加到 message 的前缀文本
  messagePrefix?: string;
  // Claude Code: 附加的 --add-dir 路径
  addDirPaths?: string[];
  // Claude Code: 附加的 system prompt
  claudeSystemPrompt?: string;
  // Codex: 附加的 instruction 文件路径
  codexInstructionFile?: string;
  // Claude Code: SKILL.md 内容（写入 skills 目录）
  claudeSkillContent?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 核心注入函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 检查项目是否有已通过的规范包，如果有则生成注入内容。
 */
export async function prepareSpecInjection(params: {
  projectId: string;
  companyId: string;
  adapter: SupportedAdapter;
  getSpecPackage: (projectId: string, companyId: string) => Promise<SpecPackageEntry | null>;
  getSpecFiles: (specPackageId: string) => Promise<SpecFileEntry[]>;
}): Promise<InjectionResult> {
  const { projectId, companyId, adapter, getSpecPackage, getSpecFiles } = params;

  // 1. 查找已审批的规范包
  const pkg = await getSpecPackage(projectId, companyId);
  if (!pkg || pkg.status !== "approved") {
    return { injected: false, specPackageId: null, adapter };
  }

  // 2. 获取规范包文件
  const files = await getSpecFiles(pkg.id);
  if (files.length === 0) {
    return { injected: false, specPackageId: pkg.id, adapter };
  }

  // 3. 根据适配器类型生成注入内容
  const prompt = generateAgentCodingPrompt(files);

  switch (adapter) {
    case "openclaw_gateway":
      return {
        injected: true,
        specPackageId: pkg.id,
        adapter,
        messagePrefix: prompt,
      };

    case "claude_local":
      return {
        injected: true,
        specPackageId: pkg.id,
        adapter,
        claudeSkillContent: buildClaudeSkillMd(files),
        claudeSystemPrompt: buildClaudeSystemPrompt(files),
      };

    case "codex_local":
      return {
        injected: true,
        specPackageId: pkg.id,
        adapter,
        codexInstructionFile: buildCodexInstruction(files),
      };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Claude Code 专用
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 生成 Claude Code 的 SKILL.md 内容。
 * Claude Code 通过 --add-dir 发现 .claude/skills/ 下的 skill。
 */
function buildClaudeSkillMd(files: SpecFileEntry[]): string {
  const sections = files.map((f) => {
    const label = SPEC_FILE_LABELS[f.templateType as SpecFileType] || f.fileName;
    return `## ${label}\n\n${f.content || "（缺失）"}`;
  });

  return `# 渠道对接规范包 — Claude Code Skill

> ⚠️ 此 Skill 由 Paperclip 规范包自动生成。
> 所有实现必须严格遵循以下规范，不得自行发明规则。

${sections.join("\n\n---\n\n")}

## 硬约束

- 不得修改 openapi.yaml 中定义的接口契约
- 所有术语以 glossary.md 为准
- 所有运行时行为以 runtime-rules.md 为准
- 所有异常路径以 scenarios.md 为准
- 所有日志、trace、脱敏要求以 observability.md 为准
- 所有实现必须附带对应测试
- 遇到文件间歧义、缺失或冲突时，先输出问题清单，不要自行决策
- 不得补充未定义状态、默认值或隐含规则

## 规范权威顺序

1. 渠道官方文档 / openapi.yaml
2. 已确认的渠道澄清结论
3. glossary.md
4. flow.md
5. scenarios.md
6. runtime-rules.md
7. observability.md
8. testcases.md
`;
}

/**
 * 生成 Claude Code 的 system prompt 补充。
 */
function buildClaudeSystemPrompt(files: SpecFileEntry[]): string {
  const fileMap = new Map(files.map((f) => [f.templateType, f.content || ""]));
  return `你正在执行渠道对接任务。以下规范包已通过 GATE 审核，你必须严格遵循：

[规范包] glossary: ${fileMap.get("glossary") ? "已加载" : "缺失"}
[规范包] openapi: ${fileMap.get("openapi") ? "已加载" : "缺失"}（不可修改）
[规范包] flow: ${fileMap.get("flow") ? "已加载" : "缺失"}
[规范包] scenarios: ${fileMap.get("scenarios") ? "已加载" : "缺失"}
[规范包] runtime-rules: ${fileMap.get("runtime_rules") ? "已加载" : "缺失"}
[规范包] observability: ${fileMap.get("observability") ? "已加载" : "缺失"}
[规范包] testcases: ${fileMap.get("testcases") ? "已加载" : "缺失"}

约束：遇到歧义先输出问题清单，不要编码。不得补充未定义规则。必须附带测试。`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Codex CLI 专用
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 生成 Codex 的 instruction 文件路径。
 * Codex 支持 codex.md / AGENTS.md 作为指令文件。
 */
function buildCodexInstruction(files: SpecFileEntry[]): string {
  const sections = files.map((f) => {
    const label = SPEC_FILE_LABELS[f.templateType as SpecFileType] || f.fileName;
    return `### ${label}\n${f.content || "（缺失）"}`;
  });

  return `# 渠道对接规范包 — Codex Instruction

${sections.join("\n\n")}

## 约束
- 不得修改 openapi.yaml 接口契约
- 术语以 glossary.md 为准
- 运行时行为以 runtime-rules.md 为准
- 异常路径以 scenarios.md 为准
- 日志/trace/脱敏以 observability.md 为准
- 必须附带测试
- 遇到歧义先输出问题清单，不得自行决策
- 不得补充未定义状态/默认值/隐含规则
`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OpenClaw Gateway 集成指南
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * OpenClaw Gateway adapter 集成说明。
 *
 * 在 openclaw-gateway adapter 的 execute() 函数中，当构建 agentParams 时：
 *
 * ```typescript
 * import { prepareSpecInjection } from "../services/spec-injection.js";
 *
 * // 在构建 message 之前，检查规范包
 * const injection = await prepareSpecInjection({
 *   projectId: wakePayload.projectId,  // 需要从 context 中获取
 *   companyId: ctx.agent.companyId,
 *   adapter: "openclaw_gateway",
 *   getSpecPackage: db.query.specPackages.findFirst(...),
 *   getSpecFiles: db.query.specFiles.findMany(...),
 * });
 *
 * if (injection.injected && injection.messagePrefix) {
 *   // 将规范包约束作为 message 的前缀
 *   agentParams.message = injection.messagePrefix + "\n\n" + agentParams.message;
 * }
 * ```
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Claude Code Local 集成指南
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Claude Code adapter 集成说明。
 *
 * 在 claude-local adapter 的 execute() 函数中：
 *
 * ```typescript
 * import { prepareSpecInjection } from "../services/spec-injection.js";
 * import fs from "node:fs/promises";
 * import path from "node:path";
 *
 * // 检查规范包
 * const injection = await prepareSpecInjection({
 *   projectId: ...,  // 从 context 获取
 *   companyId: ctx.agent.companyId,
 *   adapter: "claude_local",
 *   getSpecPackage: ...,
 *   getSpecFiles: ...,
 * });
 *
 * if (injection.injected && injection.claudeSkillContent) {
 *   // 将规范包作为 Claude Code skill 写入临时目录
 *   const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-"));
 *   const skillFile = path.join(skillDir, ".claude", "skills", "channel-spec", "SKILL.md");
 *   await fs.mkdir(path.dirname(skillFile), { recursive: true });
 *   await fs.writeFile(skillFile, injection.claudeSkillContent);
 *   // 将 skillDir 加入 --add-dir 参数
 *   claudeArgs.push("--add-dir", skillDir);
 * }
 * ```
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Codex CLI Local 集成指南
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Codex adapter 集成说明。
 *
 * 在 codex-local adapter 的 execute() 函数中：
 *
 * ```typescript
 * import { prepareSpecInjection } from "../services/spec-injection.js";
 *
 * const injection = await prepareSpecInjection({
 *   projectId: ...,
 *   companyId: ctx.agent.companyId,
 *   adapter: "codex_local",
 *   getSpecPackage: ...,
 *   getSpecFiles: ...,
 * });
 *
 * if (injection.injected && injection.codexInstructionFile) {
 *   // 将规范包写入 codex.md 或 AGENTS.md
 *   const instructionPath = path.join(cwd, "codex.md");
 *   await fs.writeFile(instructionPath, injection.codexInstructionFile);
 *   // Codex 会自动读取 codex.md
 * }
 * ```
 */

// ── 文件标签映射 ──
const SPEC_FILE_LABELS: Record<string, string> = {
  glossary: "00-glossary.md — 统一术语规范",
  openapi: "01-openapi.yaml — 接口契约（不可修改）",
  flow: "02-flow.md — 业务流程规范",
  scenarios: "03-scenarios.md — 关键场景与异常处理",
  runtime_rules: "04-runtime-rules.md — 运行时规则",
  observability: "05-observability.md — 可观测性规范",
  testcases: "06-testcases.md — 测试策略与验收",
};
