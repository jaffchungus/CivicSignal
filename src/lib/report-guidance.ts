import type { ReportStatus } from "../../shared/contracts";

export type ReportGuidance = {
  heading: string;
  explanation: string;
  residentAction: string;
};

/** Plain-language guidance tied to the status recorded on a report. */
export function reportGuidance(status: ReportStatus): ReportGuidance {
  switch (status) {
    case "SUBMITTED":
      return {
        heading: "Waiting for review",
        explanation: "The report has been routed to the configured organization. It has not yet been marked as under review.",
        residentAction: "Check back for a status change or an official update. CivicSignal does not provide a response-time guarantee.",
      };
    case "UNDER_REVIEW":
      return {
        heading: "The organization is reviewing it",
        explanation: "An official has marked the report for review and is assessing what action is appropriate.",
        residentAction: "Look for an official update here if the organization shares more detail.",
      };
    case "IN_PROGRESS":
      return {
        heading: "Work is marked in progress",
        explanation: "The organization has recorded that work is underway. The report history shows when its status changed.",
        residentAction: "Read the latest official update for details, or check back as the organization records progress.",
      };
    case "RESOLVED":
      return {
        heading: "The organization marked it resolved",
        explanation: "This is the status recorded by the organization in CivicSignal; it is not an independent inspection.",
        residentAction: "If the issue remains, contact the organization through its usual public channels.",
      };
    case "CLOSED":
      return {
        heading: "This report is closed",
        explanation: "No further workflow step is currently open for this report. Its recorded updates and history remain on this page.",
        residentAction: "If the issue returns, contact the organization through its usual public channels.",
      };
  }
}
