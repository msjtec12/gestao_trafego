export interface SyncWorkflowConfig {
  readonly organizationId: string;
  readonly cronSchedule: string;
  readonly maxExecutionWindowMs: number;
}

export const DEFAULT_SYNC_WORKFLOW: SyncWorkflowConfig = {
  organizationId: "org-demo-konnexy",
  cronSchedule: "0 */2 * * *",
  maxExecutionWindowMs: 45000,
};
