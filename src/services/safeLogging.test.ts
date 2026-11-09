import test from 'node:test';
import assert from 'node:assert/strict';
import { logStartupError } from './safeLogging';

test('startup diagnostics preserve the error and stack while redacting credentials', () => {
  const original = console.error;
  const lines: string[] = [];
  try {
    console.error = message => lines.push(String(message));
    logStartupError(new Error('APP_ORIGIN invalid; secret-value at https://user:pass@example.test'), {
      FEISHU_APP_SECRET: 'secret-value',
    });
    const logged = JSON.parse(lines[0]);
    assert.equal(logged.event, 'server.startup.failed');
    assert.match(logged.message, /APP_ORIGIN invalid/);
    assert.match(logged.stack, /safeLogging.test.ts/);
    assert.doesNotMatch(lines[0], /secret-value|user:pass/);
    assert.match(logged.message, /\[REDACTED\]/);
  } finally {
    console.error = original;
  }
});

test('startup diagnostics also report non-Error failures', () => {
  const original = console.error;
  try {
    let line = '';
    console.error = message => { line = String(message); };
    logStartupError('configuration failed', {});
    assert.equal(JSON.parse(line).message, 'configuration failed');
  } finally {
    console.error = original;
  }
});
