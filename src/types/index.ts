export type SystemCategory =
  | 'Security'
  | 'Fire'
  | 'Electrical'
  | 'Mechanical'
  | 'HVAC'
  | 'Plumbing'
  | 'Audio Visual'
  | 'IT'
  | 'Building Fabric'
  | 'Other';

export const SYSTEM_CATEGORIES: SystemCategory[] = [
  'Security',
  'Fire',
  'Electrical',
  'Mechanical',
  'HVAC',
  'Plumbing',
  'Audio Visual',
  'IT',
  'Building Fabric',
  'Other',
];

/** @deprecated Legacy Fire & Security hierarchy labels — use free-text system names + {@link SystemCategory}. */
export type SystemType = 'CCTV' | 'Access Control' | 'Intercom' | 'Intruder' | 'Networking' | 'ANPR' | 'Perimeter Detection';

/** @deprecated Use {@link SYSTEM_CATEGORIES} from `lib/systems`. */
export const SYSTEM_TYPES: SystemType[] = [
  'CCTV', 'Access Control', 'Intruder', 'Intercom', 'ANPR', 'Perimeter Detection', 'Networking',
];

export const SYSTEM_SLUGS: Record<SystemType, string> = {
  'CCTV': 'cctv',
  'Access Control': 'access-control',
  'Intruder': 'intruder',
  'Intercom': 'intercom',
  'ANPR': 'anpr',
  'Perimeter Detection': 'perimeter',
  'Networking': 'networking',
};

export const SLUG_TO_SYSTEM: Record<string, SystemType> = {
  'cctv': 'CCTV',
  'access-control': 'Access Control',
  'intruder': 'Intruder',
  'intercom': 'Intercom',
  'anpr': 'ANPR',
  'perimeter': 'Perimeter Detection',
  'networking': 'Networking',
};

export const PROJECT_STATUSES = ['active', 'on-hold', 'completed', 'cancelled'] as const;

export interface Project {
  id: number;
  created_at: string;
  project_name: string | null;
  client_name: string | null;
  site_name: string | null;
  site_address: string | null;
  job_number: string | null;
  quote_number: string | null;
  project_manager: string | null;
  start_date: string | null;
  completion_date: string | null;
  project_status: string | null;
  project_notes: string | null;
  main_contractor: string | null;
  project_number: string | null;
  engineer: string | null;
  handover_project_wide_type_key?: string | null;
}

export interface SCTemplateItem {
  item_id: string;
  type: string;
  label: string;
  section: string | null;
}

export interface SCTableColumn {
  field_id: string;
  label: string;
}

export interface SCTableItem {
  item_id: string;
  label: string;
  columns: SCTableColumn[];
}

export interface SCTemplateMapping {
  id: number;
  created_at: string;
  template_id: string;
  template_name: string | null;
  field_mappings: Record<string, string>;
  table_column_mappings: Record<string, string>;
}

export interface SCInspection {
  id: number;
  created_at: string;
  project_id: number;
  template_id: string;
  template_name: string | null;
  inspection_id: string;
  inspection_name: string | null;
  method: 'per_device' | 'per_system';
  system_type: string | null;
  device_ids: number[];
  device_id: number | null;
  device_name: string | null;
  status: 'created' | 'in_progress' | 'completed';
  result: 'pass' | 'fail' | null;
  score_pct: number | null;
  engineer_name: string | null;
  completion_date: string | null;
  notes: string | null;
  pdf_url: string | null;
  imported_at: string | null;
}

export interface ContractorProfile {
  id: number;
  company_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  telephone: string | null;
  email: string | null;
  website: string | null;
  company_reg_number: string | null;
  vat_number: string | null;
  nsi_number: string | null;
  ssaib_number: string | null;
  other_certifications: string | null;
  logo_url: string | null;
}

export interface DocumentAuthority {
  id: number;
  project_id: number;
  prepared_by: string | null;
  prepared_date: string | null;
  prepared_signature_url: string | null;
  checked_by: string | null;
  checked_date: string | null;
  checked_signature_url: string | null;
  approved_by: string | null;
  approved_date: string | null;
  approved_signature_url: string | null;
}

export interface ProjectTeamMember {
  id: number;
  created_at: string;
  project_id: number;
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface ProjectRevision {
  id: number;
  created_at: string;
  project_id: number;
  revision_number: string | null;
  description: string | null;
  revised_by: string | null;
  revised_at: string | null;
}

/** First-class install section / system within a project. */
export interface ProjectSystemRecord {
  id: number;
  project_id: number;
  system_name: string;
  system_category: SystemCategory | null;
  source_type: string | null;
  source_reference: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  handover_document_type_key?: string | null;
}

export interface Device {
  id: number;
  created_at: string;
  project_id: number | null;
  project_system_id: number | null;
  /** Denormalized system name — kept for backwards compatibility during migration. */
  system_type: string | null;
  /** Trade category for icons/reporting only — not the project hierarchy. */
  system_category: SystemCategory | null;
  device_type: string | null;
  device_name: string | null;
  manufacturer: string | null;
  model_number: string | null;
  model_name: string | null;
  serial_number: string | null;
  ip_address: string | null;
  location: string | null;
  notes: string | null;
  matched: boolean;
  datasheet_found: boolean;
  drawing_id: number | null;
  status: string | null;
  ai_confidence: number | null;
  source_document: string | null;
  // Hierarchy
  parent_device_id: number | null;
  component_type: string | null;
  is_component: boolean;
  // Technical
  mac_address: string | null;
  firmware_version: string | null;
  username_hint: string | null;
  password_hint: string | null;
  controller_address: string | null;
  reader_address: string | null;
  network_zone: string | null;
  vlan: string | null;
  port_number: string | null;
  retention_days: number | null;
  sort_order: number;
}

export interface Manufacturer {
  id: number;
  created_at: string;
  manufacturer_name: string | null;
  website: string | null;
  support_email: string | null;
}

export interface ProductModel {
  id: number;
  created_at: string;
  manufacturer: string | null;
  model_number: string | null;
  model_name: string | null;
  device_type: string | null;
  warranty_years: number | null;
  maintenance_notes: string | null;
  product_family: string | null;
  part_number: string | null;
  category: string | null;
  product_image_url: string | null;
  warranty_info: string | null;
  is_component: boolean;
}

export const PRODUCT_CATEGORIES = [
  'CCTV Cameras', 'NVRs / DVRs', 'VMS / Software',
  'Access Readers', 'Door Controllers', 'Locks',
  'Exit Buttons', 'Break Glasses', 'Door Contacts',
  'Power Supplies', 'Batteries', 'Licences',
  'Intruder Devices', 'Intercom Devices', 'ANPR Cameras',
  'Perimeter Detectors', 'Network Switches', 'Network Routers',
  'Access Points', 'Servers', 'Workstations', 'Miscellaneous',
] as const;

export interface Datasheet {
  id: number;
  created_at: string;
  manufacturer: string | null;
  model_number: string | null;
  file_name: string | null;
  datasheet_url: string | null;
  manual_url: string | null;
}

export interface Drawing {
  id: number;
  created_at: string;
  project_id: number;
  file_name: string | null;
  file_url: string | null;
  file_type: string | null;
  file_size: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  notes: string | null;
}

export interface DrawingProposal {
  id: number;
  created_at: string;
  drawing_id: number;
  project_id: number;
  device_name: string | null;
  manufacturer: string | null;
  model_number: string | null;
  device_type: string | null;
  system_type: string | null;
  location: string | null;
  notes: string | null;
  raw_reference: string | null;
  confidence: number | null;
  status: 'pending' | 'approved' | 'rejected';
  position_x: number | null;
  position_y: number | null;
}

export interface CommissioningRecord {
  id: number;
  created_at: string;
  project_id: number;
  system_type: string;
  section: string | null;
  test_description: string;
  expected_result: string | null;
  actual_result: string | null;
  pass: boolean | null;
  engineer_name: string | null;
  test_date: string | null;
  notes: string | null;
  sort_order: number;
}

export interface HandoverDocument {
  id: number;
  created_at: string;
  project_id: number;
  document_type: string;
  title: string;
  content: string | null;
  status: string;
  signed_by: string | null;
  signed_at: string | null;
  customer_name: string | null;
}

export interface ProjectDocument {
  id: number;
  created_at: string;
  project_id: number;
  document_type: string;
  title: string;
  content: string | null;
  status: string;
  generated_by: string | null;
}

export interface GeneratedDocument {
  id: number;
  created_at: string;
  project_id: number | null;
  document_type: string | null;
  file_url: string | null;
  generated_by: string | null;
}
