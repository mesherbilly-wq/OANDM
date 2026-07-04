import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Building, ChevronDown, FolderOpen, Loader2, MapPin, Sparkles, Tag, User,
} from 'lucide-react';
import {
  getImportReviewBlockingIssues,
  getImportReviewCreateConfirmationIssues,
  importSelectionSummary,
  partitionImportReviewNotes,
  resolvedEquipmentCategory,
  resolvedCategory,
  type ImportReviewDraft,
} from '../integrations';
import { pickRawDescriptionHtml } from '../integrations/connectors/simpro/simproImportHelpers';
import {
  clearSimproImportSession,
  getSimproImportSession,
  updateSimproImportSession,
} from '../lib/simproImportSession';
import { MAX_DEVICES_PER_LINE } from '../lib/devicePersistConstants';
import { persistSimproImportReviewDraft } from '../lib/persistSimproImportDraft';
import { fetchAllProductModels } from '../lib/productDatabaseDb';
import {
  applyProductDatabaseSelection,
  countProductDatabaseAutofillFields,
  createProductEnrichmentContext,
  dismissProductDatabaseSuggestion,
  enrichEquipmentFromProductDatabase,
  enrichImportReviewDraftFromProductDatabase,
  formatProductLookupLabel,
  getEquipmentMissingRequiredFields,
  getProductDatabaseLookupStatus,
  getProductDatabaseSuggestionIds,
  hasProductDatabaseSuggestion,
  isAmbiguousManufacturerLookup,
  isImportReviewDraftEnrichedFromProductDatabase,
  listIncompleteSelectedEquipment,
  REQUIRED_EQUIPMENT_FIELD_LABELS,
  summarizeProductDatabaseEnrichment,
  type ProductEnrichmentContext,
} from '../lib/importEquipmentValidation';
import type { ImportEquipmentDraft } from '../integrations';
import type { ProductLookupRecord } from '../lib/productLookupIndex';
import { SYSTEM_CATEGORIES } from '../lib/systems';
import type { SystemCategory } from '../types';

type ReviewTab = 'project' | 'systems' | 'notes' | 'debug';

type EditableEquipmentField =
  | 'deviceType'
  | 'modelName'
  | 'manufacturer'
  | 'modelNumber'
  | 'productCategory'
  | 'warrantyYears'
  | 'location'
  | 'notes'
  | 'quantity'
  | 'category';

function displayValue(value: string | null | undefined): string {
  return value?.trim() ? value : '—';
}

function normalizeQuantity(value: string): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_DEVICES_PER_LINE);
}

function cellInputClass(disabled: boolean, isMissing = false): string {
  return `w-full min-w-[7rem] rounded-lg border px-2 py-1.5 text-sm ${
    disabled
      ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
      : isMissing
        ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-1 focus:ring-red-500'
        : 'border-slate-200 bg-white text-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
  }`;
}

function ReadOnlyField({ label, value, icon: Icon }: {
  label: string;
  value: string | null | undefined;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
        <div className={`border border-slate-200 rounded-xl py-2.5 text-sm text-slate-800 bg-slate-50 ${Icon ? 'pl-10 pr-4' : 'px-4'}`}>
          {displayValue(value)}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyMultilineField({ label, value }: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 bg-slate-50 whitespace-pre-wrap min-h-[5rem]">
        {displayValue(value)}
      </div>
    </div>
  );
}

function CategorySelect({
  value,
  onChange,
  disabled,
  allowDefault = false,
  className = '',
}: {
  value: SystemCategory | null;
  onChange: (value: SystemCategory | null) => void;
  disabled?: boolean;
  allowDefault?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={event => onChange(event.target.value ? (event.target.value as SystemCategory) : null)}
      className={`${cellInputClass(Boolean(disabled))} ${className}`}
    >
      {allowDefault && <option value="">Use system default</option>}
      {!allowDefault && !value && <option value="">Select category</option>}
      {SYSTEM_CATEGORIES.map(category => (
        <option key={category} value={category}>{category}</option>
      ))}
    </select>
  );
}

function SelectionSummary({ draft }: { draft: ImportReviewDraft }) {
  const summary = importSelectionSummary(draft);
  return (
    <p className="text-cyan-800/90 mt-0.5">
      Job {displayValue(draft.project.jobNumber)} · Simpro ID {displayValue(draft.project.projectNumber)} ·{' '}
      {summary.selectedSystems} of {summary.totalSystems} system{summary.totalSystems !== 1 ? 's' : ''} ·{' '}
      {summary.selectedLines} of {summary.totalLines} equipment line{summary.totalLines !== 1 ? 's' : ''} ·{' '}
      {summary.deviceUnits} device unit{summary.deviceUnits !== 1 ? 's' : ''}
    </p>
  );
}

function ProductDatabaseMatchPicker({
  item,
  products,
  disabled,
  onApply,
  onDismiss,
}: {
  item: ImportEquipmentDraft;
  products: ProductLookupRecord[];
  disabled: boolean;
  onApply: (productId: number) => void;
  onDismiss: () => void;
}) {
  const status = getProductDatabaseLookupStatus(item);
  const matchIds = getProductDatabaseSuggestionIds(item);
  const options = matchIds
    .map(id => products.find(product => product.id === id))
    .filter((product): product is ProductLookupRecord => !!product);

  const [selectedId, setSelectedId] = React.useState(options[0]?.id ?? 0);

  React.useEffect(() => {
    if (options.some(option => option.id === selectedId)) return;
    setSelectedId(options[0]?.id ?? 0);
  }, [options, selectedId]);

  if (options.length === 0 || disabled) return null;

  const label =
    status === 'suggested'
      ? 'Closest Product Database match (part number is not an exact match):'
      : 'Multiple exact Product Database matches — choose one:';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
      <Sparkles className="w-4 h-4 flex-shrink-0" />
      <span className="font-medium">{label}</span>
      {options.length > 1 ? (
        <select
          value={selectedId}
          disabled={disabled}
          onChange={event => setSelectedId(Number(event.target.value))}
          className="min-w-[14rem] flex-1 rounded-md border border-violet-200 bg-white px-2 py-1 text-xs"
        >
          {options.map(option => (
            <option key={option.id} value={option.id}>
              {formatProductLookupLabel(option)}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1 text-violet-900">{formatProductLookupLabel(options[0])}</span>
      )}
      <button
        type="button"
        disabled={disabled || !selectedId}
        onClick={() => onApply(selectedId)}
        className="rounded-md bg-violet-700 px-2.5 py-1 font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
      >
        Use this
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onDismiss}
        className="rounded-md border border-violet-300 bg-white px-2.5 py-1 font-semibold text-violet-900 hover:bg-violet-100"
      >
        Skip
      </button>
    </div>
  );
}

function NoteSection({
  title,
  description,
  issues,
  emptyMessage,
  tone,
}: {
  title: string;
  description: string;
  issues: ImportReviewDraft['issues'];
  emptyMessage: string;
  tone: 'info' | 'warning' | 'blocking';
}) {
  const toneClass =
    tone === 'blocking'
      ? 'border-red-200 bg-red-50 text-red-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <div className="p-4 space-y-2">
        {issues.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        ) : (
          issues.map(issue => (
            <div
              key={`${tone}-${issue.code}-${issue.message}-${issue.draftId ?? ''}`}
              className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}
            >
              <p>{issue.message}</p>
              {issue.draftId && (
                <p className="mt-1 text-xs opacity-75 font-mono">ref: {issue.draftId}</p>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function ImportReviewPage() {
  const navigate = useNavigate();
  const initialSession = useMemo(() => getSimproImportSession(), []);
  const [session, setSession] = useState(initialSession);
  const [tab, setTab] = useState<ReviewTab>('project');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const enrichmentContextRef = useRef<ProductEnrichmentContext | null>(null);
  const [enrichingFromDatabase, setEnrichingFromDatabase] = useState(
    () => !(initialSession && isImportReviewDraftEnrichedFromProductDatabase(initialSession.draft)),
  );
  const [productDatabaseStatus, setProductDatabaseStatus] = useState<{
    error: string | null;
    productCount: number;
  }>({ error: null, productCount: 0 });

  const runProductDatabaseEnrichment = async (options?: {
    isCancelled?: () => boolean;
    force?: boolean;
  }) => {
    const alreadyEnriched =
      !options?.force &&
      session != null &&
      isImportReviewDraftEnrichedFromProductDatabase(session.draft);

    if (!alreadyEnriched) {
      setEnrichingFromDatabase(true);
    }

    const { products, error } = await fetchAllProductModels();
    if (options?.isCancelled?.()) return;

    enrichmentContextRef.current = products.length > 0 ? createProductEnrichmentContext(products) : null;
    setProductDatabaseStatus({ error, productCount: products.length });

    if (error || products.length === 0) {
      setEnrichingFromDatabase(false);
      return;
    }

    const current = getSimproImportSession();
    if (
      !options?.force &&
      current &&
      isImportReviewDraftEnrichedFromProductDatabase(current.draft)
    ) {
      setEnrichingFromDatabase(false);
      return;
    }

    updateSimproImportSession(currentSession => ({
      ...currentSession,
      draft: enrichImportReviewDraftFromProductDatabase(currentSession.draft, products),
    }));

    const nextSession = getSimproImportSession();
    if (options?.isCancelled?.()) return;
    if (nextSession) setSession(nextSession);
    setEnrichingFromDatabase(false);
  };

  useEffect(() => {
    let cancelled = false;
    void runProductDatabaseEnrichment({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!session) {
    return <Navigate to="/create-project" replace />;
  }

  const { draft, rawJob } = session;
  const summary = importSelectionSummary(draft);
  const noteSections = partitionImportReviewNotes(draft);
  const blockingIssues = getImportReviewBlockingIssues(draft);
  const confirmationIssues = getImportReviewCreateConfirmationIssues(draft);
  const incompleteEquipmentRows = listIncompleteSelectedEquipment(draft);
  const productDatabaseAutofillCount = countProductDatabaseAutofillFields(draft);
  const productDatabaseEnrichment = summarizeProductDatabaseEnrichment(draft);
  const rawJobRecord = rawJob && typeof rawJob === 'object' ? (rawJob as Record<string, unknown>) : null;
  const originalDescriptionHtml = rawJobRecord ? pickRawDescriptionHtml(rawJobRecord) : null;
  const noteCount = noteSections.info.length + noteSections.warnings.length + blockingIssues.length;

  const updateDraft = (updater: (current: ImportReviewDraft) => ImportReviewDraft) => {
    updateSimproImportSession(current => {
      const next = { ...current, draft: updater(current.draft) };
      setSession(next);
      return next;
    });
  };

  const toggleSystemSelected = (systemDraftId: string, selected: boolean) => {
    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system =>
        system.draftId === systemDraftId ? { ...system, selected } : system,
      ),
    }));
  };

  const updateSystemName = (systemDraftId: string, name: string) => {
    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system =>
        system.draftId === systemDraftId ? { ...system, name: name.trim() || system.name } : system,
      ),
    }));
  };

  const updateSystemCategory = (systemDraftId: string, category: SystemCategory | null) => {
    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system =>
        system.draftId === systemDraftId
          ? {
              ...system,
              category: {
                ...system.category,
                confirmedCategory: category,
                method: category ? 'user' : system.category.method,
              },
            }
          : system,
      ),
    }));
  };

  const toggleEquipmentSelected = (systemDraftId: string, equipmentDraftId: string, selected: boolean) => {
    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system =>
        system.draftId === systemDraftId
          ? {
              ...system,
              equipment: system.equipment.map(item =>
                item.draftId === equipmentDraftId ? { ...item, selected } : item,
              ),
            }
          : system,
      ),
    }));
  };

  const updateEquipmentField = (
    systemDraftId: string,
    equipmentDraftId: string,
    field: EditableEquipmentField,
    value: string,
  ) => {
    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system => {
        if (system.draftId !== systemDraftId) return system;
        return {
          ...system,
          equipment: system.equipment.map(item => {
            if (item.draftId !== equipmentDraftId) return item;
            if (field === 'quantity') {
              return { ...item, quantity: normalizeQuantity(value) };
            }
            if (field === 'category') {
              return { ...item, category: value ? (value as SystemCategory) : null };
            }
            if (field === 'warrantyYears') {
              const parsed = parseInt(value, 10);
              return {
                ...item,
                warrantyYears: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
              };
            }
            const updated = { ...item, [field]: value || null };
            if (
              (field === 'modelNumber' || field === 'manufacturer') &&
              enrichmentContextRef.current
            ) {
              return enrichEquipmentFromProductDatabase(updated, enrichmentContextRef.current);
            }
            return updated;
          }),
        };
      }),
    }));
  };

  const applyProductDatabaseMatch = (
    systemDraftId: string,
    equipmentDraftId: string,
    productId: number,
  ) => {
    const product = enrichmentContextRef.current?.products.find(entry => entry.id === productId);
    if (!product) return;

    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system => {
        if (system.draftId !== systemDraftId) return system;
        return {
          ...system,
          equipment: system.equipment.map(item =>
            item.draftId === equipmentDraftId ? applyProductDatabaseSelection(item, product) : item,
          ),
        };
      }),
    }));
  };

  const skipProductDatabaseMatch = (systemDraftId: string, equipmentDraftId: string) => {
    updateDraft(current => ({
      ...current,
      systems: current.systems.map(system => {
        if (system.draftId !== systemDraftId) return system;
        return {
          ...system,
          equipment: system.equipment.map(item =>
            item.draftId === equipmentDraftId ? dismissProductDatabaseSuggestion(item) : item,
          ),
        };
      }),
    }));
  };

  const handleCreateProject = async () => {
    setCreateError(null);

    if (blockingIssues.length > 0) {
      setTab('notes');
      return;
    }

    if (confirmationIssues.length > 0) {
      const summaryText = confirmationIssues.map(issue => issue.message).join('\n');
      const proceed = window.confirm(
        `Please review these items before creating the project:\n\n${summaryText}\n\nCreate the OANDM project anyway?`,
      );
      if (!proceed) return;
    }

    setCreating(true);
    try {
      const latestSession = getSimproImportSession();
      if (!latestSession) {
        throw new Error('Import session expired. Please run the Simpro import again.');
      }
      const { projectId } = await persistSimproImportReviewDraft(latestSession.draft);
      clearSimproImportSession();
      navigate(`/projects/${projectId}`);
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create project.');
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
                <FolderOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Import Review</h1>
                <p className="text-sm text-slate-500">
                  Edit equipment, adjust selections, then create the OANDM project
                </p>
              </div>
            </div>
          </div>
          <Link
            to="/create-project"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Create Project
          </Link>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
        <p className="font-semibold">Simpro import draft (session only)</p>
        <SelectionSummary draft={draft} />
      </div>

      {enrichingFromDatabase && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <Loader2 className="w-4 h-4 animate-spin" />
          Looking up blank fields in the Product Database…
        </div>
      )}

      {!enrichingFromDatabase && productDatabaseStatus.error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            Could not load the Product Database ({productDatabaseStatus.error}). Manufacturer, Product Category,
            and Warranty will not autofill until this is resolved.
          </span>
        </div>
      )}

      {!enrichingFromDatabase && !productDatabaseStatus.error && productDatabaseStatus.productCount === 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            The Product Database is empty — import your product CSV first to autofill Manufacturer, Product
            Category, and Warranty on blank Simpro lines.
          </span>
        </div>
      )}

      {!enrichingFromDatabase && !productDatabaseStatus.error && productDatabaseStatus.productCount > 0 && productDatabaseAutofillCount === 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p>
              Loaded {productDatabaseStatus.productCount.toLocaleString()} Product Database rows but no blank fields
              were filled. {productDatabaseEnrichment.unmatchedLines} of {productDatabaseEnrichment.equipmentLines}{' '}
              equipment lines had no Part Number match — check that Simpro Part Number matches{' '}
              <strong>Manufacturers Part Number</strong> in your CSV.
            </p>
            <button
              type="button"
              onClick={() => void runProductDatabaseEnrichment({ force: true })}
              className="mt-2 text-sm font-semibold text-amber-900 underline hover:no-underline"
            >
              Re-run Product Database lookup
            </button>
          </div>
        </div>
      )}

      {!enrichingFromDatabase && productDatabaseAutofillCount > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            Auto-filled {productDatabaseAutofillCount} field
            {productDatabaseAutofillCount === 1 ? '' : 's'} from {productDatabaseEnrichment.matchedLines} exact Part
            Number match{productDatabaseEnrichment.matchedLines === 1 ? '' : 'es'}. Closest matches are shown for your
            review — nothing is filled until you choose Use this.
          </span>
        </div>
      )}

      {!enrichingFromDatabase && productDatabaseEnrichment.suggestedLines > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            {productDatabaseEnrichment.suggestedLines} line
            {productDatabaseEnrichment.suggestedLines === 1 ? '' : 's'} have closest (non-exact) Product Database
            matches — use <strong>Use this</strong> or <strong>Skip</strong> on the Systems tab.
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-5">
        {([
          ['project', 'Project'],
          ['systems', 'Systems & Equipment'],
          ['notes', `Import Notes (${noteCount})`],
          ['debug', 'Debug JSON'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'project' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-base font-semibold text-slate-800">Project Details</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <ReadOnlyField label="Project Name" value={draft.project.projectName} />
            </div>
            <ReadOnlyField label="Job Number" value={draft.project.jobNumber} />
            <ReadOnlyField label="Simpro ID" value={draft.project.projectNumber} />
            <ReadOnlyField label="Client" value={draft.project.clientName} icon={Building} />
            <ReadOnlyField label="Site" value={draft.project.siteName} icon={MapPin} />
            <ReadOnlyField label="Site Address" value={draft.project.siteAddress} />
            <ReadOnlyField label="Project Manager" value={draft.project.projectManager} icon={User} />
            <div className="md:col-span-2">
              <ReadOnlyMultilineField label="Scope of Works" value={draft.project.projectSummary} />
            </div>
            <div className="md:col-span-2">
              <ReadOnlyMultilineField label="Project Notes" value={draft.project.projectNotes} />
            </div>
          </div>
        </div>
      )}

      {tab === 'systems' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            {summary.selectedSystems} of {summary.totalSystems} systems ·{' '}
            {summary.selectedLines} of {summary.totalLines} equipment lines ·{' '}
            {summary.deviceUnits} device units selected.
            Edits and deselections are saved in this browser session only.
          </div>
          {draft.systems.length === 0 ? (
            <p className="text-sm text-slate-500 rounded-xl border border-slate-200 bg-white px-4 py-6 text-center">
              No systems were normalised from this job.
            </p>
          ) : (
            draft.systems.map((system, index) => {
              const selectedInSystem = system.equipment.filter(item => item.selected).length;
              const rowDisabled = !system.selected;

              return (
                <details key={system.draftId} open={index === 0} className="bg-white border border-slate-200 rounded-2xl overflow-hidden group">
                  <summary className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none list-none">
                    <div className="flex items-start gap-3 min-w-0">
                      <label
                        className="flex items-start gap-3 min-w-0 cursor-pointer"
                        onClick={event => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={system.selected}
                          onChange={event => toggleSystemSelected(system.draftId, event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <div className="min-w-0 flex-1">
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Cost centre name
                          </label>
                          <input
                            type="text"
                            value={system.name}
                            disabled={!system.selected}
                            onClick={event => event.stopPropagation()}
                            onChange={event => updateSystemName(system.draftId, event.target.value)}
                            className={`w-full rounded-lg border px-2 py-1 text-sm font-semibold ${
                              system.selected
                                ? 'border-slate-200 bg-white text-slate-800'
                                : 'border-slate-100 bg-slate-50 text-slate-500'
                            }`}
                          />
                          {system.sourceCostCentreLabel &&
                            system.sourceCostCentreLabel !== system.name &&
                            !system.sourceCostCentreLabel.startsWith(`${system.name} (`) && (
                            <p className="text-xs text-slate-500 mt-1">
                              Simpro ref: {system.sourceCostCentreLabel}
                            </p>
                          )}
                          {system.description ? (
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{system.description}</p>
                          ) : null}
                          {system.sourceLocationName && (
                            <p className="text-[11px] text-slate-400 mt-1">
                              Simpro location: {system.sourceLocationName}
                            </p>
                          )}
                          {system.sourceSectionRef && (
                            <p className="text-[11px] text-slate-400 mt-1 font-mono">Ref {system.sourceSectionRef}</p>
                          )}
                        </div>
                      </label>
                      <ChevronDown className="w-4 h-4 text-slate-400 mt-1 flex-shrink-0 transition-transform group-open:rotate-180" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <div className="min-w-[12rem]" onClick={event => event.stopPropagation()}>
                        <CategorySelect
                          value={resolvedCategory(system)}
                          onChange={value => updateSystemCategory(system.draftId, value)}
                          disabled={rowDisabled}
                          className="text-xs"
                        />
                      </div>
                      <span className="inline-flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5" />
                        {selectedInSystem} of {system.equipment.length} line{system.equipment.length !== 1 ? 's' : ''} selected
                      </span>
                    </div>
                  </summary>
                  {!system.selected ? (
                    <p className="px-5 py-4 text-sm text-slate-500">This system is deselected and will not be imported.</p>
                  ) : system.equipment.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-slate-500">No equipment lines for this system.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left min-w-[1400px]">
                        <thead className="bg-white border-b border-slate-100 text-slate-500">
                          <tr>
                            <th className="px-3 py-2.5 font-semibold w-12">Import</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[9rem]">System category</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[10rem]">Product Description</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[8rem]">Manufacturer</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[9rem]">Part Number</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[9rem]">Product Category</th>
                            <th className="px-3 py-2.5 font-semibold w-20">Warranty</th>
                            <th className="px-3 py-2.5 font-semibold w-20">Qty</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[8rem]">Location</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[8rem]">Notes</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[6rem]">Source ref</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {system.equipment.map(item => {
                            const lineDisabled = rowDisabled || !item.selected;
                            const lineCategory = resolvedEquipmentCategory(system, item);
                            const missingRequired = getEquipmentMissingRequiredFields(item);
                            const ambiguousManufacturer = isAmbiguousManufacturerLookup(item);
                            const showProductPicker =
                              (hasProductDatabaseSuggestion(item) || ambiguousManufacturer) &&
                              getProductDatabaseSuggestionIds(item).length > 0;
                            const simproItemGroup =
                              typeof item.metadata?.simproItemGroup === 'string'
                                ? item.metadata.simproItemGroup
                                : null;

                            return (
                              <React.Fragment key={item.draftId}>
                              <tr
                                className={`align-top ${!item.selected || rowDisabled ? 'bg-slate-50/80' : ''}`}
                              >
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={item.selected}
                                    disabled={rowDisabled}
                                    onChange={event =>
                                      toggleEquipmentSelected(system.draftId, item.draftId, event.target.checked)
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 disabled:opacity-50"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <CategorySelect
                                    value={item.category}
                                    onChange={value =>
                                      updateEquipmentField(
                                        system.draftId,
                                        item.draftId,
                                        'category',
                                        value ?? '',
                                      )
                                    }
                                    disabled={lineDisabled}
                                    allowDefault
                                  />
                                  {!item.category && lineCategory ? (
                                    <p className="mt-1 text-[11px] text-slate-400">Default: {lineCategory}</p>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={item.modelName ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'modelName', event.target.value)
                                    }
                                    className={cellInputClass(lineDisabled, missingRequired.includes('modelName'))}
                                    placeholder="Product Description"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={item.manufacturer ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'manufacturer', event.target.value)
                                    }
                                    className={`${cellInputClass(lineDisabled, ambiguousManufacturer && !item.manufacturer?.trim())} ${
                                      ambiguousManufacturer && !item.manufacturer?.trim() ? 'ring-1 ring-amber-300' : ''
                                    }`}
                                    placeholder="Manufacturer"
                                  />
                                  {ambiguousManufacturer && !item.manufacturer?.trim() && !showProductPicker ? (
                                    <p className="mt-1 text-[11px] text-amber-700">Multiple exact matches — choose below.</p>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={item.modelNumber ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'modelNumber', event.target.value)
                                    }
                                    className={cellInputClass(lineDisabled, missingRequired.includes('modelNumber'))}
                                    placeholder="Part Number"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={item.productCategory ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'productCategory', event.target.value)
                                    }
                                    className={cellInputClass(lineDisabled)}
                                    placeholder="Product Category"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={0}
                                    value={item.warrantyYears ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'warrantyYears', event.target.value)
                                    }
                                    className={`${cellInputClass(lineDisabled)} w-20`}
                                    placeholder="Yrs"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={1}
                                    max={MAX_DEVICES_PER_LINE}
                                    value={item.quantity}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'quantity', event.target.value)
                                    }
                                    className={`${cellInputClass(lineDisabled)} w-20`}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={item.location ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'location', event.target.value)
                                    }
                                    className={cellInputClass(lineDisabled)}
                                    placeholder="Location"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={item.notes ?? ''}
                                    disabled={lineDisabled}
                                    onChange={event =>
                                      updateEquipmentField(system.draftId, item.draftId, 'notes', event.target.value)
                                    }
                                    className={cellInputClass(lineDisabled)}
                                    placeholder={simproItemGroup ? `Simpro: ${simproItemGroup}` : 'Notes'}
                                  />
                                </td>
                                <td className="px-3 py-2 text-slate-500 font-mono text-xs">
                                  {displayValue(item.sourceLineRef)}
                                </td>
                              </tr>
                              {showProductPicker && enrichmentContextRef.current ? (
                                <tr className={!item.selected || rowDisabled ? 'bg-slate-50/80' : ''}>
                                  <td colSpan={11} className="px-3 pb-3 pt-0">
                                    <ProductDatabaseMatchPicker
                                      item={item}
                                      products={enrichmentContextRef.current.products}
                                      disabled={lineDisabled}
                                      onApply={productId =>
                                        applyProductDatabaseMatch(system.draftId, item.draftId, productId)
                                      }
                                      onDismiss={() =>
                                        skipProductDatabaseMatch(system.draftId, item.draftId)
                                      }
                                    />
                                  </td>
                                </tr>
                              ) : null}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              );
            })
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="space-y-4">
          <NoteSection
            title="Info"
            description="Expected exclusions and normal import behaviour — labour, freight, contingency, and similar lines."
            issues={noteSections.info}
            emptyMessage="No informational notes for this import."
            tone="info"
          />
          <NoteSection
            title="Warnings"
            description="Review before creating — missing manufacturer, model, or category on selected equipment."
            issues={noteSections.warnings}
            emptyMessage="No warnings for this import."
            tone="warning"
          />
          <NoteSection
            title="Blocking Issues"
            description="These must be resolved before you can create the project."
            issues={blockingIssues}
            emptyMessage="Nothing is blocking project creation."
            tone="blocking"
          />
        </div>
      )}

      {tab === 'debug' && (
        <div className="space-y-4">
          {originalDescriptionHtml && (
            <details className="rounded-xl border border-slate-200 bg-white overflow-hidden group">
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-700">
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                Original Simpro Description (HTML)
              </summary>
              <pre className="text-[11px] text-slate-600 p-4 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                {originalDescriptionHtml}
              </pre>
            </details>
          )}
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden group">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-700">
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              Normalised ImportReviewDraft
            </summary>
            <pre className="text-[11px] text-slate-600 p-4 overflow-x-auto max-h-96">
              {JSON.stringify(draft, null, 2)}
            </pre>
          </details>
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden group">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-700">
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              Raw Simpro job JSON
            </summary>
            <pre className="text-[11px] text-slate-600 p-4 overflow-x-auto max-h-96">
              {JSON.stringify(rawJob, null, 2)}
            </pre>
          </details>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Debug data is kept in sessionStorage only for this browser tab session.
          </div>
        </div>
      )}

      <div className="mt-8 space-y-3">
        {createError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {createError}
          </div>
        )}
        {blockingIssues.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p>
                Resolve {blockingIssues.length} blocking issue{blockingIssues.length !== 1 ? 's' : ''} in Import Notes before creating the project.
              </p>
              {incompleteEquipmentRows.length > 0 && (
                <ul className="mt-2 list-disc pl-5 space-y-1 text-red-900/90">
                  {incompleteEquipmentRows.slice(0, 8).map(row => (
                    <li key={row.equipment.draftId}>
                      {row.systemName}: &quot;{row.rowLabel}&quot; — missing{' '}
                      {row.missingFields.map(field => REQUIRED_EQUIPMENT_FIELD_LABELS[field]).join(' and ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
          <div className="text-sm text-slate-600 space-y-1">
            <p>
              {summary.selectedSystems} of {summary.totalSystems} systems ·{' '}
              {summary.selectedLines} of {summary.totalLines} equipment lines ·{' '}
              {summary.deviceUnits} device units will be created as pending review.
            </p>
            {confirmationIssues.length > 0 && blockingIssues.length === 0 && (
              <p className="text-amber-700">
                {confirmationIssues.length} item{confirmationIssues.length !== 1 ? 's' : ''} may need review before creating.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleCreateProject}
            disabled={creating || blockingIssues.length > 0}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {creating ? 'Creating project…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
