import type { CodeResponse, NonOAuthError } from '@react-oauth/google';

type GoogleCodeClient = { requestCode(): void };
const status = document.getElementById('status')!;
const button = document.getElementById('connect') as HTMLButtonElement;
const channelName = location.hash.slice(1);
history.replaceState(null, '', location.pathname);

if (!/^google-auth-[0-9a-f-]{36}$/.test(channelName)) {
  status.textContent = '元の画面の「Google Drive と同期する」から接続してください。';
} else {
  const channel = new BroadcastChannel(channelName);
  let completed = false;
  const finish = (message: { code: string } | { error: string }) => {
    if (completed) return;
    completed = true;
    channel.postMessage(message);
    channel.close();
    button.disabled = true;
    status.textContent = '元の画面で接続結果を確認してください。この画面は閉じられます。';
    window.close();
  };
  window.addEventListener('pagehide', () => finish({ error: 'closed' }));
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.onload = () => {
    const google = (window as unknown as { google: { accounts: { oauth2: { initCodeClient(config: object): GoogleCodeClient } } } }).google;
    const client = google.accounts.oauth2.initCodeClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: 'openid https://www.googleapis.com/auth/drive.file',
      callback: (response: CodeResponse) => finish(response.error ? { error: response.error } : { code: response.code }),
      error_callback: (error: NonOAuthError) => {
        if (error.type === 'popup_failed_to_open') {
          button.disabled = false;
          status.textContent = '「Google で続行」を押して認証してください。';
        } else finish({ error: error.type });
      },
    });
    button.disabled = false;
    status.textContent = '「Google で続行」を押して認証してください。完了後は元の画面に戻ります。';
    button.onclick = () => { button.disabled = true; client.requestCode(); };
  };
  script.onerror = () => finish({ error: 'script_load_failed' });
  document.head.append(script);
}
