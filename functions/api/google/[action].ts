import { handleGoogleAuth } from '../../_lib/google-auth';

export const onRequest: PagesFunction<Env> = ({ request, env, params }) =>
  handleGoogleAuth(request, env, String(params.action));
