/**
 * 渠道对接规范包 API 路由（数据库版）
 *
 * 使用 Drizzle ORM 操作 spec_packages / spec_files / spec_issues / spec_dod_checklist 表。
 */

import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { desc, eq, and } from "drizzle-orm";
import { assertCompanyAccess } from "./authz.js";
import {
  specPackages,
  specFiles,
  specIssues,
  specDODChecklist,
  DOD_ITEMS,
} from "@paperclipai/db";
import type { GateCheckResult } from "../services/spec-gate-service-types.js";
import {
  runGate1Check,
  runGate2RuleCheck,
  runGate3Check,
  generateAgentCodingPrompt,
} from "../services/spec-gate-service.js";

// ── 规范包文件模板 ──
const SPEC_TEMPLATES = [
  {
    templateType: "glossary" as const,
    fileName: "00-glossary.md",
    priority: 3,
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
    templateType: "openapi" as const,
    fileName: "01-openapi.yaml",
    priority: 1,
    template: `# 接口契约 — 01-openapi.yaml
# ⚠️ 此文件为外部契约，不得在实现阶段擅自修改

openapi: "3.0.3"
info:
  title: "渠道接口"
  version: "1.0.0"
paths: {}
`,
  },
  {
    templateType: "flow" as const,
    fileName: "02-flow.md",
    priority: 4,
    template: `# 业务流程规范 — 02-flow.md

## 主流程
（描述主要业务流程）

## 关键业务节点
（列出关键节点及输入输出）

## 状态机
（描述状态变化）
`,
  },
  {
    templateType: "scenarios" as const,
    fileName: "03-scenarios.md",
    priority: 5,
    template: `# 关键场景与异常处理 — 03-scenarios.md

## 必须覆盖的场景
- [ ] 幂等重复提交
- [ ] 查询接口返回未知状态
- [ ] 回调先于查询返回
- [ ] 渠道成功但本地落库失败
- [ ] 网络超时但渠道实际成功
- [ ] 同一错误码在不同接口语义不同
`,
  },
  {
    templateType: "runtime_rules" as const,
    fileName: "04-runtime-rules.md",
    priority: 6,
    template: `# 运行时规则 — 04-runtime-rules.md

## Timeout 策略
- 连接超时: ____
- 读取超时: ____

## Retry Policy
- 重试次数: ____
- 重试间隔: ____

## Idempotency
- 幂等 Key 规则: ____

## 日志脱敏
- 脱敏字段清单: ____
`,
  },
  {
    templateType: "observability" as const,
    fileName: "05-observability.md",
    priority: 7,
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
`,
  },
  {
    templateType: "testcases" as const,
    fileName: "06-testcases.md",
    priority: 8,
    template: `# 测试策略 — 06-testcases.md

## 单元测试
- 覆盖: 本地映射、状态转换、签名逻辑、组包逻辑、错误码映射

## 契约测试
- 覆盖: 请求结构与 openapi.yaml 一致

## 场景测试
- 正常路径 / 幂等 / 失败 / 超时 / 重试 / 回调竞态 / 渠道错误码差异
`,
  },
];

// ── Helper: 获取 companyId（从请求上下文） ──
function resolveCompanyId(req: Request, fallback?: string): string {
  const actor = (req as any).actor;
  if (actor?.type === "agent" && actor.companyId) return actor.companyId;
  if (actor?.type === "board" && actor.companyIds?.length === 1) return actor.companyIds[0];
  if (fallback) return fallback;
  return "";
}

// ── Helper: 获取 userId ──
function resolveUserId(req: Request): string | null {
  const actor = (req as any).actor;
  return actor?.userId ?? actor?.actorId ?? null;
}

// ── Helper: files → gate check format ──
function toGateFiles(files: Array<{ fileName: string; content: string | null; fileStatus: string; templateType: string; priority: number }>) {
  return files;
}

// ── Helper: issues → gate3 format ──
function toGate3Issues(issues: Array<{ id: string; issueType: string; source: string; severity: string; title: string; resolution: string | null }>) {
  return issues.map((i) => ({
    id: i.id,
    issueType: i.issueType,
    source: i.source,
    severity: i.severity,
    title: i.title,
    resolution: i.resolution,
  }));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 路由工厂
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function createSpecRoutes(db: Db): Router {
  const router = Router();

  // ── 规范包 CRUD ──

  /** 创建规范包 */
  router.post("/api/projects/:projectId/spec-package", async (req: Request, res) => {
    const projectId = req.params.projectId as string;
    const companyId = req.body.companyId || resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    assertCompanyAccess(req, companyId);

    const existing = await db
      .select()
      .from(specPackages)
      .where(and(eq(specPackages.projectId, projectId), eq(specPackages.companyId, companyId)))
      .orderBy(desc(specPackages.version))
      .limit(1);

    const version = existing.length > 0 ? existing[0].version + 1 : 1;

    const [pkg] = await db
      .insert(specPackages)
      .values({ companyId, projectId, version, status: "draft" })
      .returning();

    const fileValues = SPEC_TEMPLATES.map((t) => ({
      specPackageId: pkg.id,
      companyId,
      templateType: t.templateType,
      fileName: t.fileName,
      content: t.template,
      fileStatus: "draft" as const,
      priority: t.priority,
    }));
    const files = await db.insert(specFiles).values(fileValues).returning();

    const dodValues = DOD_ITEMS.map((item) => ({
      specPackageId: pkg.id,
      companyId,
      itemKey: item.itemKey,
      label: item.label,
    }));
    await db.insert(specDODChecklist).values(dodValues);

    res.json({ specPackage: pkg, files });
  });

  /** 获取规范包 */
  router.get("/api/projects/:projectId/spec-package", async (req: Request, res) => {
    const projectId = req.params.projectId as string;
    const companyId = (req.query.companyId as string) || resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    assertCompanyAccess(req, companyId);

    const pkgRows = await db
      .select()
      .from(specPackages)
      .where(and(eq(specPackages.projectId, projectId), eq(specPackages.companyId, companyId)))
      .orderBy(desc(specPackages.version))
      .limit(1);

    if (pkgRows.length === 0) return res.status(404).json({ error: "Spec package not found" });
    const pkg = pkgRows[0];

    const [files, issues, dod] = await Promise.all([
      db.select().from(specFiles).where(eq(specFiles.specPackageId, pkg.id)),
      db.select().from(specIssues).where(eq(specIssues.specPackageId, pkg.id)),
      db.select().from(specDODChecklist).where(eq(specDODChecklist.specPackageId, pkg.id)),
    ]);

    res.json({ specPackage: pkg, files, issues, dod });
  });

  /** 更新规范包文件 */
  router.put("/api/spec-files/:fileId", async (req: Request, res) => {
    const fileId = req.params.fileId as string;
    const { content } = req.body;

    const fileRows = await db.select().from(specFiles).where(eq(specFiles.id, fileId)).limit(1);
    if (fileRows.length === 0) return res.status(404).json({ error: "File not found" });
    const file = fileRows[0];

    assertCompanyAccess(req, file.companyId);

    const [updated] = await db
      .update(specFiles)
      .set({
        content,
        fileStatus: content && content.trim().length > 0 ? "complete" : "draft",
        updatedAt: new Date(),
      })
      .where(eq(specFiles.id, fileId))
      .returning();

    await db
      .update(specPackages)
      .set({ gate1Status: "pending", gate2Status: "pending", updatedAt: new Date() })
      .where(eq(specPackages.id, file.specPackageId));

    res.json(updated);
  });

  // ── GATE 检查 ──

  /** GATE-1：完整性检查 */
  router.post("/api/spec-packages/:pkgId/gate/1", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    const pkg = pkgRows[0];
    assertCompanyAccess(req, pkg.companyId);

    const fileRows = await db.select().from(specFiles).where(eq(specFiles.specPackageId, pkgId));
    const result = runGate1Check(toGateFiles(fileRows));

    if (!result.passed) {
      for (const err of result.errors) {
        if (err.message.includes("缺少必要文件")) {
          await db.insert(specIssues).values({
            specPackageId: pkgId, companyId: pkg.companyId,
            issueType: "spec_gap", source: "gate1", severity: "blocking", title: err.message,
          });
        }
      }
    }

    const [updated] = await db
      .update(specPackages)
      .set({ gate1Status: result.passed ? "passed" : "failed", gate1Result: result as any, updatedAt: new Date() })
      .where(eq(specPackages.id, pkgId))
      .returning();

    res.json({ gate: "GATE-1", result, specPackage: updated });
  });

  /** GATE-2：一致性检查 */
  router.post("/api/spec-packages/:pkgId/gate/2", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    const pkg = pkgRows[0];
    assertCompanyAccess(req, pkg.companyId);

    if (pkg.gate1Status !== "passed") {
      return res.status(400).json({ error: "GATE-1 must pass first", gate1Status: pkg.gate1Status });
    }

    const fileRows = await db.select().from(specFiles).where(eq(specFiles.specPackageId, pkgId));
    const result = runGate2RuleCheck(toGateFiles(fileRows));

    for (const item of [...result.errors, ...result.warnings]) {
      await db.insert(specIssues).values({
        specPackageId: pkgId, companyId: pkg.companyId,
        issueType: item.message.includes("冲突") ? "conflict" : "missing_coverage",
        source: "gate2", severity: result.errors.includes(item) ? "blocking" : "warning",
        title: item.message, relatedFiles: item.file ? [item.file] : null,
      });
    }

    const [updated] = await db
      .update(specPackages)
      .set({ gate2Status: result.passed ? "passed" : "failed", gate2Result: result as any, updatedAt: new Date() })
      .where(eq(specPackages.id, pkgId))
      .returning();

    res.json({ gate: "GATE-2", result, specPackage: updated });
  });

  /** GATE-3：未决问题检查 */
  router.post("/api/spec-packages/:pkgId/gate/3", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    const pkg = pkgRows[0];
    assertCompanyAccess(req, pkg.companyId);

    if (pkg.gate2Status !== "passed") {
      return res.status(400).json({ error: "GATE-2 must pass first", gate2Status: pkg.gate2Status });
    }

    const issueRows = await db.select().from(specIssues).where(eq(specIssues.specPackageId, pkgId));
    const result = runGate3Check(toGate3Issues(issueRows));

    const [updated] = await db
      .update(specPackages)
      .set({
        gate3Status: result.passed ? "passed" : "failed",
        gate3Result: result as any,
        status: result.passed ? "approved" : "review",
        approvedAt: result.passed ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(specPackages.id, pkgId))
      .returning();

    res.json({ gate: "GATE-3", result, specPackage: updated });
  });

  /** 一键执行所有 GATE */
  router.post("/api/spec-packages/:pkgId/gate/all", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    const pkg = pkgRows[0];
    assertCompanyAccess(req, pkg.companyId);

    const fileRows = await db.select().from(specFiles).where(eq(specFiles.specPackageId, pkgId));
    const issueRows = await db.select().from(specIssues).where(eq(specIssues.specPackageId, pkgId));

    const gate1 = runGate1Check(toGateFiles(fileRows));

    const gate2: GateCheckResult = gate1.passed
      ? runGate2RuleCheck(toGateFiles(fileRows))
      : { passed: false, checkedAt: new Date().toISOString(), errors: [{ message: "GATE-1 未通过" }], warnings: [] };

    const gate3: GateCheckResult = gate2.passed
      ? runGate3Check(toGate3Issues(issueRows))
      : { passed: false, checkedAt: new Date().toISOString(), errors: [{ message: "GATE-2 未通过" }], warnings: [] };

    const overallPassed = gate1.passed && gate2.passed && gate3.passed;

    if (!gate1.passed) {
      for (const err of gate1.errors) {
        await db.insert(specIssues).values({
          specPackageId: pkgId, companyId: pkg.companyId,
          issueType: "spec_gap", source: "gate1", severity: "blocking", title: err.message,
        });
      }
    }

    const [updated] = await db
      .update(specPackages)
      .set({
        gate1Status: gate1.passed ? "passed" : "failed",
        gate2Status: gate2.passed ? "passed" : "failed",
        gate3Status: gate3.passed ? "passed" : "failed",
        gate1Result: gate1 as any,
        gate2Result: gate2 as any,
        gate3Result: gate3 as any,
        status: overallPassed ? "approved" : "review",
        approvedAt: overallPassed ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(specPackages.id, pkgId))
      .returning();

    res.json({ overallPassed, gate1, gate2, gate3, specPackage: updated });
  });

  // ── 问题管理 ──

  router.post("/api/spec-packages/:pkgId/issues", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    assertCompanyAccess(req, pkgRows[0].companyId);

    const { issueType, source, severity, title, description, suggestion, relatedFiles } = req.body;
    const [issue] = await db.insert(specIssues).values({
      specPackageId: pkgId, companyId: pkgRows[0].companyId,
      issueType, source, severity: severity || "blocking",
      relatedFiles: relatedFiles || null, title,
      description: description || null, suggestion: suggestion || null,
    }).returning();

    res.json(issue);
  });

  router.put("/api/spec-issues/:issueId/resolve", async (req: Request, res) => {
    const issueId = req.params.issueId as string;
    const { resolution, resolutionNote } = req.body;
    const issueRows = await db.select().from(specIssues).where(eq(specIssues.id, issueId)).limit(1);
    if (issueRows.length === 0) return res.status(404).json({ error: "Not found" });
    assertCompanyAccess(req, issueRows[0].companyId);

    const [updated] = await db.update(specIssues).set({
      resolution, resolutionNote: resolutionNote || null,
      resolvedByUserId: resolveUserId(req), resolvedAt: new Date(), updatedAt: new Date(),
    }).where(eq(specIssues.id, issueId)).returning();

    res.json(updated);
  });

  router.get("/api/spec-packages/:pkgId/issues", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    assertCompanyAccess(req, pkgRows[0].companyId);

    const issues = await db.select().from(specIssues).where(eq(specIssues.specPackageId, pkgId));
    res.json(issues);
  });

  // ── AI Agent 编码约束 ──

  router.get("/api/spec-packages/:pkgId/agent-prompt", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    const pkg = pkgRows[0];
    assertCompanyAccess(req, pkg.companyId);

    if (pkg.status !== "approved") {
      return res.status(400).json({ error: "Spec package must be approved", currentStatus: pkg.status });
    }

    const fileRows = await db.select().from(specFiles).where(eq(specFiles.specPackageId, pkgId));
    const prompt = generateAgentCodingPrompt(toGateFiles(fileRows));
    res.json({ prompt, specPackageId: pkgId, version: pkg.version });
  });

  // ── DoD 检查清单 ──

  router.get("/api/spec-packages/:pkgId/dod", async (req: Request, res) => {
    const pkgId = req.params.pkgId as string;
    const pkgRows = await db.select().from(specPackages).where(eq(specPackages.id, pkgId)).limit(1);
    if (pkgRows.length === 0) return res.status(404).json({ error: "Not found" });
    assertCompanyAccess(req, pkgRows[0].companyId);

    const dod = await db.select().from(specDODChecklist).where(eq(specDODChecklist.specPackageId, pkgId));
    res.json({ items: dod, specPackageId: pkgId });
  });

  router.put("/api/spec-dod/:dodId/toggle", async (req: Request, res) => {
    const dodId = req.params.dodId as string;
    const dodRows = await db.select().from(specDODChecklist).where(eq(specDODChecklist.id, dodId)).limit(1);
    if (dodRows.length === 0) return res.status(404).json({ error: "Not found" });
    assertCompanyAccess(req, dodRows[0].companyId);

    const newChecked = dodRows[0].checked ? 0 : 1;
    const [updated] = await db.update(specDODChecklist).set({
      checked: newChecked, checkedByUserId: resolveUserId(req),
      checkedAt: newChecked ? new Date() : null, updatedAt: new Date(),
    }).where(eq(specDODChecklist.id, dodId)).returning();

    res.json(updated);
  });

  return router;
}

export { SPEC_TEMPLATES };
