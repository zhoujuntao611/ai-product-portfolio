import test from 'node:test';
import assert from 'node:assert/strict';
import { invocationIdentity } from '../cloudfunctions/panji/identity';

test('微信身份来自本次平台上下文，维护调用不会沿用上个用户', () => {
  const old = process.env.WX_OPENID;
  try {
    process.env.WX_OPENID = 'previous-caller';
    assert.deepEqual(invocationIdentity({ environment: { WX_OPENID: 'current-caller', WX_APPID: 'wx-test' } }), { OPENID: 'current-caller', APPID: 'wx-test' });
    assert.deepEqual(invocationIdentity({ environment: {} }), { OPENID: undefined, APPID: undefined });
    assert.deepEqual(invocationIdentity({ environ: { WX_OPENID: 'legacy-caller' } }), { OPENID: 'legacy-caller', APPID: undefined });
    assert.deepEqual(invocationIdentity({ environment: {}, environ: { WX_OPENID: 'stale-legacy' } }), { OPENID: undefined, APPID: undefined });
  } finally { if (old === undefined) delete process.env.WX_OPENID; else process.env.WX_OPENID = old; }
});
