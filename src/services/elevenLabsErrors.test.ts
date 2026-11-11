import test from 'node:test';
import assert from 'node:assert/strict';
import { soundEffectProviderError, audioFailureDetails, audioFailureMessage } from './elevenLabsErrors';
import { logSafeError } from './serverSecurity';

test('provider failures retain safe categories and HTTP status without copying provider content', async () => {
  for (const [status, type, code, expectedStatus] of [
    [401, 'invalid_api_key', 'ELEVENLABS_AUTH', 502],
    [403, 'quota_exceeded', 'ELEVENLABS_QUOTA', 503],
    [429, 'too_many_concurrent_requests', 'ELEVENLABS_RATE_LIMIT', 429],
    [422, 'invalid_parameters', 'ELEVENLABS_INVALID_INPUT', 422],
    [400, 'content_policy', 'ELEVENLABS_POLICY', 422],
    [500, 'server_error', 'ELEVENLABS_UPSTREAM', 502],
  ] as const) {
    const error = await soundEffectProviderError(new Response(JSON.stringify({ detail: { status: type, message: 'private prompt secret-key' } }), { status }));
    assert.equal(error.code, code); assert.equal(error.status, expectedStatus); assert.equal(error.upstreamStatus, status);
    assert.doesNotMatch(error.message, /private prompt|secret-key/);
  }
  assert.equal((await soundEffectProviderError(new Response('<html>private</html>', { status: 502 }))).code, 'ELEVENLABS_UPSTREAM');
});

test('diagnostics preserve only validated identifiers, and logs omit raw error messages', () => {
  const requestId = '12345678-1234-1234-1234-123456789012';
  const error = Object.assign(new Error('secret-key private prompt'), { code: 'ELEVENLABS_QUOTA', status: 503, upstreamStatus: 403, requestId });
  assert.match(audioFailureMessage(error, 'fallback'), /额度不足/);
  assert.match(audioFailureMessage(error, 'fallback'), new RegExp(requestId));
  assert.equal(audioFailureDetails({ code: 'secret key', requestId: 'secret key', status: '503' }).code, undefined);
  const original = console.error;
  try {
    let line = ''; console.error = value => { line = String(value); };
    logSafeError('api.request.failed', error);
    assert.equal(JSON.parse(line).upstreamStatus, 403);
    assert.equal(JSON.parse(line).code, 'ELEVENLABS_QUOTA');
    assert.doesNotMatch(line, /secret-key|private prompt/);
  } finally { console.error = original; }
});
