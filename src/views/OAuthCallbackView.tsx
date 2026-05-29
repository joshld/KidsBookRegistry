import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/** Handles Google OAuth redirect in popup window */
export default function OAuthCallbackView() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (window.opener) {
      window.opener.postMessage(
        { type: 'kbr_oauth_code', code, state, error },
        window.location.origin,
      );
      window.close();
      return;
    }

    if (error) {
      navigate('/?oauth_error=' + encodeURIComponent(error));
      return;
    }
    navigate('/');
  }, [navigate]);

  return (
    <div className="min-h-svh flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <p className="text-sm text-slate-500">Completing sign-in…</p>
    </div>
  );
}
