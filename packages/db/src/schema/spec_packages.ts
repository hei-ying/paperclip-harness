import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { companies } from "./companies.js";

// ── 规范包 ──
// 每个项目对应一个规范包，版本化管理
export const specPackages = pgTable(
  "spec_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"), // draft | review | approved | rejected
    // GATE 状态
    gate1Status: text("gate1_status").notNull().default("pending"), // pending | passed | failed
    gate2Status: text("gate2_status").notNull().default("pending"),
    gate3Status: text("gate3_status").notNull().default("pending"),
    // GATE 检查结果（JSON）
    gate1Result: jsonb("gate1_result").$type<GateCheckResult>(),
    gate2Result: jsonb("gate2_result").$type<GateCheckResult>(),
    gate3Result: jsonb("gate3_result").$type<GateCheckResult>(),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("spec_packages_company_idx").on(table.companyId),
    projectIdx: index("spec_packages_project_idx").on(table.projectId),
    projectVersionIdx: uniqueIndex("spec_packages_project_version_uq").on(
      table.projectId,
      table.version,
    ),
  }),
);

// ── 规范包文件 ──
// 对应规范文档中的 7 个标准文件
export const specFiles = pgTable(
  "spec_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specPackageId: uuid("spec_package_id").notNull().references(() => specPackages.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // 文件类型（对应规范包中的 7 个文件）
    templateType: text("template_type").notNull(), // glossary | openapi | flow | scenarios | runtime_rules | observability | testcases
    // 文件名
    fileName: text("file_name").notNull(),
    // 文件内容
    content: text("content"),
    // 文件状态
    fileStatus: text("file_status").notNull().default("missing"), // missing | draft | complete
    // 优先级（规范权威顺序 1-8）
    priority: integer("priority").notNull().default(5),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    specPackageIdx: index("spec_files_spec_package_idx").on(table.specPackageId),
    companyTypeIdx: uniqueIndex("spec_files_spec_package_type_uq").on(
      table.specPackageId,
      table.templateType,
    ),
  }),
);

// ── 未决问题 ──
// GATE 检查发现的问题追踪
export const specIssues = pgTable(
  "spec_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specPackageId: uuid("spec_package_id").notNull().references(() => specPackages.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // 问题类型
    issueType: text("issue_type").notNull(), // spec_gap | channel_query | conflict | missing_coverage
    // 来源
    source: text("source").notNull(), // gate1 | gate2 | implementation | manual
    // 优先级
    severity: text("severity").notNull().default("blocking"), // blocking | warning | info
    // 涉及文件
    relatedFiles: jsonb("related_files").$type<string[]>(),
    // 问题描述
    title: text("title").notNull(),
    description: text("description"),
    // 建议处理方式
    suggestion: text("suggestion"),
    // 解决状态
    resolution: text("resolution"), // null | confirmed | approved_exception | deferred | fixed
    resolutionNote: text("resolution_note"),
    resolvedByUserId: text("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    specPackageIdx: index("spec_issues_spec_package_idx").on(table.specPackageId),
    companyStatusIdx: index("spec_issues_company_status_idx").on(
      table.companyId,
      table.resolution,
    ),
  }),
);

// ── 完成定义检查清单 ──
export const specDODChecklist = pgTable(
  "spec_dod_checklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specPackageId: uuid("spec_package_id").notNull().references(() => specPackages.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // 检查项
    itemKey: text("item_key").notNull(),
    label: text("label").notNull(),
    checked: integer("checked").notNull().default(0), // 0 | 1
    checkedByUserId: text("checked_by_user_id"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    specPackageIdx: index("spec_dod_checklist_spec_package_idx").on(table.specPackageId),
    specPackageKeyIdx: uniqueIndex("spec_dod_checklist_spec_package_key_uq").on(
      table.specPackageId,
      table.itemKey,
    ),
  }),
);

// ── 类型定义 ──
export interface GateCheckResult {
  passed: boolean;
  checkedAt: string;
  errors: Array<{ file?: string; field?: string; message: string }>;
  warnings: Array<{ file?: string; field?: string; message: string }>;
}

// 规范包文件模板类型
export const SPEC_FILE_TEMPLATES = [
  { templateType: "glossary",      fileName: "00-glossary.md",         priority: 3, label: "统一术语规范" },
  { templateType: "openapi",       fileName: "01-openapi.yaml",        priority: 1, label: "接口契约" },
  { templateType: "flow",          fileName: "02-flow.md",             priority: 4, label: "业务流程规范" },
  { templateType: "scenarios",     fileName: "03-scenarios.md",        priority: 5, label: "关键场景与异常处理" },
  { templateType: "runtime_rules", fileName: "04-runtime-rules.md",    priority: 6, label: "运行时规则" },
  { templateType: "observability", fileName: "05-observability.md",    priority: 7, label: "可观测性规范" },
  { templateType: "testcases",     fileName: "06-testcases.md",        priority: 8, label: "测试策略与验收" },
] as const;

// DoD 检查项
export const DOD_ITEMS = [
  { itemKey: "spec_complete",       label: "规范包齐全并已通过 GATE" },
  { itemKey: "blocking_issues_closed", label: "所有阻塞性未决问题已关闭" },
  { itemKey: "impl_complete",       label: "实现代码完成" },
  { itemKey: "unit_test_pass",      label: "单元测试通过" },
  { itemKey: "contract_test_pass",  label: "契约测试通过" },
  { itemKey: "scenario_test_pass",  label: "场景测试通过" },
  { itemKey: "exception_covered",   label: "关键异常路径已覆盖" },
  { itemKey: "runtime_rules_done",  label: "runtime-rules 要求已落地" },
  { itemKey: "observability_done",  label: "observability 要求已落地" },
  { itemKey: "integration_pass",    label: "联调结果满足预期" },
  { itemKey: "no_unapproved_assumptions", label: "未记录任何未经批准的实现假设" },
] as const;
