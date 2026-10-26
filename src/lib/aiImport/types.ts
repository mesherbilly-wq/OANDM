export type QuantityBasis = 'stated' | 'counted' | 'unknown';
export type EvidenceClass = 'quoted' | 'proposed' | 'installed' | 'unknown';
export type ViewKind = 'overview' | 'detail' | 'schedule' | 'legend' | 'revision' | 'unknown';

export interface AiSourcePage {
  fileName: string;
  label: string;
  page: number;
  text: string;
  imageBase64?: string;
  imageCrops?: string[];
  mediaType?: string;
  symbolCount?: {
    internalDome: number;
    externalDome: number;
    externalBullet: number;
    legendExcluded: number;
    countedTotal: number;
  } | null;
}

export interface AiQuantityClass {
  label: string;
  quantity: number;
}

export interface AiQuantitySummary {
  statedTotal: number | null;
  countedTotal: number | null;
  classified: AiQuantityClass[];
  difference: string | null;
  unresolved: string | null;
  legendExcluded: number;
}

export interface AiExtractedDevice {
  system_type?: string | null;
  device_type?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  model_name?: string | null;
  quantity?: number | null;
  location?: string | null;
  zone?: string | null;
  notes?: string | null;
  quantity_basis?: string | null;
  evidence_class?: string | null;
  view_kind?: string | null;
  source_file?: string | null;
  source_page?: number | null;
  evidence_text?: string | null;
  confidence?: number | null;
  conflict?: string | null;
}

export interface AiExtractedSection {
  kind?: string | null;
  text?: string | null;
  source_file?: string | null;
  source_page?: number | null;
}

export interface AiExtractPayload {
  project_name?: string | null;
  client_name?: string | null;
  site_name?: string | null;
  site_address?: string | null;
  job_number?: string | null;
  quote_number?: string | null;
  project_number?: string | null;
  drawing_references?: string[] | null;
  project_manager?: string | null;
  engineer?: string | null;
  project_notes?: string | null;
  scope_of_works?: string | null;
  system_types?: string[] | null;
  devices?: AiExtractedDevice[] | null;
  sections?: AiExtractedSection[] | null;
  missing?: string[] | null;
  warnings?: string[] | null;
  quantity_summary?: AiQuantitySummary | null;
}

export interface AiImportStoredFile {
  fileName: string;
  storagePath: string;
  mediaType: string;
  label: string;
}
