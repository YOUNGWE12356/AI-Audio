import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSunoBpmRange } from './geminiService';

test('Suno prompt tempo stays near the recommended BPM without fixing one exact tempo', () => {
  assert.equal(formatSunoBpmRange('105'), '100-110 BPM');
  assert.equal(formatSunoBpmRange('80'), '75-85 BPM');
  assert.equal(formatSunoBpmRange('103'), '100-110 BPM');
});

test('Suno prompt tempo remains within the supported BPM limits', () => {
  assert.equal(formatSunoBpmRange('40'), '40-50 BPM');
  assert.equal(formatSunoBpmRange('220'), '210-220 BPM');
});
