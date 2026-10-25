// CivicSignal API contract — the single owner of domain vocabulary and wire
// shapes, shared by the server and the client.

// Keep image uploads below Vercel Functions' 4.5 MB request-body limit,
// including multipart framing overhead.
export const MAX_REPORT_PHOTO_BYTES = 4 * 1024 * 1024;

export const USER_ROLES = [
  "RESIDENT",
  "OFFICIAL",
  "LAW_ENFORCEMENT",
  "ADMIN",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "PENDING", "SUSPENDED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ORGANIZATION_KINDS = [
  "PUBLIC_SERVICE",
  "LAW_ENFORCEMENT",
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const REPORT_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  SUBMITTED: ["UNDER_REVIEW", "IN_PROGRESS"],
  UNDER_REVIEW: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["UNDER_REVIEW", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function reportStatusLabel(status: string): string {
  return REPORT_STATUS_LABELS[status as ReportStatus] ?? status;
}

export const MODERATION_STATUSES = ["VISIBLE", "HIDDEN", "REMOVED"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const STAFF_ROLES = ["OFFICIAL", "LAW_ENFORCEMENT"] as const;

/** Official workflow access requires one of these roles (plus an organization). */
export function isStaffRole(role: UserRole): boolean {
  return (STAFF_ROLES as readonly UserRole[]).includes(role);
}

/** Roles a member of the public may request at registration (never ADMIN). */
export const REQUESTABLE_ROLES = [
  "RESIDENT",
  "OFFICIAL",
  "LAW_ENFORCEMENT",
] as const;

export type PublicUser = {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  organizationId: string | null;
  organizationName: string | null;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
};

// ---- Wire shapes returned by the API ----

export type Category = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
};

export type Organization = {
  id: string;
  name: string;
  kind?: string | null;
  active?: boolean;
  memberCount?: number;
};

export type Attachment = {
  id: string;
  filename?: string;
  url?: string;
  contentType?: string;
};

export type ReportUpdate = {
  id: string;
  message: string;
  createdAt: string;
  author?: { id?: string; displayName?: string; role?: UserRole } | null;
};

export type ReportTimelineEntry = {
  id: string;
  type?: string;
  action?: string;
  message?: string | null;
  fromStatus?: ReportStatus | null;
  toStatus?: ReportStatus | null;
  createdAt: string;
  actor?: { id?: string; displayName?: string; role?: UserRole } | null;
};

export type Report = {
  id: string;
  referenceCode?: string | null;
  title: string;
  description: string;
  location: string;
  coordinates?: { latitude: number; longitude: number; accuracyMeters?: number } | null;
  status: ReportStatus;
  category: Category;
  organization?: Organization | null;
  reporter?: { id?: string | null; displayName: string } | null;
  assignedTo?: { id: string; displayName: string; role?: UserRole } | null;
  submittedAt: string;
  updatedAt: string;
  moderationStatus?: string | null;
  attachments?: Attachment[];
  updates?: ReportUpdate[];
  timeline?: ReportTimelineEntry[];
  allowedTransitions?: ReportStatus[];
  canClaim?: boolean;
  capabilities?: Record<string, boolean>;
  nearestRepresentative?: {
    id: string;
    displayName: string;
    role: UserRole;
    organizationName?: string;
    municipalityName?: string;
  } | null;
  municipalityId?: string | null;
  municipalityName?: string | null;
};

export type PhotoAnalysisResult = {
  problem: string;
  suggestedCategoryId: string;
  suggestedTitle: string;
  suggestedDescription: string;
  confidence: number;
  detectedCues: string[];
  isSpam: boolean;
};

export type Notification = {
  id: string;
  type?: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  reportId?: string | null;
};

export type SetupStatus = {
  setupRequired: boolean;
};

export type SessionResponse = {
  user: PublicUser | null;
};

export type ReportListResponse = {
  reports: Report[];
  total?: number;
  nextCursor?: string | null;
};

export type AdminOverview = {
  users?: number;
  organizations?: number;
  categories?: number;
  pendingVerifications?: number;
  moderationQueue?: number;
  openReports?: number;
};

export type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  actor?: { displayName?: string; email?: string; role?: UserRole } | null;
  reportId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
};

export type AdminUser = PublicUser & {
  createdAt?: string;
};

export type Municipality = {
  id: string;
  name: string;
  boundaryGeojson?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ReportSimilarity = {
  id: string;
  primaryReportId: string;
  similarReportId: string;
  similarityScore: number;
  matchedByAi: boolean;
  createdAt: string;
};

export type ResidentFeedback = {
  id: string;
  reportId: string;
  userId?: string | null;
  feedbackType: "STILL_HAPPENING" | "DONT_KNOW" | "FIXED";
  createdAt: string;
};
