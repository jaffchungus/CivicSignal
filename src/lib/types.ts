export type Role = "RESIDENT" | "OFFICIAL" | "LAW_ENFORCEMENT" | "ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING";
export type ReportStatus = "SUBMITTED" | "UNDER_REVIEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface User {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  status: UserStatus;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  kind?: string | null;
  active?: boolean;
  memberCount?: number;
}

export interface Attachment {
  id: string;
  filename?: string;
  url?: string;
  contentType?: string;
}

export interface ReportUpdate {
  id: string;
  message: string;
  createdAt: string;
  author?: { id?: string; displayName?: string; role?: Role } | null;
}

export interface ReportTimelineEntry {
  id: string;
  type?: string;
  action?: string;
  message?: string | null;
  fromStatus?: ReportStatus | null;
  toStatus?: ReportStatus | null;
  createdAt: string;
  actor?: { id?: string; displayName?: string; role?: Role } | null;
}

export interface Report {
  id: string;
  referenceCode?: string | null;
  title: string;
  description: string;
  location: string;
  status: ReportStatus;
  category: Category;
  organization?: Organization | null;
  reporter?: { id: string; displayName: string } | null;
  assignedTo?: { id: string; displayName: string; role?: Role } | null;
  submittedAt: string;
  updatedAt: string;
  moderationStatus?: string | null;
  attachments?: Attachment[];
  updates?: ReportUpdate[];
  timeline?: ReportTimelineEntry[];
  allowedTransitions?: ReportStatus[];
  canClaim?: boolean;
  capabilities?: Record<string, boolean>;
}

export interface Notification {
  id: string;
  type?: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  reportId?: string | null;
}

export interface SetupStatus {
  setupRequired: boolean;
}

export interface SessionResponse {
  user: User | null;
}

export interface ReportListResponse {
  reports: Report[];
  total?: number;
  nextCursor?: string | null;
}

export interface AdminOverview {
  users?: number;
  organizations?: number;
  categories?: number;
  pendingVerifications?: number;
  moderationQueue?: number;
  openReports?: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  actor?: { displayName?: string; email?: string; role?: Role } | null;
  reportId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
}

export interface AdminUser extends User {
  createdAt?: string;
}

export interface ApiErrorShape {
  message?: string;
  fieldErrors?: Record<string, string>;
  code?: string;
}
