import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthPage } from './AuthPage';
import { supabase } from '../lib/supabase';
import { defaultHomePath, roleLabel } from '../lib/appRoles';
import { claimAppUserInvite, previewAppUserInvite, type AppUserInvitePreview } from '../lib/appUserInvites';

export function UserInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<AppUserInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const nextPreview = await previewAppUserInvite(token);
        if (cancelled) return;
        setPreview(nextPreview);

        const { data: { session } } = await supabase.auth.getSession();
        const email = session?.user.email ?? null;
        setSignedInEmail(email);

        if (session) {
          const claimed = await claimAppUserInvite(token);
          if (!cancelled) navigate(defaultHomePath(claimed.role), { replace: true });
          return;
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'This invite is not valid.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session || !token) return;
      claimAppUserInvite(token)
        .then(claimed => navigate(defaultHomePath(claimed.role), { replace: true }))
        .catch(e => setError(e instanceof Error ? e.message : 'Invite could not be accepted.'));
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [token, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Opening invite…
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="max-w-md text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</p>
      </div>
    );
  }

  if (signedInEmail && preview && signedInEmail.toLowerCase() !== preview.email.toLowerCase()) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="max-w-md text-sm text-amber-900 bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl">
          This invite is for {preview.email}. Sign out, then open the link again and sign in with that email.
        </p>
      </div>
    );
  }

  return (
    <AuthPage
      inviteEmail={preview?.email}
      inviteRoleLabel={preview ? roleLabel(preview.role) : undefined}
      inviteError={error}
      inviteToken={token}
      inviteKind="user"
    />
  );
}
