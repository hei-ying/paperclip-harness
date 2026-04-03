/**
 * 渠道对接规范包 API 路由
 *
 * 提供规范包 CRUD、GATE 检查、AI Agent 约束注入等 API。
 */

import { Router } from "express";
import { randomUUID } from "crypto";

// 类型定义（实际项目中从 schema 导入）
interface SpecPackage {
  id: string;
  companyId: string;
  projectId: string;
  version: number;
  status: string;
  gate1Status: string;
  gate2Status: string;
  gate3Status: string;
  gate1Result: any;
  gate2Result: any;
  gate3Result: any;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SpecFile {
  id: string;
  specPackageId: string;
  companyId: string;
  templateType: string;
  fileName: string;
  content: string | null;
  fileStatus: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface SpecIssue {
  id: string;
  specPackageId: string;
  companyId: string;
  issueType: string;
  source: string;
  severity: string;
  relatedFiles: string[] | null;
  title: string;
  description: string | null;
  suggestion: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// 内存存储（生产环境替换为数据库）
const specPackages = new Map<string, SpecPackage>();
const specFiles = new Map<string, SpecFile>();
const specIssues = new Map<string, SpecIssue>();

// ── 规范包文件模板 ──
const SPEC_TEMPLATES = [
  {
    templateType: "glossary",
    fileName: "00-glossary.md",
    priority: 3,
    label: "统一术语规范",
    template: `# Glossary — 统一术语规范

> 所有业务术语、渠道术语、字段语义必须以本文件为准。

| 统一术语 | 渠道术语 | 内部术语 | 定义 | 同义词 | 禁用命名 | 备注 |
|---|---|---|---|---|---|---|
| | | | | | | |

## 约束
- flow.md、scenarios.md、testcases.md 中出现的核心术语必须引用本文件
- 若出现未定义术语，必须先补齐术语定义
`,
  },
  {
    templateType: "openapi",
    fileName: "01-openapi.yaml",
    priority: 1,
    label: "接口契约",
    template: `# 接口契约 — 01-openapi.yaml
# ⚠️ 此文件为外部契约，不得在实现阶段擅自修改
# 若发现与渠道官方文档冲突，应进入问题处理流程

openapi: "3.0.3"
info:
  title: "渠道接口"
  version: "1.0.0"
paths: {}
`,
  },
  {
    templateType: "flow",
    fileName: "02-flow.md",
    priority: 4,
    label: "业务流程规范",
    template: `# 业务流程规范 — 02-flow.md

## 主流程
（描述主要业务流程）

## 关键业务节点
（列出关键节点及输入输出）

## 状态机
（描述状态变化）

## 流程图
（可使用 mermaid 或文字描述）
`,
  },
  {
    templateType: "scenarios",
    fileName: "03-scenarios.md",
    priority: 5,
    label: "关键场景与异常处理",
    template: `# 关键场景与异常处理 — 03-scenarios.md

## 必须覆盖的场景
- [ ] 幂等重复提交
- [ ] 查询接口返回未知状态
- [ ] 回调先于查询返回
- [ ] 渠道成功但本地落库失败
- [ ] 网络超时但渠道实际成功
- [ ] 同一错误码在不同接口语义不同

## 异常场景
（详细描述每个异常场景的预期处理方式）
`,
  },
  {
    templateType: "runtime_rules",
    fileName: "04-runtime-rules.md",
    priority: 6,
    label: "运行时规则",
    template: `# 运行时规则 — 04-runtime-rules.md

## Timeout 策略
- 连接超时: ____
- 读取超时: ____
- 总超时: ____

## Retry Policy
- 重试次数: ____
- 重试间隔: ____
- 重试条件: ____

## Idempotency
- 幂等 Key 规则: ____

## Rate Limit
- 限流策略: ____

## 日志脱敏
- 脱敏字段清单: ____

## 人工补偿条件
- ____
`,
  },
  {
    templateType: "observability",
    fileName: "05-observability.md",
    priority: 7,
    label: "可观测性规范",
    template: `# 可观测性规范 — 05-observability.md

## Trace
- traceId/requestId 透传规则: ____

## 日志规范
- 请求日志: ____
- 响应日志: ____

## 脱敏字段
- ____

## 告警条件
- ____

## 重放/补偿支持
- ____
`,
  },
  {
    templateType: "testcases",
    fileName: "06-testcases.md",
    priority: 8,
    label: "测试策略",
    template: `# 测试策略 — 06-testcases.md

## 单元测试
- 覆盖: 本地映射、状态转换、签名逻辑、组包逻辑、错误码映射

## 契约测试
- 覆盖: 请求结构与 openapi.yaml 一致、响应解析一致、枚举/字段类型/必填项

## 场景测试
- 正常路径
- 幂等场景
- 失败场景
- 超时与重试
- 回调/查询竞态
- 本地失败/渠道成功
- 渠道错误码差异
`,
  },
];

const DOD_ITEMS = [
  { itemKey: "spec_complete", label: "规范包齐全并已通过 GATE" },
  { itemKey: "blocking_issues_closed", label: "所有阻塞性未决问题已关闭" },
  { itemKey: "impl_complete", label: "实现代码完成" },
  { itemKey: "unit_test_pass", label: "单元测试通过" },
  { itemKey: "contract_test_pass", label: "契约测试通过" },
  { itemKey: "scenario_test_pass", label: "场景测试通过" },
  { itemKey: "exception_covered", label: "关键异常路径已覆盖" },
  { itemKey: "runtime_rules_done", label: "runtime-rules 要求已落地" },
  { itemKey: "observability_done", label: "observability 要求已落地" },
  { itemKey: "integration_pass", label: "联调结果满足预期" },
  { itemKey: "no_unapproved_assumptions", label: "未记录任何未经批准的实现假设" },
];

// ── GATE 检查逻辑（简化版，实际引用 spec-gate-service） ──

function runGate1Check(files: SpecFile[]): any {
  const errors: any[] = [];
  const warnings: any[] = [];
  const required = SPEC_TEMPLATES.map((t) => t.fileName);
  const existing = new Set(files.map((f) => f.fileName));

  for (const req of required) {
    if (!existing.has(req)) errors.push({ file: req, message: `缺少必要文件: ${req}` });
  }
  for (const f of files) {
    if (!f.content || f.content.trim().length === 0) {
      errors.push({ file: f.fileName, message: `文件为空: ${f.fileName}` });
    }
    if (f.content) {
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/TODO|TBD|PLACEHOLDER|待补充|待确认/i.test(line) && line.length < 100) {
          errors.push({ file: f.fileName, field: `line ${i + 1}`, message: `占位内容: "${line}"` });
        }
      }
    }
  }

  return { passed: errors.length === 0, checkedAt: new Date().toISOString(), errors, warnings };
}

function runGate2RuleCheck(files: SpecFile[]): any {
  const errors: any[] = [];
  const warnings: any[] = [];
  const runtime = files.find((f) => f.templateType === "runtime_rules");
  const observability = files.find((f) => f.templateType === "observability");
  const scenarios = files.find((f) => f.templateType === "scenarios");

  if (runtime?.content) {
    for (const rule of ["timeout", "retry", "idempoten"]) {
      if (!runtime.content.toLowerCase().includes(rule)) {
        errors.push({ file: "04-runtime-rules.md", message: `缺少必要规则: ${rule}` });
      }
    }
  }
  if (observability?.content) {
    if (!observability.content.toLowerCase().includes("trace")) {
      warnings.push({ file: "05-observability.md", message: "未提及 traceId/链路追踪" });
    }
  }
  if (scenarios?.content) {
    for (const s of ["幂等", "超时", "重试", "回调"]) {
      if (!scenarios.content.includes(s)) {
        warnings.push({ file: "03-scenarios.md", message: `未覆盖场景: ${s}` });
      }
    }
  }

  return { passed: errors.length === 0, checkedAt: new Date().toISOString(), errors, warnings };
}

function runGate3Check(issues: SpecIssue[]): any {
  const errors: any[] = [];
  const warnings: any[] = [];
  const blocking = issues.filter((i) => i.severity === "blocking" && !i.resolution);
  for (const issue of blocking) {
    errors.push({ message: `阻塞性问题未关闭: [${issue.issueType}] ${issue.title}` });
  }
  return { passed: errors.length === 0, checkedAt: new Date().toISOString(), errors, warnings };
}

function generateAgentCodingPrompt(files: SpecFile[]): string {
  const map = new Map(files.map((f) => [f.templateType, f.content || ""]));
  return `你是渠道对接开发者。严格根据以下规范文件实现，不要自行发明规则：
1. glossary.md: ${map.get("glossary") || "缺失"}
2. openapi.yaml: ${map.get("openapi") || "缺失"}
3. flow.md: ${map.get("flow") || "缺失"}
4. scenarios.md: ${map.get("scenarios") || "缺失"}
5. runtime-rules.md: ${map.get("runtime_rules") || "缺失"}
6. observability.md: ${map.get("observability") || "缺失"}
7. testcases.md: ${map.get("testcases") || "缺失"}
实现要求：术语以 glossary 为准，接口以 openapi 为准，运行时以 runtime-rules 为准，异常以 scenarios 为准，日志以 observability 为准，必须附带测试，遇到歧义先输出问题清单，不得补充未定义规则。`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 路由
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function createSpecRoutes(): Router {
  const router = Router();

  // ── 规范包 CRUD ──

  /** 创建规范包（为项目初始化 7 个模板文件） */
  router.post("/api/projects/:projectId/spec-package", async (req, res) => {
    const { projectId } = req.params;
    const companyId = req.headers["x-company-id"] as string;

    const pkg: SpecPackage = {
      id: randomUUID(),
      companyId,
      projectId,
      version: 1,
      status: "draft",
      gate1Status: "pending",
      gate2Status: "pending",
      gate3Status: "pending",
      gate1Result: null,
      gate2Result: null,
      gate3Result: null,
      approvedByUserId: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    specPackages.set(pkg.id, pkg);

    // 创建 7 个模板文件
    const files: SpecFile[] = SPEC_TEMPLATES.map((t) => ({
      id: randomUUID(),
      specPackageId: pkg.id,
      companyId,
      templateType: t.templateType,
      fileName: t.fileName,
      content: t.template,
      fileStatus: "draft",
      priority: t.priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    for (const f of files) specFiles.set(f.id, f);

    res.json({ specPackage: pkg, files });
  });

  /** 获取规范包（含所有文件） */
  router.get("/api/projects/:projectId/spec-package", async (req, res) => {
    const { projectId } = req.params;
    const companyId = req.headers["x-company-id"] as string;

    const pkg = [...specPackages.values()].find(
      (p) => p.projectId === projectId && p.companyId === companyId,
    );
    if (!pkg) return res.status(404).json({ error: "Spec package not found" });

    const files = [...specFiles.values()].filter((f) => f.specPackageId === pkg.id);
    const issues = [...specIssues.values()].filter((i) => i.specPackageId === pkg.id);

    res.json({ specPackage: pkg, files, issues });
  });

  /** 更新规范包文件内容 */
  router.put("/api/spec-files/:fileId", async (req, res) => {
    const { fileId } = req.params;
    const { content } = req.body;

    const file = specFiles.get(fileId);
    if (!file) return res.status(404).json({ error: "File not found" });

    file.content = content;
    file.fileStatus = content && content.trim().length > 0 ? "complete" : "draft";
    file.updatedAt = new Date().toISOString();

    // 重置 GATE 状态（规范包变更后需重新检查）
    const pkg = specPackages.get(file.specPackageId);
    if (pkg) {
      pkg.gate1Status = "pending";
      pkg.gate2Status = "pending";
      pkg.updatedAt = new Date().toISOString();
      specPackages.set(pkg.id, pkg);
    }

    res.json(file);
  });

  // ── GATE 检查 ──

  /** GATE-1：完整性检查 */
  router.post("/api/spec-packages/:pkgId/gate/1", async (req, res) => {
    const { pkgId } = req.params;
    const pkg = specPackages.get(pkgId);
    if (!pkg) return res.status(404).json({ error: "Spec package not found" });

    const files = [...specFiles.values()].filter((f) => f.specPackageId === pkgId);
    const result = runGate1Check(files);

    pkg.gate1Status = result.passed ? "passed" : "failed";
    pkg.gate1Result = result;
    pkg.updatedAt = new Date().toISOString();
    specPackages.set(pkgId, pkg);

    res.json({ gate: "GATE-1", result });
  });

  /** GATE-2：一致性检查 */
  router.post("/api/spec-packages/:pkgId/gate/2", async (req, res) => {
    const { pkgId } = req.params;
    const pkg = specPackages.get(pkgId);
    if (!pkg) return res.status(404).json({ error: "Spec package not found" });

    const files = [...specFiles.values()].filter((f) => f.specPackageId === pkgId);
    const result = runGate2RuleCheck(files);

    pkg.gate2Status = result.passed ? "passed" : "failed";
    pkg.gate2Result = result;
    pkg.updatedAt = new Date().toISOString();
    specPackages.set(pkgId, pkg);

    res.json({ gate: "GATE-2", result });
  });

  /** GATE-3：未决问题检查 */
  router.post("/api/spec-packages/:pkgId/gate/3", async (req, res) => {
    const { pkgId } = req.params;
    const pkg = specPackages.get(pkgId);
    if (!pkg) return res.status(404).json({ error: "Spec package not found" });

    const issues = [...specIssues.values()].filter((i) => i.specPackageId === pkgId);
    const result = runGate3Check(issues);

    pkg.gate3Status = result.passed ? "passed" : "failed";
    pkg.gate3Result = result;
    pkg.updatedAt = new Date().toISOString();
    specPackages.set(pkgId, pkg);

    res.json({ gate: "GATE-3", result });
  });

  /** 一键执行所有 GATE */
  router.post("/api/spec-packages/:pkgId/gate/all", async (req, res) => {
    const { pkgId } = req.params;
    const pkg = specPackages.get(pkgId);
    if (!pkg) return res.status(404).json({ error: "Spec package not found" });

    const files = [...specFiles.values()].filter((f) => f.specPackageId === pkgId);
    const issues = [...specIssues.values()].filter((i) => i.specPackageId === pkgId);

    const gate1 = runGate1Check(files);
    const gate2 = gate1.passed ? runGate2RuleCheck(files) : { passed: false, checkedAt: new Date().toISOString(), errors: [{ message: "GATE-1 未通过，跳过 GATE-2" }], warnings: [] };
    const gate3 = gate2.passed ? runGate3Check(issues) : { passed: false, checkedAt: new Date().toISOString(), errors: [{ message: "GATE-2 未通过，跳过 GATE-3" }], warnings: [] };

    pkg.gate1Status = gate1.passed ? "passed" : "failed";
    pkg.gate2Status = gate2.passed ? "passed" : "failed";
    pkg.gate3Status = gate3.passed ? "passed" : "failed";
    pkg.gate1Result = gate1;
    pkg.gate2Result = gate2;
    pkg.gate3Result = gate3;
    pkg.updatedAt = new Date().toISOString();

    if (gate1.passed && gate2.passed && gate3.passed) {
      pkg.status = "approved";
    }

    specPackages.set(pkgId, pkg);

    res.json({
      overallPassed: gate1.passed && gate2.passed && gate3.passed,
      gate1,
      gate2,
      gate3,
    });
  });

  // ── 未决问题管理 ──

  /** 创建问题（GATE 检查自动或手动创建） */
  router.post("/api/spec-packages/:pkgId/issues", async (req, res) => {
    const { pkgId } = req.params;
    const { issueType, source, severity, title, description, suggestion, relatedFiles } = req.body;
    const companyId = req.headers["x-company-id"] as string;

    const issue: SpecIssue = {
      id: randomUUID(),
      specPackageId: pkgId,
      companyId,
      issueType,
      source,
      severity: severity || "blocking",
      relatedFiles: relatedFiles || null,
      title,
      description: description || null,
      suggestion: suggestion || null,
      resolution: null,
      resolutionNote: null,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    specIssues.set(issue.id, issue);
    res.json(issue);
  });

  /** 解决问题 */
  router.put("/api/spec-issues/:issueId/resolve", async (req, res) => {
    const { issueId } = req.params;
    const { resolution, resolutionNote } = req.body;
    const userId = req.headers["x-user-id"] as string;

    const issue = specIssues.get(issueId);
    if (!issue) return res.status(404).json({ error: "Issue not found" });

    issue.resolution = resolution;
    issue.resolutionNote = resolutionNote || null;
    issue.resolvedByUserId = userId || null;
    issue.resolvedAt = new Date().toISOString();
    issue.updatedAt = new Date().toISOString();
    specIssues.set(issueId, issue);

    res.json(issue);
  });

  // ── AI Agent 编码约束 ──

  /** 生成 AI Agent 编码约束提示词 */
  router.get("/api/spec-packages/:pkgId/agent-prompt", async (req, res) => {
    const { pkgId } = req.params;
    const pkg = specPackages.get(pkgId);
    if (!pkg) return res.status(404).json({ error: "Spec package not found" });

    // 只有 approved 状态才能生成
    if (pkg.status !== "approved") {
      return res.status(400).json({ error: "Spec package must be approved before generating agent prompt" });
    }

    const files = [...specFiles.values()].filter((f) => f.specPackageId === pkgId);
    const prompt = generateAgentCodingPrompt(files);

    res.json({ prompt, specPackageId: pkgId });
  });

  // ── DoD 检查清单 ──

  /** 获取 DoD 检查清单 */
  router.get("/api/spec-packages/:pkgId/dod", async (req, res) => {
    const { pkgId } = req.params;
    res.json({ items: DOD_ITEMS, specPackageId: pkgId });
  });

  return router;
}

export { SPEC_TEMPLATES, DOD_ITEMS };
