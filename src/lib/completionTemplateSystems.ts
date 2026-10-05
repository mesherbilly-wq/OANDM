import { FALLBACK_DOCUMENT_TYPES } from './handoverDocumentConfig';
import { PROJECT_WIDE_SYSTEM_KEY, PROJECT_WIDE_SYSTEM_LABEL } from './documentProjectSystems';
import type { CompletionTemplateSchema } from './completionFormTypes';

export { PROJECT_WIDE_SYSTEM_KEY, PROJECT_WIDE_SYSTEM_LABEL };

export function completionSystemOptions(projectSystemNames: string[]): string[] {
  const extras = FALLBACK_DOCUMENT_TYPES
    .map(type => type.label)
    .filter(label => label !== PROJECT_WIDE_SYSTEM_LABEL);
  return [PROJECT_WIDE_SYSTEM_LABEL, ...Array.from(new Set([...projectSystemNames, ...extras]))];
}

export function blankCompletionSchema(key: string, title: string): CompletionTemplateSchema {
  return {
    key,
    version: 1,
    title,
    statusNotice: 'Company form. This is not an official certificate.',
    sections: [
      {
        id: 'job',
        title: 'Job, customer and site',
        summary: 'Upload an existing paper or Word form to fill this template, or add questions here.',
        customerVisible: true,
        fields: [
          { id: 'job_number', label: 'Job number', type: 'text', required: true, customerVisible: true },
          { id: 'client', label: 'Client', type: 'text', customerVisible: true },
          { id: 'site_address', label: 'Site address', type: 'textarea', customerVisible: true },
        ],
      },
    ],
    reviewFlags: [],
  };
}

export function slugifyTemplateKey(systemType: string, title: string): string {
  const slug = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  const combined = `${slug(systemType || 'form')}_${slug(title || 'completion')}`;
  return combined.replace(/_+/g, '_') || `form_${Date.now()}`;
}
