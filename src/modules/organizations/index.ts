import type { ExecutionMode, UserRole } from "@/domain/types";

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: UserRole;
  readonly activeClientsCount: number;
  readonly defaultMode: ExecutionMode;
}

export const DEMO_ORGANIZATION: OrganizationSummary = {
  id: "org-demo-konnexy-01",
  name: "Konnexy Performance Hub (Demo)",
  slug: "konnexy-performance-demo",
  role: "OWNER",
  activeClientsCount: 6,
  defaultMode: "READ_ONLY",
};
