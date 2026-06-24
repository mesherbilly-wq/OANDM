import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Shield, Building2, Mail, Lock, Eye, EyeOff, ArrowRight,
  ArrowLeft, Phone, Globe, Hash, Award, MapPin, Check,
  AlertCircle,
} from 'lucide-react';

type View = 'login' | 'register';
type RegStep = 1 | 2 | 3;

interface CompanyForm {
  company_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postcode: string;
  telephone: string;
  email: string;
  website: string;
  company_reg_number: string;
  vat_number: string;
  nsi_number: string;
  ssaib_number: string;
  other_certifications: string;
}

const BLANK: CompanyForm = {
  company_name: '', address_line1: '', address_line2: '', city: '', postcode: '',
  telephone: '', email: '', website: '', company_reg_number: '', vat_number: '',
  nsi_number: '', ssaib_number: '', other_certifications: '',
};

const ic = 'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all placeholder:text-slate-400';
const label = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5';

function FieldError({ msg }: { msg: string }) {
  return <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{msg}</p>;
}

function InputGroup({ lbl, icon: Icon, children }: { lbl: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <label className={label}>
        {Icon && <Icon className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-slate-400" />}{lbl}
      </label>
      {children}
    </div>
  );
}

// ─── Login Form ────────────────────────────────────────────────────────────────

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className={label}><Mail className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-slate-400" />Email Address</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={ic} placeholder="you@company.co.uk" required autoComplete="email" />
      </div>
      <div>
        <label className={label}><Lock className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-slate-400" />Password</label>
        <div className="relative">
          <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
            className={`${ic} pr-11`} placeholder="Your password" required autoComplete="current-password" />
          <button type="button" onClick={() => setShowPwd(p => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors disabled:opacity-50 text-sm">
        {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Sign In <ArrowRight className="w-4 h-4" /></>}
      </button>

      <p className="text-center text-sm text-slate-500">
        No account?{' '}
        <button type="button" onClick={onSwitch} className="text-cyan-600 hover:text-cyan-700 font-semibold transition-colors">
          Register your company
        </button>
      </p>
    </form>
  );
}

// ─── Register Form ─────────────────────────────────────────────────────────────

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const [step, setStep] = useState<RegStep>(1);
  const [form, setForm] = useState<CompanyForm>(BLANK);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CompanyForm | 'password' | 'confirmPassword', string>>>({});
  const [loading, setLoading] = useState(false);

  const f = (field: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validateStep1 = () => {
    const errs: typeof fieldErrors = {};
    if (!form.company_name.trim()) errs.company_name = 'Company name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';
    else if (password.length < 8) errs.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const nextStep = () => {
    if (step === 1 && !validateStep1()) return;
    setStep(s => (s < 3 ? (s + 1) as RegStep : s));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) { nextStep(); return; }

    setError('');
    setLoading(true);

    // Create Supabase auth account
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: form.email.trim(),
      password,
    });

    if (authErr) {
      setError(authErr.message);
      setLoading(false);
      return;
    }

    // Save contractor profile
    const profile = {
      company_name: form.company_name,
      address_line1: form.address_line1,
      address_line2: form.address_line2,
      city: form.city,
      postcode: form.postcode,
      telephone: form.telephone,
      email: form.email,
      website: form.website,
      company_reg_number: form.company_reg_number,
      vat_number: form.vat_number,
      nsi_number: form.nsi_number,
      ssaib_number: form.ssaib_number,
      other_certifications: form.other_certifications,
    };

    // Check if a profile already exists — update it; otherwise insert
    const { data: existing } = await supabase.from('contractor_profile').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('contractor_profile').update(profile).eq('id', existing.id);
    } else {
      await supabase.from('contractor_profile').insert(profile);
    }

    setLoading(false);
    // Auth state change will trigger app to show main layout
  };

  const STEPS = [
    { n: 1, label: 'Account' },
    { n: 2, label: 'Company' },
    { n: 3, label: 'Certifications' },
  ];

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.n}>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step > s.n ? 'bg-emerald-500 text-white' : step === s.n ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {step > s.n ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={`text-xs font-semibold hidden sm:block ${step === s.n ? 'text-slate-800' : 'text-slate-400'}`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 transition-all ${step > s.n ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Account & Company Name */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Create your account</h3>
            <p className="text-xs text-slate-500 mt-0.5">Your company name will appear on all generated documents</p>
          </div>
          <InputGroup lbl="Company Name" icon={Building2}>
            <input type="text" value={form.company_name} onChange={f('company_name')} className={ic} placeholder="Pacific Fire & Security" required />
            {fieldErrors.company_name && <FieldError msg={fieldErrors.company_name} />}
          </InputGroup>
          <InputGroup lbl="Email Address" icon={Mail}>
            <input type="email" value={form.email} onChange={f('email')} className={ic} placeholder="you@company.co.uk" required autoComplete="email" />
            {fieldErrors.email && <FieldError msg={fieldErrors.email} />}
          </InputGroup>
          <InputGroup lbl="Password" icon={Lock}>
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => { setPassword(e.target.value); setFieldErrors(p => ({ ...p, password: undefined })); }}
                className={`${ic} pr-11`} placeholder="Minimum 8 characters" autoComplete="new-password" />
              <button type="button" onClick={() => setShowPwd(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.password && <FieldError msg={fieldErrors.password} />}
          </InputGroup>
          <InputGroup lbl="Confirm Password" icon={Lock}>
            <input type={showPwd ? 'text' : 'password'} value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setFieldErrors(p => ({ ...p, confirmPassword: undefined })); }}
              className={ic} placeholder="Repeat your password" autoComplete="new-password" />
            {fieldErrors.confirmPassword && <FieldError msg={fieldErrors.confirmPassword} />}
          </InputGroup>
        </div>
      )}

      {/* Step 2: Company Details */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Company details</h3>
            <p className="text-xs text-slate-500 mt-0.5">These appear on all project documents and O&M packs</p>
          </div>
          <InputGroup lbl="Address Line 1" icon={MapPin}>
            <input type="text" value={form.address_line1} onChange={f('address_line1')} className={ic} placeholder="Building / street" />
          </InputGroup>
          <InputGroup lbl="Address Line 2">
            <input type="text" value={form.address_line2} onChange={f('address_line2')} className={ic} placeholder="District (optional)" />
          </InputGroup>
          <div className="grid grid-cols-2 gap-3">
            <InputGroup lbl="City / Town">
              <input type="text" value={form.city} onChange={f('city')} className={ic} placeholder="City" />
            </InputGroup>
            <InputGroup lbl="Postcode">
              <input type="text" value={form.postcode} onChange={f('postcode')} className={`${ic} uppercase`} placeholder="AB1 2CD" />
            </InputGroup>
          </div>
          <InputGroup lbl="Telephone" icon={Phone}>
            <input type="tel" value={form.telephone} onChange={f('telephone')} className={ic} placeholder="01234 567890" />
          </InputGroup>
          <InputGroup lbl="Website" icon={Globe}>
            <input type="text" value={form.website} onChange={f('website')} className={ic} placeholder="www.company.co.uk" />
          </InputGroup>
        </div>
      )}

      {/* Step 3: Certifications */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Registrations & certifications</h3>
            <p className="text-xs text-slate-500 mt-0.5">These print on cover pages of O&M packs. All fields are optional.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputGroup lbl="Companies House Reg" icon={Hash}>
              <input type="text" value={form.company_reg_number} onChange={f('company_reg_number')} className={ic} placeholder="12345678" />
            </InputGroup>
            <InputGroup lbl="VAT Number">
              <input type="text" value={form.vat_number} onChange={f('vat_number')} className={ic} placeholder="GB 123 4567 89" />
            </InputGroup>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputGroup lbl="NSI Number" icon={Award}>
              <input type="text" value={form.nsi_number} onChange={f('nsi_number')} className={ic} placeholder="NSI number" />
            </InputGroup>
            <InputGroup lbl="SSAIB Number" icon={Award}>
              <input type="text" value={form.ssaib_number} onChange={f('ssaib_number')} className={ic} placeholder="SSAIB number" />
            </InputGroup>
          </div>
          <InputGroup lbl="Other Certifications">
            <textarea value={form.other_certifications} onChange={f('other_certifications')} rows={2}
              className={`${ic} resize-none`} placeholder="CHAS, Safe Contractor, ISO 9001 — one per line" />
          </InputGroup>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center gap-3">
        {step > 1 && (
          <button type="button" onClick={() => setStep(s => (s - 1) as RegStep)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-slate-600 hover:text-slate-800 text-sm font-medium border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            <ArrowLeft className="w-4 h-4" />Back
          </button>
        )}
        <button type={step < 3 ? 'button' : 'submit'} onClick={step < 3 ? nextStep : undefined} disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors disabled:opacity-50 text-sm">
          {loading
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : step < 3
              ? <>{step === 2 ? 'Next: Certifications' : 'Next: Company Details'} <ArrowRight className="w-4 h-4" /></>
              : <>Complete Registration <Check className="w-4 h-4" /></>
          }
        </button>
      </div>

      {step === 1 && (
        <p className="text-center text-sm text-slate-500">
          Already registered?{' '}
          <button type="button" onClick={onSwitch} className="text-cyan-600 hover:text-cyan-700 font-semibold transition-colors">
            Sign in
          </button>
        </p>
      )}
    </form>
  );
}

// ─── Auth Page ─────────────────────────────────────────────────────────────────

export function AuthPage() {
  const [view, setView] = useState<View>('login');

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] bg-gradient-to-br from-slate-900 to-slate-950 border-r border-slate-800 p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/30">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-base leading-tight">SecureOps</p>
            <p className="text-slate-500 text-xs">Project Lifecycle Platform</p>
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-bold text-white leading-snug mb-4">
            Security project documentation,<br />
            <span className="text-cyan-400">done properly.</span>
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            From device schedules to O&M packs — manage every stage of the security installation lifecycle in one place.
          </p>

          <div className="space-y-4">
            {[
              { icon: '📋', text: 'AI-powered device extraction from drawings' },
              { icon: '📄', text: 'Auto-generated scope of works and O&M packs' },
              { icon: '✅', text: 'Commissioning records and handover certificates' },
              { icon: '🏗️', text: 'As-fitted drawings and technical documentation' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <span className="text-lg">{icon}</span>
                <span className="text-slate-300 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-slate-700 text-xs">
          © {new Date().getFullYear()} SecureOps. All rights reserved.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Mobile brand */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <p className="text-slate-900 font-bold">SecureOps</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            {/* Tab switcher */}
            <div className="flex bg-slate-100 rounded-xl p-1 mb-7">
              {(['login', 'register'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {v === 'login' ? 'Sign In' : 'Register'}
                </button>
              ))}
            </div>

            {view === 'login'
              ? <LoginForm onSwitch={() => setView('register')} />
              : <RegisterForm onSwitch={() => setView('login')} />
            }
          </div>
        </div>
      </div>
    </div>
  );
}
