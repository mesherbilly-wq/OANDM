export const PROJECT_FIELDS = [
  { key: 'inspection_title', label: 'Audit Title (inspection name)' },
  { key: 'job_number', label: 'Job Number' },
  { key: 'project_name', label: 'Project Name' },
  { key: 'client_name', label: 'Client Name' },
  { key: 'site_name', label: 'Site Name' },
  { key: 'site_address', label: 'Site Address' },
  { key: 'project_manager', label: 'Project Manager' },
] as const;

export const DEVICE_FIELDS = [
  { key: 'device_name', label: 'Device Name' },
  { key: 'location', label: 'Location' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model_number', label: 'Model Number' },
  { key: 'serial_number', label: 'Serial Number' },
  { key: 'ip_address', label: 'IP Address' },
  { key: 'device_type', label: 'Device Type' },
  { key: 'system_type', label: 'System Type' },
] as const;

export const SC_DEFAULT_AUDIT_TITLE_ITEM_ID = 'f3245d40-ea77-11e1-aff1-0800200c9a66';

export const ALL_MAPPABLE_FIELDS = [
  ...PROJECT_FIELDS,
  ...DEVICE_FIELDS,
  { key: 'commissioning_date', label: 'Commissioning Date' },
] as const;

export function appendInspectionTitleItem(
  items: Array<{ item_id: string; item_type: string; text_item: { value: string } }>,
  title: string,
  fieldMap: Record<string, string>,
): void {
  const itemId = fieldMap.inspection_title?.trim() || SC_DEFAULT_AUDIT_TITLE_ITEM_ID;
  const trimmed = title.trim();
  if (!trimmed || items.some(item => item.item_id === itemId)) return;
  items.unshift({ item_id: itemId, item_type: 'ITEM_TYPE_TEXT', text_item: { value: trimmed } });
}
