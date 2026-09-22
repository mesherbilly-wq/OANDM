import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CompletionFormRunner } from '../components/completion/CompletionFormRunner';
import { getPublicCompletionForm } from '../lib/completionFormsApi';
import { emptyAnswers } from '../lib/completionFormEngine';
import { publishedSchema } from '../lib/completionFormEngine';
import { fetchPublicContractorBrand } from '../lib/contractorBrand';
import type { CompletionPublicForm } from '../lib/completionFormTypes';

function demoForm(role: CompletionPublicForm['role']): CompletionPublicForm {
  const schema = publishedSchema();
  return {
    token: 'demo-cctv',
    role,
    status: 'in_progress',
    title: schema.title,
    schema,
    answers: emptyAnswers(schema),
    photos: [],
    revisionNo: 1,
    revisionLocked: false,
    project: {
      jobNumber: 'DEMO-001',
      projectName: 'Demonstration CCTV handover',
      clientName: 'Demonstration client',
      siteName: 'Demonstration site',
      siteAddress: '1 Example Street, Demonstration',
      projectManager: 'Alex Manager',
      engineer: 'Sam Engineer',
    },
    companyName: 'Pacific',
    assignedName: 'Sam Engineer',
    expiresAt: null,
    reviewNote: 'Demonstration — not saved to a project.',
    outstandingHandoverAuthorised: false,
    offlineSupported: false,
    signatureNotice: 'Demonstration signature only.',
  };
}

export default function PublicCompletionFormPage() {
  const { token = '' } = useParams();
  const [form, setForm] = useState<CompletionPublicForm | null>(null);
  const [brand, setBrand] = useState<Awaited<ReturnType<typeof fetchPublicContractorBrand>>>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (token === 'demo-cctv' || token === 'demo-cctv-customer') {
      setForm(demoForm(token === 'demo-cctv-customer' ? 'customer' : 'engineer'));
      void fetchPublicContractorBrand().then(nextBrand => {
        if (!cancelled) setBrand(nextBrand);
      }).catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([getPublicCompletionForm(token), fetchPublicContractorBrand()]).then(([next, nextBrand]) => {
      if (cancelled) return;
      setForm(next);
      setBrand(nextBrand);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'This form link is not valid.');
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#f4f4f4] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-slate-900">Form unavailable</h1>
          <p className="text-sm text-slate-600 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="min-h-screen bg-[#f4f4f4] flex items-center justify-center text-sm text-slate-500">
        Opening form…
      </div>
    );
  }

  return <CompletionFormRunner form={form} brand={brand} />;
}
