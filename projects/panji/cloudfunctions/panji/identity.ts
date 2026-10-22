// Only the platform-provided invocation context may supply a WeChat identity.
// Process environment variables can retain a previous caller in a warm instance.
export function invocationIdentity(parsed: { environment?: Record<string, unknown>; environ?: Record<string, unknown> }): { OPENID?: string; APPID?: string } {
  const values = parsed.environment || parsed.environ || {};
  const OPENID = typeof values.WX_OPENID === 'string' && values.WX_OPENID ? values.WX_OPENID : undefined;
  const APPID = typeof values.WX_APPID === 'string' && values.WX_APPID ? values.WX_APPID : undefined;
  return { OPENID, APPID };
}
