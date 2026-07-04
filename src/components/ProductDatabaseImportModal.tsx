import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Columns3,
  FileUp,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type { ProductModel } from '../types';
import {
  buildProductDatabaseImportPreview,
  importPreviewCanApply,
  importPreviewHasBlockingIssues,
  likelyWrongColumnMapping,
  parseProductDatabaseCsvText,
  prepareProductDatabaseImportRows,
  prepareProductDatabaseImportRowsWithMapping,
  PRODUCT_DATABASE_CSV_HEADERS,
  PRODUCT_DATABASE_MAPPING_FIELDS,
  PRODUCT_DATABASE_PREVIEW_COLUMNS,
  DEFAULT_PRODUCT_WARRANTY_YEARS,
  suggestColumnMapping,
  updateImportCsvRowField,
  validateColumnMapping,
  type ProductDatabaseColumnMapping,
  type ProductDatabaseCsvRow,
  type ProductDatabaseImportMode,
  type ProductDatabaseImportPreview,
  type ProductDatabasePreviewCategory,
  type ProductDatabasePreviewRow,
  type ProductDatabaseRequiredCsvField,
} from '../lib/productDatabaseCsv';
import { applyProductDatabaseImport } from '../lib/productDatabaseDb';

type Stage = 'configure' | 'mapColumns' | 'preview' | 'applying' | 'done';

interface Props {
  products: ProductModel[];
  onClose: () => void;
  onComplete: () => void;
}

const CATEGORY_LABELS: Record<ProductDatabasePreviewCategory, string> = {
  new: 'New rows',
  updated: 'Updated rows',
  skipped: 'Skipped rows',
  duplicate: 'Duplicate / conflict rows',
  incomplete: 'Incomplete rows',
};

const CATEGORY_STYLES: Record<ProductDatabasePreviewCategory, string> = {
  new: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  updated: 'bg-blue-50 text-blue-800 border-blue-200',
  skipped: 'bg-slate-50 text-slate-700 border-slate-200',
  duplicate: 'bg-amber-50 text-amber-800 border-amber-200',
  incomplete: 'bg-red-50 text-red-800 border-red-200',
};

const REQUIRED_FIELD_BY_COLUMN: Partial<
  Record<(typeof PRODUCT_DATABASE_PREVIEW_COLUMNS)[number]['field'], ProductDatabaseRequiredCsvField>
> = {
  productCategory: 'productCategory',
  productDescription: 'productDescription',
  brand: 'brand',
  partNumber: 'partNumber',
};

function cellClass(isMissingRequired: boolean, mono = false): string {
  return [
    'px-3 py-2 max-w-[16rem]',
    mono ? 'font-mono text-xs' : '',
    isMissingRequired
      ? 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-300'
      : 'text-slate-700',
  ]
    .filter(Boolean)
    .join(' ');
}

function ColumnMappingPanel({
  rawHeaders,
  rawRecords,
  columnMapping,
  mappingErrors,
  onMappingChange,
  onContinue,
}: {
  rawHeaders: string[];
  rawRecords: Record<string, string>[];
  columnMapping: ProductDatabaseColumnMapping;
  mappingErrors: string[];
  onMappingChange: (mapping: ProductDatabaseColumnMapping) => void;
  onContinue: () => void;
}) {
  const usableHeaders = rawHeaders.filter(header => header.trim().length > 0);
  const sampleRows = rawRecords.slice(0, 3);

  const previewValues = (header: ProductDatabaseImportHeader): string[] => {
    const rawHeader = columnMapping[header];
    if (!rawHeader) return sampleRows.map(() => '—');
    return sampleRows.map(record => String(record[rawHeader] ?? '').trim() || '—');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">Map CSV columns to Product Database fields</p>
        <p className="mt-1 text-amber-800">
          Automatic detection could not match your file. Choose which CSV column corresponds to each field below.
        </p>
      </div>

      {usableHeaders.length === 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No column headers were detected. Check that the first row of your CSV contains column names.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Product Database field</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Your CSV column</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Sample values</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PRODUCT_DATABASE_MAPPING_FIELDS.map(({ header, required }) => (
              <tr key={header}>
                <td className="px-3 py-2 text-slate-800">
                  {header}
                  {required ? <span className="text-red-600 ml-1">*</span> : null}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={columnMapping[header] ?? ''}
                    onChange={event => {
                      const value = event.target.value;
                      onMappingChange({
                        ...columnMapping,
                        [header]: value || undefined,
                      });
                    }}
                    className="w-full min-w-[12rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  >
                    <option value="">{required ? '— Select column —' : '— Not mapped —'}</option>
                    {usableHeaders.map(rawHeader => (
                      <option key={rawHeader} value={rawHeader}>
                        {rawHeader}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 max-w-[20rem]">
                  {previewValues(header).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Detected CSV columns ({usableHeaders.length}): {usableHeaders.join(' · ') || 'none'}
      </p>

      {mappingErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ul className="list-disc list-inside space-y-0.5">
            {mappingErrors.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={mappingErrors.length > 0 || usableHeaders.length === 0}
          className="px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          Continue to preview
        </button>
      </div>
    </div>
  );
}

function PreviewTable({
  title,
  rows,
  category,
  onEditRow,
}: {
  title: string;
  rows: ProductDatabasePreviewRow[];
  category: ProductDatabasePreviewCategory;
  onEditRow?: (
    rowNumber: number,
    field: keyof Omit<ProductDatabaseCsvRow, 'rowNumber'>,
    value: string,
  ) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_STYLES[category]}`}>
          {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {PRODUCT_DATABASE_PREVIEW_COLUMNS.map(column => (
                <th key={column.header} className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 50).map(row => (
              <React.Fragment key={`${category}-${row.rowNumber}`}>
                <tr>
                  {PRODUCT_DATABASE_PREVIEW_COLUMNS.map(column => {
                    const value =
                      column.field === 'warranty'
                        ? row.csv.warranty.trim() || String(DEFAULT_PRODUCT_WARRANTY_YEARS)
                        : row.csv[column.field];
                    const requiredField = REQUIRED_FIELD_BY_COLUMN[column.field];
                    const isMissingRequired = Boolean(
                      requiredField && row.missingRequiredFields?.includes(requiredField),
                    );
                    const editable = category === 'incomplete' && onEditRow;

                    return (
                      <td
                        key={`${row.rowNumber}-${column.field}`}
                        className={cellClass(Boolean(isMissingRequired), column.mono)}
                      >
                        {editable ? (
                          <input
                            value={row.csv[column.field]}
                            onChange={event => onEditRow(row.rowNumber, column.field, event.target.value)}
                            className={`w-full rounded border px-2 py-1 text-sm ${
                              isMissingRequired
                                ? 'border-red-300 bg-white text-red-900 focus:ring-red-400'
                                : 'border-slate-200 focus:ring-cyan-400'
                            } focus:outline-none focus:ring-2`}
                            placeholder={column.header}
                          />
                        ) : (
                          value || '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
                {row.reason && (
                  <tr>
                    <td
                      colSpan={PRODUCT_DATABASE_PREVIEW_COLUMNS.length}
                      className="px-3 py-1 text-xs text-slate-500 bg-slate-50/60"
                    >
                      {row.reason}
                      {row.existingProduct ? ` (#${row.existingProduct.id})` : ''}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <p className="text-xs text-slate-500">Showing first 50 of {rows.length} rows.</p>
      )}
    </div>
  );
}

export function ProductDatabaseImportModal({ products, onClose, onComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('configure');
  const [mode, setMode] = useState<ProductDatabaseImportMode>('merge');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProductDatabaseImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [rawRecords, setRawRecords] = useState<Record<string, string>[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ProductDatabaseColumnMapping>({});
  const [mappingHint, setMappingHint] = useState<string | null>(null);

  const mappingErrors = useMemo(() => validateColumnMapping(columnMapping), [columnMapping]);

  const groupedPreview = useMemo(() => {
    if (!preview) return null;
    return {
      new: preview.rows.filter(row => row.category === 'new'),
      updated: preview.rows.filter(row => row.category === 'updated'),
      skipped: preview.rows.filter(row => row.category === 'skipped'),
      duplicate: preview.rows.filter(row => row.category === 'duplicate'),
      incomplete: preview.rows.filter(row => row.category === 'incomplete'),
    };
  }, [preview]);

  const buildPreviewFromRows = (
    csvRows: ProductDatabaseCsvRow[],
    nextMode: ProductDatabaseImportMode,
    meta?: Pick<ProductDatabaseImportPreview, 'headerNormalization' | 'autofillFieldCount' | 'columnMapping'>,
  ) => buildProductDatabaseImportPreview(csvRows, products, nextMode, meta);

  const applyColumnMapping = (mapping: ProductDatabaseColumnMapping, nextMode = mode) => {
    setError(null);
    setMappingHint(null);

    const prepared = prepareProductDatabaseImportRowsWithMapping(
      rawRecords,
      rawHeaders,
      mapping,
      products,
    );

    if (prepared.errors.length > 0) {
      setError(prepared.errors.join(' '));
      setColumnMapping(mapping);
      setStage('mapColumns');
      return;
    }

    const nextPreview = buildPreviewFromRows(prepared.rows, nextMode, {
      headerNormalization: prepared.normalization,
      autofillFieldCount: prepared.autofillFieldCount,
      columnMapping: prepared.columnMapping,
    });

    console.info('[product-database-import] Preview diagnostics', nextPreview.parseDiagnostics);

    setColumnMapping(mapping);
    setPreview(nextPreview);
    setStage('preview');
  };

  const rebuildPreviewForMode = (nextMode: ProductDatabaseImportMode) => {
    if (!preview) return;
    if (Object.keys(columnMapping).length > 0) {
      applyColumnMapping(columnMapping, nextMode);
      return;
    }
    const csvRows = preview.rows.map(row => row.csv);
    setPreview(
      buildPreviewFromRows(csvRows, nextMode, {
        headerNormalization: preview.headerNormalization,
        autofillFieldCount: preview.autofillFieldCount,
      }),
    );
  };

  const updateIncompleteRow = (
    rowNumber: number,
    field: keyof Omit<ProductDatabaseCsvRow, 'rowNumber'>,
    value: string,
  ) => {
    if (!preview) return;
    const csvRows = updateImportCsvRowField(
      preview.rows.map(row => row.csv),
      rowNumber,
      field,
      value,
    );
    setPreview(
      buildPreviewFromRows(csvRows, preview.mode, {
        headerNormalization: preview.headerNormalization,
        autofillFieldCount: preview.autofillFieldCount,
      }),
    );
  };

  const parseFile = (file: File) => {
    setError(null);
    setResultMessage(null);
    setMappingHint(null);
    setFileName(file.name);

    void file.text().then(text => {
      const parsed = parseProductDatabaseCsvText(text);
      const headers = parsed.headers;
      const records = parsed.records;

      console.info('[product-database-import] Parsed CSV headers', headers);
      console.info('[product-database-import] Parsed CSV delimiter', JSON.stringify(parsed.delimiter));
      console.info('[product-database-import] Parsed row count', records.length);

      setRawHeaders(headers);
      setRawRecords(records);

      const { mapping: suggestedMapping } = suggestColumnMapping(headers);
      setColumnMapping(suggestedMapping);

      const autoPrepared = prepareProductDatabaseImportRows(records, headers, products);

      if (autoPrepared.errors.length > 0) {
        console.info('[product-database-import] Auto header detection failed', autoPrepared.errors);
        setPreview(null);
        setMappingHint('Could not auto-detect all required columns — please map them manually.');
        setStage('mapColumns');
        return;
      }

      const autoPreview = buildPreviewFromRows(autoPrepared.rows, mode, {
        headerNormalization: autoPrepared.normalization,
        autofillFieldCount: autoPrepared.autofillFieldCount,
      });

      if (likelyWrongColumnMapping(autoPreview)) {
        console.info('[product-database-import] Auto mapping likely wrong', autoPreview.summary);
        setPreview(null);
        setMappingHint('Rows were parsed but fields look empty or wrong — please confirm column mapping.');
        setStage('mapColumns');
        return;
      }

      if (autoPreview.parseDiagnostics) {
        console.info('[product-database-import] Preview diagnostics', autoPreview.parseDiagnostics);
      }

      setPreview({ ...autoPreview, columnMapping: suggestedMapping });
      setStage('preview');
    }).catch(parseError => {
      setError(parseError instanceof Error ? parseError.message : 'Failed to read CSV file.');
      setPreview(null);
    });
  };

  const handleApply = async () => {
    if (!preview || !importPreviewCanApply(preview)) return;

    const confirmMessage =
      preview.mode === 'replace'
        ? 'Replace / rebuild the Product Database with this CSV?\n\nAll existing product records will be deleted first, then replaced with the CSV contents. Datasheets, manuals, and project devices are not affected.'
        : 'Apply this CSV import in merge/update mode?\n\nMatched products will be updated and new rows inserted. Datasheets and project devices are not affected.';

    if (!window.confirm(confirmMessage)) return;

    setStage('applying');
    setError(null);

    const result = await applyProductDatabaseImport(preview);
    if (result.error) {
      setError(result.error);
      setStage('preview');
      return;
    }

    setResultMessage(
      preview.mode === 'replace'
        ? `Rebuilt Product Database with ${result.inserted} product${result.inserted === 1 ? '' : 's'}.`
        : `Import complete: ${result.inserted} inserted, ${result.updated} updated.`,
    );
    setStage('done');
    onComplete();
  };

  const blockingIssues = preview ? importPreviewHasBlockingIssues(preview) : false;
  const canApply = preview ? importPreviewCanApply(preview) : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Import Product Database CSV</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Column headers are spell-checked and normalised on import. Required fields must be complete before continuing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {stage === 'done' && resultMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{resultMessage}</span>
            </div>
          )}

          {(stage === 'configure' || stage === 'preview' || stage === 'mapColumns') && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Import mode</span>
                  <select
                    value={mode}
                    onChange={event => {
                      const nextMode = event.target.value as ProductDatabaseImportMode;
                      setMode(nextMode);
                      if (preview) rebuildPreviewForMode(nextMode);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                  >
                    <option value="merge">Merge / update existing products</option>
                    <option value="replace">Replace / rebuild Product Database</option>
                  </select>
                </label>

                <div>
                  <span className="text-sm font-medium text-slate-700">CSV file</span>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50"
                    >
                      <FileUp className="w-4 h-4" />
                      Choose CSV
                    </button>
                    {fileName && <span className="text-sm text-slate-500 truncate">{fileName}</span>}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (file) parseFile(file);
                      event.target.value = '';
                    }}
                  />
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Standard columns: {PRODUCT_DATABASE_CSV_HEADERS.join(' · ')}. Product Family is optional on import.
                If headers are not recognised, you will be asked to map columns manually.
              </p>
            </>
          )}

          {stage === 'mapColumns' && (
            <>
              {mappingHint && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <Columns3 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>{mappingHint}</span>
                </div>
              )}
              <ColumnMappingPanel
                rawHeaders={rawHeaders}
                rawRecords={rawRecords}
                columnMapping={columnMapping}
                mappingErrors={mappingErrors}
                onMappingChange={setColumnMapping}
                onContinue={() => applyColumnMapping(columnMapping)}
              />
            </>
          )}

          {stage === 'preview' && preview && groupedPreview && (
            <>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMappingHint('Adjust which CSV column maps to each field.');
                    setStage('mapColumns');
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Columns3 className="w-4 h-4" />
                  Change column mapping
                </button>
              </div>
              {preview.headerNormalization && preview.headerNormalization.corrections.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <p className="font-medium mb-1">Column headers normalised</p>
                  <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                    {preview.headerNormalization.corrections.map(correction => (
                      <li key={`${correction.original}-${correction.canonical}`}>
                        "{correction.original}" → "{correction.canonical}"
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(preview.autofillFieldCount ?? 0) > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                  <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>
                    Automatically filled {preview.autofillFieldCount} blank field
                    {preview.autofillFieldCount === 1 ? '' : 's'} from the existing Product Database.
                  </span>
                </div>
              )}

              {blockingIssues && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>
                    {preview.summary.incomplete} row{preview.summary.incomplete === 1 ? '' : 's'} still missing required
                    fields (Product Description, Brand, Manufacturers Part Number, and/or Product Category). Edit the highlighted cells below before importing.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {(Object.keys(CATEGORY_LABELS) as ProductDatabasePreviewCategory[]).map(key => (
                  <div key={key} className={`rounded-lg border px-3 py-2 ${CATEGORY_STYLES[key]}`}>
                    <p className="text-xs font-medium">{CATEGORY_LABELS[key]}</p>
                    <p className="text-lg font-semibold">{preview.summary[key]}</p>
                  </div>
                ))}
              </div>

              <PreviewTable
                title="Action required — complete missing fields"
                rows={groupedPreview.incomplete}
                category="incomplete"
                onEditRow={updateIncompleteRow}
              />
              <PreviewTable title="New rows" rows={groupedPreview.new} category="new" />
              <PreviewTable title="Updated rows" rows={groupedPreview.updated} category="updated" />
              <PreviewTable title="Skipped rows" rows={groupedPreview.skipped} category="skipped" />
              <PreviewTable title="Duplicate / conflict rows" rows={groupedPreview.duplicate} category="duplicate" />
            </>
          )}

          {stage === 'applying' && (
            <div className="flex items-center gap-3 text-slate-600 py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              Applying import…
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <p className="text-xs text-slate-500">
            {stage === 'mapColumns'
              ? mappingErrors.length > 0
                ? 'Complete required column mappings to continue.'
                : 'Select CSV columns for each field, then continue to preview.'
              : blockingIssues
                ? 'Import blocked until all required fields are completed.'
                : canApply
                  ? 'Ready to import.'
                  : preview && preview.summary.new + preview.summary.updated === 0 && preview.rows.length > 0
                    ? `${preview.rows.length} row${preview.rows.length === 1 ? '' : 's'} parsed — none are ready to import (see categories above). Use "Change column mapping" if fields look wrong.`
                    : preview && preview.rows.length === 0
                      ? 'No data rows found in CSV.'
                      : 'No importable rows found.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-white"
            >
              {stage === 'done' ? 'Close' : 'Cancel'}
            </button>
            {stage === 'mapColumns' && (
              <button
                type="button"
                onClick={() => setStage(preview ? 'preview' : 'configure')}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-white"
              >
                {preview ? 'Back to preview' : 'Back'}
              </button>
            )}
            {stage === 'preview' && preview && (
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={!canApply}
                className="px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
                title={
                  blockingIssues
                    ? 'Complete all required fields before importing'
                    : !canApply
                      ? 'No rows ready to import'
                      : undefined
                }
              >
                {preview.mode === 'replace' ? 'Rebuild and import' : 'Apply merge import'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
