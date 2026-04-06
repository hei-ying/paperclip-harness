import { useState, useEffect, useCallback } from "react";
import {
  specApi,
  type SpecPackageResponse,
  type SpecFile,
  type SpecIssue,
  type DODItem,
  type GateResult,
} from "../api/spec-packages";

const FILE_LABELS: Record<string, string> = {
  glossary: "📋 术语规范",
  openapi: "🔌 接口契约",
  flow: "🔄 业务流程",
  scenarios: "⚠️ 异常场景",
  runtime_rules: "⚙️ 运行时规则",
  observability: "👁️ 可观测性",
  testcases: "🧪 测试策略",
};

const GATE_COLORS: Record<string, string> = {
  passed: "bg-green-100 text-green-800 border-green-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  pending: "bg-gray-100 text-gray-800 border-gray-300",
};

const GATE_LABELS: Record<string, string> = {
  passed: "✅ 通过",
  failed: "❌ 未通过",
  pending: "⏳ 待检查",
};

interface Props {
  projectId: string;
  companyId?: string;
}

export function SpecPackagePanel({ projectId, companyId }: Props) {
  const [data, setData] = useState<SpecPackageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [runningGate, setRunningGate] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await specApi.get(projectId, companyId);
      setData(res);
    } catch (err: any) {
      if (err?.status === 404) {
        setError(null);
      } else {
        setError(err?.message || "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!companyId) return;
    try {
      const res = await specApi.create(projectId, companyId);
      setData(res);
    } catch (err: any) {
      setError(err?.message || "创建失败");
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    setSaving(true);
    try {
      await specApi.updateFile(editingFile, editContent);
      setEditingFile(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleRunGateAll = async () => {
    if (!data?.specPackage.id) return;
    setRunningGate(true);
    try {
      const res = await specApi.runGateAll(data.specPackage.id);
      setData((prev) => prev ? { ...prev, specPackage: res.specPackage, issues: data.issues } : prev);
    } catch (err: any) {
      setError(err?.message || "GATE 检查失败");
    } finally {
      setRunningGate(false);
    }
  };

  const handleGetPrompt = async () => {
    if (!data?.specPackage.id) return;
    try {
      const res = await specApi.getAgentPrompt(data.specPackage.id);
      setAgentPrompt(res.prompt);
      setShowPrompt(true);
    } catch (err: any) {
      setError(err?.message || "获取提示词失败");
    }
  };

  const handleToggleDOD = async (dodId: string) => {
    try {
      await specApi.toggleDOD(dodId);
      await load();
    } catch (err: any) {
      setError(err?.message || "更新失败");
    }
  };

  const handleResolveIssue = async (issueId: string) => {
    const resolution = prompt("请输入解决方案：");
    if (!resolution) return;
    try {
      await specApi.resolveIssue(issueId, resolution);
      await load();
    } catch (err: any) {
      setError(err?.message || "操作失败");
    }
  };

  if (loading) return <div className="p-4 text-gray-500">加载中...</div>;

  if (!data) {
    return (
      <div className="p-4 space-y-3">
        <p className="text-gray-500">此项目尚未创建规范包</p>
        {companyId && (
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            创建规范包
          </button>
        )}
      </div>
    );
  }

  const { specPackage, files, issues, dod } = data;
  const unresolvedIssues = issues.filter((i) => !i.resolution);
  const resolvedCount = dod.filter((d) => d.checked).length;

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">规范包 v{specPackage.version}</h2>
          <span
            className={`inline-block mt-1 px-2 py-0.5 rounded text-xs border ${
              specPackage.status === "approved"
                ? "bg-green-100 text-green-800 border-green-300"
                : specPackage.status === "draft"
                ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                : "bg-orange-100 text-orange-800 border-orange-300"
            }`}
          >
            {specPackage.status === "approved" ? "✅ 已审批" : specPackage.status === "draft" ? "📝 草稿" : "🔍 审核中"}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRunGateAll}
            disabled={runningGate}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {runningGate ? "检查中..." : "🔄 执行全部 GATE"}
          </button>
          {specPackage.status === "approved" && (
            <button
              onClick={handleGetPrompt}
              className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
            >
              📋 查看 Agent Prompt
            </button>
          )}
        </div>
      </div>

      {/* GATE Status */}
      <div className="grid grid-cols-3 gap-3">
        {(["gate1Status", "gate2Status", "gate3Status"] as const).map((key, i) => (
          <div key={key} className={`border rounded p-3 ${GATE_COLORS[specPackage[key]] || GATE_COLORS.pending}`}>
            <div className="font-medium text-sm">GATE-{i + 1}</div>
            <div className="text-xs mt-1">
              {key === "gate1Status" ? "完整性" : key === "gate2Status" ? "一致性" : "未决问题"}
            </div>
            <div className="text-sm mt-1">{GATE_LABELS[specPackage[key]] || specPackage[key]}</div>
          </div>
        ))}
      </div>

      {/* Agent Prompt Modal */}
      {showPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">AI Agent 编码约束提示词</h3>
              <button onClick={() => setShowPrompt(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <textarea
              readOnly
              value={agentPrompt}
              className="flex-1 border rounded p-3 font-mono text-xs resize-none"
              rows={20}
            />
          </div>
        </div>
      )}

      {/* Spec Files */}
      <div>
        <h3 className="font-semibold mb-2">规范文件</h3>
        <div className="space-y-2">
          {files.map((file) => (
            <div key={file.id} className="border rounded">
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                onClick={() => {
                  if (editingFile !== file.id) {
                    setEditingFile(file.id);
                    setEditContent(file.content || "");
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{FILE_LABELS[file.templateType] || file.fileName}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      file.fileStatus === "complete"
                        ? "bg-green-50 text-green-700"
                        : "bg-yellow-50 text-yellow-700"
                    }`}
                  >
                    {file.fileStatus === "complete" ? "已填写" : "草稿"}
                  </span>
                </div>
                <span className="text-xs text-gray-400">{file.fileName}</span>
              </div>
              {editingFile === file.id && (
                <div className="border-t p-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full border rounded p-2 font-mono text-xs resize-y"
                    rows={12}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleSaveFile}
                      disabled={saving}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? "保存中..." : "💾 保存"}
                    </button>
                    <button
                      onClick={() => setEditingFile(null)}
                      className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Unresolved Issues */}
      {unresolvedIssues.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">
            未决问题 ({unresolvedIssues.length})
          </h3>
          <div className="space-y-1">
            {unresolvedIssues.map((issue) => (
              <div
                key={issue.id}
                className={`flex items-center justify-between p-2 rounded text-sm ${
                  issue.severity === "blocking"
                    ? "bg-red-50 border border-red-200"
                    : "bg-yellow-50 border border-yellow-200"
                }`}
              >
                <div>
                  <span className="font-medium">
                    [{issue.source}] {issue.title}
                  </span>
                  {issue.relatedFiles && (
                    <span className="text-xs text-gray-500 ml-2">
                      📎 {issue.relatedFiles.join(", ")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleResolveIssue(issue.id)}
                  className="px-2 py-0.5 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                >
                  解决
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DoD Checklist */}
      <div>
        <h3 className="font-semibold mb-2">
          完成定义 ({resolvedCount}/{dod.length})
        </h3>
        <div className="border rounded divide-y">
          {dod.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer"
              onClick={() => handleToggleDOD(item.id)}
            >
              <span className={item.checked ? "text-green-600" : "text-gray-300"}>
                {item.checked ? "☑️" : "☐"}
              </span>
              <span className={`text-sm ${item.checked ? "line-through text-gray-400" : ""}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
