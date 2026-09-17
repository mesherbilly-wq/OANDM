/**
 * Prefer Simpro Job.ID (stored as project_number) over job_number.
 * job_number was sometimes filled from OrderNo, which is the customer PO.
 * Manual projects with only job_number keep that value.
 */
export function displayProjectJobNumber(
  jobNumber?: string | null,
  projectNumber?: string | null,
): string {
  return projectNumber?.trim() || jobNumber?.trim() || '';
}
