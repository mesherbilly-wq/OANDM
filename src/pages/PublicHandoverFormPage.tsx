import { useParams } from 'react-router-dom';

export default function PublicHandoverFormPage() {
  const { token = '' } = useParams();
  return (
    <div className="min-h-screen bg-[#e8e8e8] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white border border-[#404040] shadow-xl p-8 space-y-3">
        <h1 className="text-lg font-semibold text-slate-900">Browser forms are no longer used</h1>
        <p className="text-sm text-slate-600">
          Complete the Pacific handover PDF for this job and return the signed file with the upload link from the email.
          This online form link is retired.
        </p>
        {token ? <p className="text-[11px] font-mono text-slate-400 break-all">Reference: {token}</p> : null}
      </div>
    </div>
  );
}
