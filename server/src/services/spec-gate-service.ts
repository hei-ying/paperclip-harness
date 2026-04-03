/**
 * 渠道对接规范包 — GATE 检查服务
 *
 * 实现 GATE-1（完整性）、GATE-2（一致性）、GATE-3（未决问题）三级门禁检查。
 */

import type { GateCheckResult } from "./spec-gate-service-types.js";

// ── 规范包 7 个必须文件 ──
const REQUIRED_FILES = [
  "00-glossary.md",
  "01-openapi.yaml",
  "02-flow.md",
  "03-scenarios.md",
  "04-runtime-rules.md",
  "05-observability.md",
  "06-testcases.md",
] as const;

export interface SpecFileEntry {
  fileName: string;
  content: string | null;
  fileStatus: string;
  templateType: string;
  priority: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GATE-1：完整性检查（全自动）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function runGate1Check(files: SpecFileEntry[]): GateCheckResult {
  const errors: GateCheckResult["errors"] = [];
  const warnings: GateCheckResult["warnings"] = [];

  // 1. 检查文件是否齐全
  const existingFileNames = new Set(files.map((f) => f.fileName));
  for (const required of REQUIRED_FILES) {
    if (!existingFileNames.has(required)) {
      errors.push({
        file: required,
        message: `缺少必要文件: ${required}`,
      });
    }
  }

  // 2. 检查每个文件是否有内容
  for (const file of files) {
    if (!file.content || file.content.trim().length === 0) {
      errors.push({
        file: file.fileName,
        message: `文件为空: ${file.fileName}`,
      });
    }

    // 3. 检查是否有 TODO / 占位符
    if (file.content) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
          /TODO/i.test(line) ||
          /TBD/i.test(line) ||
          /\bPLACEHOLDER\b/i.test(line) ||
          /\b待补充\b/.test(line) ||
          /\b待确认\b/.test(line) ||
          /^\s*[-*]\s*$/i.test(line) // 空列表项
        ) {
          errors.push({
            file: file.fileName,
            field: `line ${i + 1}`,
            message: `阻塞性占位内容: "${line.substring(0, 80)}"`,
          });
        }
      }
    }
  }

  // 4. 检查 glossary 是否有空定义
  const glossary = files.find((f) => f.templateType === "glossary");
  if (glossary?.content) {
    if (!glossary.content.includes("|") && !glossary.content.includes("---")) {
      warnings.push({
        file: glossary.fileName,
        message: "术语表可能缺少表格结构",
      });
    }
  }

  // 5. 检查 openapi.yaml 是否有效
  const openapi = files.find((f) => f.templateType === "openapi");
  if (openapi?.content) {
    if (!openapi.content.includes("openapi:") && !openapi.content.includes("swagger:")) {
      warnings.push({
        file: openapi.fileName,
        message: "openapi.yaml 可能缺少标准 API 规范头",
      });
    }
  }

  return {
    passed: errors.length === 0,
    checkedAt: new Date().toISOString(),
    errors,
    warnings,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GATE-2：一致性检查（AI 辅助，此处为规则引擎部分）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function runGate2RuleCheck(files: SpecFileEntry[]): GateCheckResult {
  const errors: GateCheckResult["errors"] = [];
  const warnings: GateCheckResult["warnings"] = [];

  const glossary = files.find((f) => f.templateType === "glossary");
  const flow = files.find((f) => f.templateType === "flow");
  const scenarios = files.find((f) => f.templateType === "scenarios");
  const openapi = files.find((f) => f.templateType === "openapi");
  const runtimeRules = files.find((f) => f.templateType === "runtime_rules");
  const observability = files.find((f) => f.templateType === "observability");
  const testcases = files.find((f) => f.templateType === "testcases");

  // 1. 提取 glossary 术语
  const glossaryTerms = extractGlossaryTerms(glossary?.content ?? undefined);

  // 2. 检查 flow.md 中的关键术语是否在 glossary 中定义
  if (flow?.content && glossaryTerms.size > 0) {
    const flowTerms = extractKeyTerms(flow.content);
    for (const term of flowTerms) {
      if (!glossaryTerms.has(term) && term.length > 2) {
        warnings.push({
          file: "02-flow.md",
          message: `术语 "${term}" 在 flow.md 中出现但未在 glossary.md 中定义`,
        });
      }
    }
  }

  // 3. 检查 scenarios.md 中的关键术语
  if (scenarios?.content && glossaryTerms.size > 0) {
    const scenarioTerms = extractKeyTerms(scenarios.content);
    for (const term of scenarioTerms) {
      if (!glossaryTerms.has(term) && term.length > 2) {
        warnings.push({
          file: "03-scenarios.md",
          message: `术语 "${term}" 在 scenarios.md 中出现但未在 glossary.md 中定义`,
        });
      }
    }
  }

  // 4. 检查 scenarios 是否覆盖了必要场景
  if (scenarios?.content) {
    const requiredScenarios = [
      "幂等",
      "超时",
      "重试",
      "回调",
      "查询",
      "失败",
    ];
    for (const scenario of requiredScenarios) {
      if (!scenarios.content.includes(scenario)) {
        warnings.push({
          file: "03-scenarios.md",
          message: `scenarios.md 未覆盖必要场景: ${scenario}`,
        });
      }
    }
  }

  // 5. 检查 runtime-rules 是否定义了 timeout 和 retry
  if (runtimeRules?.content) {
    const requiredRules = ["timeout", "retry", "idempoten"];
    for (const rule of requiredRules) {
      if (!runtimeRules.content.toLowerCase().includes(rule)) {
        errors.push({
          file: "04-runtime-rules.md",
          message: `runtime-rules.md 缺少必要规则: ${rule}`,
        });
      }
    }
  }

  // 6. 检查 observability 是否定义了 traceId
  if (observability?.content) {
    if (
      !observability.content.toLowerCase().includes("trace") &&
      !observability.content.toLowerCase().includes("traceid")
    ) {
      warnings.push({
        file: "05-observability.md",
        message: "observability.md 未提及 traceId/链路追踪",
      });
    }
    if (
      !observability.content.toLowerCase().includes("脱敏") &&
      !observability.content.toLowerCase().includes("mask")
    ) {
      warnings.push({
        file: "05-observability.md",
        message: "observability.md 未提及脱敏规则",
      });
    }
  }

  // 7. 检查 testcases 是否覆盖三层测试
  if (testcases?.content) {
    const requiredTestLayers = ["单元测试", "契约测试", "场景测试"];
    for (const layer of requiredTestLayers) {
      if (!testcases.content.includes(layer)) {
        warnings.push({
          file: "06-testcases.md",
          message: `testcases.md 未覆盖测试层: ${layer}`,
        });
      }
    }
  }

  return {
    passed: errors.length === 0,
    checkedAt: new Date().toISOString(),
    errors,
    warnings,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GATE-3：未决问题关闭检查
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SpecIssue {
  id: string;
  issueType: string;
  source: string;
  severity: string;
  title: string;
  resolution: string | null;
}

export function runGate3Check(issues: SpecIssue[]): GateCheckResult {
  const errors: GateCheckResult["errors"] = [];
  const warnings: GateCheckResult["warnings"] = [];

  // 1. 检查是否还有未关闭的阻塞性问题
  const blockingIssues = issues.filter(
    (i) => i.severity === "blocking" && !i.resolution,
  );
  for (const issue of blockingIssues) {
    errors.push({
      message: `阻塞性问题未关闭: [${issue.issueType}] ${issue.title}`,
    });
  }

  // 2. 检查渠道查询类问题是否有确认
  const channelQueries = issues.filter(
    (i) => i.issueType === "channel_query" && !i.resolution,
  );
  for (const issue of channelQueries) {
    warnings.push({
      message: `渠道确认问题待处理: ${issue.title}`,
    });
  }

  return {
    passed: errors.length === 0,
    checkedAt: new Date().toISOString(),
    errors,
    warnings,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI Agent 编码约束提示词生成
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function generateAgentCodingPrompt(files: SpecFileEntry[]): string {
  const fileMap = new Map(files.map((f) => [f.templateType, f.content || ""]));

  return `你是渠道对接开发者。请严格根据以下规范文件进行实现，不要自行发明业务规则：

## 规范文件

### 1. 术语规范 (glossary.md)
${fileMap.get("glossary") || "（缺失）"}

### 2. 接口契约 (openapi.yaml) — 不可修改
${fileMap.get("openapi") || "（缺失）"}

### 3. 业务流程 (flow.md)
${fileMap.get("flow") || "（缺失）"}

### 4. 异常场景 (scenarios.md)
${fileMap.get("scenarios") || "（缺失）"}

### 5. 运行时规则 (runtime-rules.md)
${fileMap.get("runtime_rules") || "（缺失）"}

### 6. 可观测性规范 (observability.md)
${fileMap.get("observability") || "（缺失）"}

### 7. 测试策略 (testcases.md)
${fileMap.get("testcases") || "（缺失）"}

## 实现要求
- 所有术语以 glossary.md 为准
- 所有接口行为以 openapi.yaml 为准
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
8. testcases.md`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 工具函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 从 glossary 内容提取已定义术语 */
function extractGlossaryTerms(content: string | undefined): Set<string> {
  const terms = new Set<string>();
  if (!content) return terms;

  // 匹配 markdown 表格第一列（统一术语）
  const tableRows = content.split("\n").filter((line) => line.includes("|"));
  for (const row of tableRows.slice(2)) {
    // 跳过表头分隔行
    if (/^[\s|:-]+$/.test(row)) continue;
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length > 0 && !cells[0].startsWith("---")) {
      terms.add(cells[0].toLowerCase());
    }
  }

  return terms;
}

/** 从文档中提取可能是业务术语的关键词 */
function extractKeyTerms(content: string): string[] {
  // 简单提取：中文词组（2-6字）和英文驼峰/下划线标识符
  const terms = new Set<string>();

  // 英文标识符
  const idMatches = content.match(/\b[a-zA-Z][a-zA-Z0-9_]{2,}\b/g) || [];
  for (const m of idMatches) {
    if (m.length <= 20 && !["the", "and", "for", "with", "from", "that", "this"].includes(m.toLowerCase())) {
      terms.add(m);
    }
  }

  return Array.from(terms);
}
