export const USER_ROLES = [
  "RESIDENT",
  "OFFICIAL",
  "LAW_ENFORCEMENT",
  "ADMIN",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
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
