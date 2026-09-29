import type { CodeResponse, NonOAuthError } from '@react-oauth/google';
import { connectGoogle } from '@api/google-auth';
import useCloudAuthStore from '@store/cloud-auth-store';

type GoogleCodeClient = { requestCode(): void };
const status = document.getElementById('status')!;
const button = document.getElementById('connect') as HTMLButtonElement;
const started = Number(sessionStorage.getItem('google-auth-started'));
const back = document.getElementById('back') as HTMLAnchorElement;
back.onclick = () => {
  sessionStorage.removeItem('google-auth-started');
  useCloudAuthStore.getState().setSyncStatus('unauthenticated');
};

if (!Number.isFinite(started) || started <= 0 || Date.now() - started > 600000 || started > Date.now()) {
  status.textContent = '本体の同期設定から接続を開始してください。';
} else {
  let connecting = false;
  const fail = (message: string) => {
    connecting = false;
    button.disabled = false;
    back.hidden = false;
    status.textContent = message;
  };
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.onload = () => {
    const google = (window as unknown as { google: { accounts: { oauth2: { initCodeClient(config: object): GoogleCodeClient } } } }).google;
    const client = google.accounts.oauth2.initCodeClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: 'openid https://www.googleapis.com/auth/drive.file',
      callback: async (response: CodeResponse) => {
        if (connecting) return;
        if (response.error) { fail('Google認証を完了できませんでした。もう一度お試しください。'); return; }
        connecting = true;
        back.hidden = true;
        status.textContent = 'Google Drive に接続しています。';
        try {
          const token = await connectGoogle(response.code);
          const state = useCloudAuthStore.getState();
          state.setProvider('google');
          state.setGoogleAccessToken(token);
          state.setCloudSync(true);
          state.setSyncStatus('synced');
          sessionStorage.removeItem('google-auth-started');
          location.replace('/?google-sync=return');
        } catch (error) { fail((error as Error).message); }
      },
      error_callback: (error: NonOAuthError) => fail(error.type === 'popup_failed_to_open'
        ? 'Google認証画面を開けませんでした。このサイトのポップアップを許可してください。'
        : 'Google認証が中断されました。もう一度お試しください。'),
    });
    button.disabled = false;
    status.textContent = '「Google で続行」を押してください。認証が完了すると、このタブの同期設定に戻ります。';
    button.onclick = () => { button.disabled = true; client.requestCode(); };
  };
  script.onerror = () => { status.textContent = 'Google認証を読み込めませんでした。同期設定に戻って、もう一度お試しください。'; };
  document.head.append(script);
}
