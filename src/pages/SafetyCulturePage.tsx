import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

/** Legacy route — API connection lives on Integrations; template linking on Handover Config. */
export default function SafetyCulturePage() {
  return (
    <div className="max-w-lg mx-auto bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
      <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
        <Shield className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">SafetyCulture setup has moved</h2>
      <p className="text-sm text-slate-500">
        Connect your API token on <strong>Integrations</strong> (below Simpro). Link templates to handover documents
        and configure field linking on <strong>Handover → Handover Config</strong>.
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Link
          to="/integrations"
          className="inline-flex items-center px-4 py-2 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
        >
          Open Integrations
        </Link>
      </div>
    </div>
  );
}
