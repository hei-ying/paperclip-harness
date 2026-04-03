export interface GateCheckResult {
  passed: boolean;
  checkedAt: string;
  errors: Array<{ file?: string; field?: string; message: string }>;
  warnings: Array<{ file?: string; field?: string; message: string }>;
}
