export type AgentStatus = "working" | "waiting" | "done" | "error";
export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  task: string;
  status: AgentStatus;
  message: string;
  updatedAt: string;
  startedAt: string;
  endedAt?: string;
  event?: string;
  canResume: boolean;
  resumePending?: boolean;
}
export interface OfficeSnapshot {
  agents: OfficeAgent[];
  source: string;
  demo: boolean;
  updatedAt: string;
}
