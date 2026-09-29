// COOP severs window.opener for the isolated main app. BroadcastChannel keeps
// the one-time authorization result on this origin without storing the code.
export function requestGoogleCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(`google-auth-${crypto.randomUUID()}`);
    const finish = (code?: string, error?: string) => {
      clearTimeout(timeout);
      channel.close();
      if (code) resolve(code);
      else reject(new Error(error || 'Google connection failed'));
    };
    const timeout = setTimeout(() => finish(undefined, 'Google認証が完了しませんでした。もう一度接続してください。'), 180000);
    channel.onmessage = ({ data }) => {
      if (typeof data?.code === 'string' && data.code.length > 0 && data.code.length <= 4096) finish(data.code);
      else if (typeof data?.error === 'string') finish(undefined, 'Google認証を完了できませんでした。もう一度接続してください。');
    };
    // Do not poll popup.closed: COOP can mark the handle closed before OAuth ends.
    try {
      const popup = window.open(`/google-auth.html#${channel.name}`, '_blank', 'popup,width=540,height=700');
      if (!popup) finish(undefined, 'Google認証画面を開けませんでした。このサイトのポップアップを許可してください。');
    } catch {
      finish(undefined, 'Google認証画面を開けませんでした。');
    }
  });
}
