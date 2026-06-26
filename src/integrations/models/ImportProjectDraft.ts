/**
 * Project header fields normalised from any external source.
 * Maps directly to the `projects` table without connector-specific fields.
 */
export interface ImportProjectDraft {
  projectName: string | null;
  clientName: string | null;
  siteName: string | null;
  siteAddress: string | null;
  jobNumber: string | null;
  quoteNumber: string | null;
  projectNumber: string | null;
  projectManager: string | null;
  engineer: string | null;
  mainContractor: string | null;
  projectSummary: string | null;
  projectNotes: string | null;
}

export function createEmptyProjectDraft(): ImportProjectDraft {
  return {
    projectName: null,
    clientName: null,
    siteName: null,
    siteAddress: null,
    jobNumber: null,
    quoteNumber: null,
    projectNumber: null,
    projectManager: null,
    engineer: null,
    mainContractor: null,
    projectSummary: null,
    projectNotes: null,
  };
}
