import { api } from "./client";

export interface SpecPackage {
  id: string;
  companyId: string;
  projectId: string;
  version: number;
  status: string;
  gate1Status: string;
  gate2Status: string;
  gate3Status: string;
  gate1Result: GateResult | null;
  gate2Result: GateResult | null;
  gate3Result: GateResult | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpecFile {
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

export interface SpecIssue {
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

export interface DODItem {
  id: string;
  specPackageId: string;
  companyId: string;
  itemKey: string;
  label: string;
  checked: number;
  checkedByUserId: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GateResult {
  passed: boolean;
  checkedAt: string;
  errors: Array<{ file?: string; field?: string; message: string }>;
  warnings: Array<{ file?: string; field?: string; message: string }>;
}

export interface SpecPackageResponse {
  specPackage: SpecPackage;
  files: SpecFile[];
  issues: SpecIssue[];
  dod: DODItem[];
}

export interface GateAllResponse {
  overallPassed: boolean;
  gate1: GateResult;
  gate2: GateResult;
  gate3: GateResult;
  specPackage: SpecPackage;
}

export const specApi = {
  create: (projectId: string, companyId: string) =>
    api.post<SpecPackageResponse>(`/projects/${encodeURIComponent(projectId)}/spec-package`, { companyId }),

  get: (projectId: string, companyId?: string) => {
    const params = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
    return api.get<SpecPackageResponse>(`/projects/${encodeURIComponent(projectId)}/spec-package${params}`);
  },

  updateFile: (fileId: string, content: string) =>
    api.put<SpecFile>(`/spec-files/${encodeURIComponent(fileId)}`, { content }),

  runGate: (pkgId: string, gate: 1 | 2 | 3) =>
    api.post<{ gate: string; result: GateResult; specPackage: SpecPackage }>(
      `/spec-packages/${encodeURIComponent(pkgId)}/gate/${gate}`,
      {},
    ),

  runGateAll: (pkgId: string) =>
    api.post<GateAllResponse>(`/spec-packages/${encodeURIComponent(pkgId)}/gate/all`, {}),

  createIssue: (pkgId: string, data: Partial<SpecIssue>) =>
    api.post<SpecIssue>(`/spec-packages/${encodeURIComponent(pkgId)}/issues`, data),

  resolveIssue: (issueId: string, resolution: string, resolutionNote?: string) =>
    api.put<SpecIssue>(`/spec-issues/${encodeURIComponent(issueId)}/resolve`, { resolution, resolutionNote }),

  getIssues: (pkgId: string) =>
    api.get<SpecIssue[]>(`/spec-packages/${encodeURIComponent(pkgId)}/issues`),

  getDOD: (pkgId: string) =>
    api.get<{ items: DODItem[]; specPackageId: string }>(`/spec-packages/${encodeURIComponent(pkgId)}/dod`),

  toggleDOD: (dodId: string) =>
    api.put<DODItem>(`/spec-dod/${encodeURIComponent(dodId)}/toggle`, {}),

  getAgentPrompt: (pkgId: string) =>
    api.get<{ prompt: string; specPackageId: string; version: number }>(
      `/spec-packages/${encodeURIComponent(pkgId)}/agent-prompt`,
    ),
};
