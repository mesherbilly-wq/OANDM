import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Copy, Trash2 } from 'lucide-react';
import { FormLetterhead, PACIFIC_INK, PACIFIC_RED } from '../FormLetterhead';
import { SignaturePad } from '../SignaturePad';
import {
  asRecord,
  asRows,
  duplicateEquipmentRow,
  emptyGroupRow,
  equipmentTitle,
  isFieldVisible,
  isGroupVisible,
  openDefects,
  overallProgress,
  sectionProgress,
  testResultOf,
  validateAnswers,
} from '../../lib/completionFormEngine';
import {
  confirmPhotoUpload,
  compressPhoto,
  createPhotoUpload,
  requestCustomerCorrection,
  savePublicDraft,
  signCustomerForm,
  submitEngineerForm,
} from '../../lib/completionFormsApi';
import { supabase } from '../../lib/supabase';
import type {
  CompletionAnswers,
  CompletionField,
  CompletionPhoto,
  CompletionPublicForm,
  CompletionSaveState,
  CompletionTestResult,
} from '../../lib/completionFormTypes';

const TEST_OPTIONS: Array<{ value: CompletionTestResult['result']; label: string }> = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'not_tested', label: 'Not tested' },
  { value: 'not_applicable', label: 'Not applicable' },
];

const inputClass = 'w-full min-h-12 border border-slate-200 rounded-lg px-3 py-3 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#C00000]/30 focus:border-[#C00000]';

function setPath(answers: CompletionAnswers, sectionId: string, updater: (record: Record<string, unknown>) => Record<string, unknown>): CompletionAnswers {
  return { ...answers, [sectionId]: updater(asRecord(answers[sectionId])) };
}

export function CompletionFormRunner({
  form,
  brand,
  demo,
}: {
  form: CompletionPublicForm;
  brand: { company_name: string | null; logo_url?: string | null } | null;
  demo?: boolean;
}) {
  const customer = form.role === 'customer';
  const sections = useMemo(
    () => form.schema.sections.filter(section => !customer || section.customerVisible),
    [form.schema.sections, customer],
  );
  const [answers, setAnswers] = useState<CompletionAnswers>(form.answers);
  const [photos, setPhotos] = useState<CompletionPhoto[]>(form.photos);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<CompletionSaveState>(demo ? 'saved' : 'saved');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(form.status === 'complete');
  const [correction, setCorrection] = useState('');
  const savedAnswers = useRef(JSON.stringify(form.answers));
  const timer = useRef<number | null>(null);

  const section = sections[index];
  const issues = validateAnswers(form.schema, answers, photos, customer ? 'customer' : 'engineer');
  const sectionIssues = issues.filter(issue => issue.sectionId === section?.id);
  const progress = overallProgress(form.schema, answers, photos);
  const locked = form.revisionLocked && !customer;
  const defects = openDefects(answers);
  const dirty = JSON.stringify(answers) !== savedAnswers.current;

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty || saveState === 'saved') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty, saveState]);

  useEffect(() => {
    if (demo || customer || locked || !dirty) return;
    setSaveState('unsaved');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void persist();
    }, 1400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [answers]);

  const persist = async () => {
    if (demo) {
      savedAnswers.current = JSON.stringify(answers);
      setSaveState('saved');
      return;
    }
    if (!navigator.onLine) {
      setSaveState('offline');
      return;
    }
    setSaveState('saving');
    try {
      await savePublicDraft(form.token, answers);
      savedAnswers.current = JSON.stringify(answers);
      setSaveState('saved');
      setError(null);
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const updateSection = (patch: Record<string, unknown>) => {
    if (locked) return;
    setAnswers(current => setPath(current, section.id, record => ({ ...record, ...patch })));
  };

  const saveLabel = {
    saved: 'Saved',
    saving: 'Saving',
    unsaved: 'Unsaved changes',
    offline: 'Connection lost',
    error: 'Not saved',
  }[saveState];

  if (done) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <FormLetterhead brand={brand as never} title={form.title} jobRef={form.project.jobNumber} />
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-slate-900">Received</h2>
          <p className="text-sm text-slate-600 mt-2">
            This revision has been signed. The office will keep the signed record and add the approved document to the O&amp;M pack.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f4f4] text-slate-900">
      <div className="max-w-3xl mx-auto pb-28">
        <FormLetterhead
          brand={brand as never}
          title={form.title}
          subtitle={`Revision ${form.revisionNo} · ${form.status.replace(/_/g, ' ')}`}
          jobRef={form.project.jobNumber || form.project.siteName}
        />

        <div className="px-4 pt-3 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: PACIFIC_INK }}>{section ? `${index + 1} of ${sections.length}` : ''}</span>
              <span className={`text-sm font-medium ${saveState === 'error' || saveState === 'offline' ? 'text-amber-800' : 'text-slate-600'}`}>{saveLabel}</span>
            </div>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${progress.percent}%`, background: PACIFIC_RED }} />
            </div>
            <p className="text-xs text-slate-500 mt-2">{progress.complete} of {progress.required} required answers complete</p>
          </div>

          <p className="text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-3">
            This form needs an internet connection. Entries are not stored on this device. Offline completion is not available.
            {demo ? ' Demonstration only — nothing is saved to a project.' : ''}
          </p>

          {form.reviewNote && (
            <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3">{form.reviewNote}</p>
          )}

          {customer && (defects.length > 0 || form.outstandingHandoverAuthorised) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
              <p className="text-sm font-semibold text-amber-950">Outstanding items and limitations</p>
              {form.outstandingHandoverAuthorised && (
                <p className="text-sm text-amber-900">The office authorised handover with the items below still open.</p>
              )}
              {defects.map(row => (
                <p key={String(row._rowId)} className="text-sm text-amber-950">{String(row.location || 'Item')}: {String(row.description || '')}</p>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          {section && (
            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
                <p className="text-sm text-slate-500 mt-1">{section.summary}</p>
                {section.note && <p className="text-sm text-slate-600 mt-2">{section.note}</p>}
              </div>

              {(section.fields ?? []).filter(field => !customer || field.customerVisible !== false).map(field => (
                isFieldVisible(field, asRecord(answers[section.id]), asRecord(answers[section.id])) ? (
                  <FieldControl
                    key={field.id}
                    field={field}
                    value={asRecord(answers[section.id])[field.id]}
                    disabled={locked && section.id !== 'customer'}
                    issue={sectionIssues.find(issue => issue.path === `${section.id}.${field.id}`)?.message}
                    photos={photos.filter(photo => photo.fieldPath === `${section.id}.${field.id}`)}
                    onChange={value => updateSection({ [field.id]: value })}
                    onUpload={async (file, caption) => {
                      if (demo) {
                        setPhotos(current => [...current, {
                          id: `demo-${Date.now()}`,
                          fieldPath: `${section.id}.${field.id}`,
                          fileName: file.name,
                          caption,
                          contentType: file.type,
                          status: 'ready',
                          signedUrl: URL.createObjectURL(file),
                        }]);
                        return;
                      }
                      const tempId = `tmp-${Date.now()}`;
                      const path = `${section.id}.${field.id}`;
                      setPhotos(current => [...current, { id: tempId, fieldPath: path, fileName: file.name, caption, contentType: file.type, status: 'uploading' }]);
                      try {
                        const prepared = await compressPhoto(file);
                        const created = await createPhotoUpload(form.token, { fieldPath: path, fileName: prepared.name, contentType: prepared.type, caption });
                        const uploaded = await supabase.storage.from('completion-form-files').uploadToSignedUrl(created.path, created.signedToken, prepared);
                        if (uploaded.error) throw new Error(uploaded.error.message);
                        await confirmPhotoUpload(form.token, created.assetId, true, undefined, caption);
                        setPhotos(current => current.map(photo => photo.id === tempId ? { ...photo, id: String(created.assetId), status: 'ready' } : photo));
                      } catch (err) {
                        setPhotos(current => current.map(photo => photo.id === tempId ? { ...photo, status: 'failed', error: err instanceof Error ? err.message : 'Upload failed' } : photo));
                        throw err;
                      }
                    }}
                  />
                ) : null
              ))}

              {(section.groups ?? []).filter(group => isGroupVisible(group, asRecord(answers[section.id]))).map(group => {
                const rows = asRows(asRecord(answers[section.id])[group.id]);
                return (
                  <div key={group.id} className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-800">{group.title}</h3>
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => updateSection({ [group.id]: [...rows, emptyGroupRow(group)] })}
                          className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-sm font-medium text-white"
                          style={{ background: PACIFIC_RED }}
                        >
                          <Plus className="w-4 h-4" />{group.addLabel}
                        </button>
                      )}
                    </div>
                    {rows.length === 0 && <p className="text-sm text-slate-500">None added yet.</p>}
                    {rows.map((row, rowIndex) => (
                      <div key={String(row._rowId ?? rowIndex)} className="border border-slate-200 rounded-xl p-3 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{equipmentTitle(group, row, rowIndex)}</p>
                          {!locked && (
                            <div className="flex gap-1">
                              <button type="button" className="min-h-11 min-w-11 inline-flex items-center justify-center text-slate-500" onClick={() => {
                                const next = [...rows];
                                next.splice(rowIndex + 1, 0, duplicateEquipmentRow(group, row));
                                updateSection({ [group.id]: next });
                              }} aria-label="Duplicate">
                                <Copy className="w-4 h-4" />
                              </button>
                              <button type="button" className="min-h-11 min-w-11 inline-flex items-center justify-center text-slate-500" onClick={() => updateSection({ [group.id]: rows.filter((_, i) => i !== rowIndex) })} aria-label="Remove">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                        {group.fields.filter(field => isFieldVisible(field, row, asRecord(answers[section.id]))).map(field => (
                          <FieldControl
                            key={field.id}
                            field={field}
                            value={row[field.id]}
                            disabled={locked}
                            issue={sectionIssues.find(issue => issue.path === `${section.id}.${group.id}.${rowIndex}.${field.id}`)?.message}
                            photos={[]}
                            onChange={value => {
                              const next = rows.map((current, i) => i === rowIndex ? { ...current, [field.id]: value } : current);
                              updateSection({ [group.id]: next });
                            }}
                          />
                        ))}
                        {(group.nested ?? []).filter(nested => isGroupVisible(nested, asRecord(answers[section.id]), row)).map(nested => {
                          const children = asRows(row[nested.id]);
                          return (
                            <div key={nested.id} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">{nested.title}</p>
                                {!locked && (
                                  <button type="button" className="text-sm font-medium" style={{ color: PACIFIC_RED }} onClick={() => {
                                    const next = rows.map((current, i) => i === rowIndex ? { ...current, [nested.id]: [...children, emptyGroupRow(nested)] } : current);
                                    updateSection({ [group.id]: next });
                                  }}>{nested.addLabel}</button>
                                )}
                              </div>
                              {children.map((child, childIndex) => (
                                <div key={String(child._rowId ?? childIndex)} className="bg-slate-50 rounded-lg p-3 space-y-3">
                                  {nested.fields.filter(field => isFieldVisible(field, child, row)).map(field => (
                                    <FieldControl
                                      key={field.id}
                                      field={field}
                                      value={child[field.id]}
                                      disabled={locked}
                                      onChange={value => {
                                        const nextChildren = children.map((current, i) => i === childIndex ? { ...current, [field.id]: value } : current);
                                        const next = rows.map((current, i) => i === rowIndex ? { ...current, [nested.id]: nextChildren } : current);
                                        updateSection({ [group.id]: next });
                                      }}
                                    />
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
          )}

          {customer && section?.id === 'customer' && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <label className="block text-sm font-medium text-slate-800">
                Request a correction / not ready to sign
                <textarea value={correction} onChange={event => setCorrection(event.target.value)} className={`${inputClass} mt-1 min-h-28`} />
              </label>
              <button
                type="button"
                disabled={busy || !correction.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (!demo) await requestCustomerCorrection(form.token, correction.trim());
                    setDone(true);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not send the comment.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full min-h-12 border border-slate-300 rounded-lg text-sm font-medium"
              >
                Send comment instead of signing
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex gap-2">
          <button type="button" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, i - 1))} className="min-h-12 px-4 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-40">
            <span className="inline-flex items-center gap-1"><ChevronLeft className="w-4 h-4" />Previous</span>
          </button>
          <button type="button" onClick={() => void persist()} className="min-h-12 px-4 rounded-lg border border-slate-200 text-sm font-medium">
            Save and exit
          </button>
          {index < sections.length - 1 ? (
            <button type="button" onClick={() => setIndex(i => i + 1)} className="flex-1 min-h-12 rounded-lg text-white text-sm font-semibold" style={{ background: PACIFIC_RED }}>
              Next <ChevronRight className="w-4 h-4 inline" />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || (customer ? issues.length > 0 : issues.length > 0)}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  if (photos.some(photo => photo.status === 'failed' || photo.status === 'uploading')) {
                    throw new Error('Wait for photographs to finish uploading, or retry a failed photo, before submitting.');
                  }
                  if (issues.length > 0) throw new Error(issues[0].message);
                  if (demo) {
                    setDone(true);
                    return;
                  }
                  if (customer) {
                    const record = asRecord(answers.customer);
                    await signCustomerForm(form.token, {
                      name: String(record.name ?? ''),
                      role: String(record.role ?? ''),
                      accepted: record.accepted === true,
                      dataUrl: String(asRecord(record.signature).dataUrl ?? ''),
                      signedAt: '',
                      revisionNo: form.revisionNo,
                    });
                  } else {
                    if (dirty) await persist();
                    const record = asRecord(answers.engineer);
                    await submitEngineerForm(form.token, answers, {
                      name: String(record.name ?? ''),
                      company: String(record.company ?? ''),
                      role: String(record.role ?? ''),
                      accepted: record.declaration === true,
                      dataUrl: String(asRecord(record.signature).dataUrl ?? ''),
                      signedAt: '',
                      revisionNo: form.revisionNo,
                    });
                  }
                  setDone(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not submit.');
                } finally {
                  setBusy(false);
                }
              }}
              className="flex-1 min-h-12 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: PACIFIC_RED }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : customer ? 'Sign handover' : 'Sign and submit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
  issue,
  photos = [],
  onUpload,
}: {
  field: CompletionField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  issue?: string;
  photos?: CompletionPhoto[];
  onUpload?: (file: File, caption: string) => Promise<void>;
}) {
  if (field.sensitive === true && field.type !== 'text') {
    /* keep rendering; sensitive text still collected from engineer */
  }
  if (field.type === 'note') {
    return <p className="text-sm leading-relaxed text-slate-600">{field.label}</p>;
  }
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-slate-800">
        {field.label}
        {field.required ? <span className="text-[#C00000]"> *</span> : null}
        {field.unit ? <span className="text-slate-400 font-normal"> ({field.unit})</span> : null}
      </span>
      {field.help && <span className="block text-xs text-slate-500">{field.help}</span>}
      <Control field={field} value={value} onChange={onChange} disabled={disabled} photos={photos} onUpload={onUpload} />
      {issue && <span className="block text-sm text-red-700">{issue}</span>}
    </label>
  );
}

function Control({
  field,
  value,
  onChange,
  disabled,
  photos,
  onUpload,
}: {
  field: CompletionField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  photos: CompletionPhoto[];
  onUpload?: (file: File, caption: string) => Promise<void>;
}) {
  if (field.type === 'textarea') {
    return <textarea disabled={disabled} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={`${inputClass} min-h-28`} />;
  }
  if (field.type === 'number') {
    return (
      <input
        disabled={disabled}
        type="number"
        inputMode={field.inputMode ?? 'decimal'}
        min={field.min}
        max={field.max}
        step={field.step ?? 'any'}
        value={value === '' || value == null ? '' : String(value)}
        onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className={inputClass}
      />
    );
  }
  if (field.type === 'date') {
    return <input disabled={disabled} type="date" value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass} />;
  }
  if (field.type === 'tel' || field.type === 'email') {
    return <input disabled={disabled} type={field.type} inputMode={field.type} autoComplete={field.type} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass} />;
  }
  if (field.type === 'select') {
    return (
      <select disabled={disabled} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass}>
        <option value="">Choose…</option>
        {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="flex flex-col gap-2">
        {(field.options ?? []).map(option => (
          <label key={option} className="flex items-center gap-3 min-h-12 px-3 border border-slate-200 rounded-lg">
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(option)}
              onChange={() => onChange(selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option])}
              className="h-5 w-5"
            />
            <span className="text-sm">{option}</span>
          </label>
        ))}
      </div>
    );
  }
  if (field.type === 'test_result') {
    const current = testResultOf(value);
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {TEST_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...current, result: current.result === option.value ? '' : option.value })}
              className={`min-h-12 rounded-lg border text-sm font-medium ${current.result === option.value ? 'text-white border-transparent' : 'bg-white text-slate-800 border-slate-200'}`}
              style={current.result === option.value ? { background: PACIFIC_RED } : undefined}
            >
              {option.label}
            </button>
          ))}
        </div>
        {current.result && current.result !== 'pass' && (
          <textarea
            disabled={disabled}
            value={current.reason}
            onChange={event => onChange({ ...current, reason: event.target.value })}
            placeholder="Reason"
            className={`${inputClass} min-h-24`}
          />
        )}
      </div>
    );
  }
  if (field.type === 'declaration') {
    return (
      <label className="flex items-start gap-3 min-h-12">
        <input type="checkbox" disabled={disabled} checked={value === true} onChange={event => onChange(event.target.checked)} className="h-5 w-5 mt-1" />
        <span className="text-sm text-slate-700">I confirm this declaration</span>
      </label>
    );
  }
  if (field.type === 'signature') {
    const record = asRecord(value);
    return (
      <div className="space-y-2">
        <SignaturePad value={String(record.dataUrl ?? '')} onChange={dataUrl => onChange({ ...record, dataUrl })} />
        <p className="text-xs text-slate-500">Drawn with a finger or mouse. Clear and sign again if needed. This is not a qualified digital signature.</p>
      </div>
    );
  }
  if (field.type === 'photo') {
    return (
      <div className="space-y-3">
        {photos.map(photo => (
          <div key={photo.id} className="border border-slate-200 rounded-lg overflow-hidden">
            {photo.signedUrl && <img src={photo.signedUrl} alt={photo.caption || photo.fileName} className="w-full max-h-72 object-contain bg-slate-50" />}
            <p className="px-3 py-2 text-xs text-slate-500">
              {photo.status === 'ready' ? photo.caption || photo.fileName : photo.status === 'uploading' ? 'Uploading…' : photo.error || 'Upload failed'}
            </p>
          </div>
        ))}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled || !onUpload}
          className="block w-full text-sm"
          onChange={async event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file && onUpload) await onUpload(file, file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
          }}
        />
      </div>
    );
  }
  return <input disabled={disabled} type="text" inputMode={field.inputMode} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass} />;
}

export function sectionCounts(form: CompletionPublicForm, answers: CompletionAnswers, photos: CompletionPhoto[]) {
  return form.schema.sections.map(section => ({ id: section.id, ...sectionProgress(form.schema, answers, photos, section) }));
}
