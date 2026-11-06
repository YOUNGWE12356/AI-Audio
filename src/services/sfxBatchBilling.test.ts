import assert from 'node:assert/strict';
import test from 'node:test';
import { batchQuerySource, createBatchSfxRequest } from './sfxBatch';
import { BATCH_SFX_USAGE_FEATURES, estimateBatchSfxCost, needsBatchSearchQuery, resolveBatchSfxUsageFeature } from './sfxBatchBilling';
import { COMPANY_POINTS, estimateTimedCompanyPoints } from './elevenLabsService';
import { summarizeUsageUsers, type StoredAiUsageEvent } from './usageAggregation';

const row = { duration: 5, keywords: '开门', description: '木门缓慢打开', searchQuery: 'door creak' };
const prepared = { ...row, searchQuerySource: batchQuerySource(row) };

test('batch estimates sum only supplied rows and agree with the actual sound-effect rate', () => {
  const rows = [prepared, { ...prepared, duration: 2.5 }];
  const cost = estimateBatchSfxCost(rows);
  assert.equal(cost.generationPoints, 15);
  assert.equal(cost.seconds, 7.5);
  assert.equal(cost.generationPoints, rows.reduce((sum, item) => sum + estimateTimedCompanyPoints(item.duration, COMPANY_POINTS.soundEffectPerSecond), 0));
  assert.equal(estimateBatchSfxCost(rows.slice(1)).generationPoints, 5);
  assert.equal(estimateBatchSfxCost([{ ...prepared, duration: 0.5 }, { ...prepared, duration: 30 }]).generationPoints, 61);
  assert.equal(estimateBatchSfxCost([]).generationPoints, null);
  for (const duration of [NaN, Infinity, 0, -1, 0.49, 30.01]) {
    const invalid = estimateBatchSfxCost([prepared, { ...prepared, duration }]);
    assert.equal(invalid.generationPoints, null); assert.equal(invalid.invalidDurations, 1);
  }
});

test('conversion disclosure counts uncached, changed and invalid queries exactly like the client', () => {
  assert.equal(needsBatchSearchQuery(prepared), false);
  assert.equal(needsBatchSearchQuery(row), true);
  assert.equal(needsBatchSearchQuery({ ...prepared, keywords: '关门' }), true);
  assert.equal(needsBatchSearchQuery({ ...prepared, description: '金属门关闭' }), true);
  assert.equal(needsBatchSearchQuery({ ...prepared, searchQuery: '中文' }), true);
  assert.equal(estimateBatchSfxCost([prepared, row, { ...prepared, keywords: '关门' }]).queryConversions, 2);
});

test('new batch generation carries its source while legacy generic generations retain their attribution', () => {
  const request = createBatchSfxRequest(prepared, 'generate');
  assert.equal(resolveBatchSfxUsageFeature(request.endpoint, request.body), BATCH_SFX_USAGE_FEATURES.generation);
  assert.equal(resolveBatchSfxUsageFeature(request.endpoint), undefined);
  assert.equal(resolveBatchSfxUsageFeature(request.endpoint, { usageSource: 'unrecognized' }), undefined);
  assert.equal(resolveBatchSfxUsageFeature('/api/video/generate-clip', request.body), undefined);
  assert.equal(resolveBatchSfxUsageFeature('/api/ai/sfx-batch/analyze'), BATCH_SFX_USAGE_FEATURES.analysis);
  assert.equal(resolveBatchSfxUsageFeature('/api/ai/sfx-batch/analyze/jobs/123'), BATCH_SFX_USAGE_FEATURES.analysis);
  assert.equal(resolveBatchSfxUsageFeature('/api/ai/sfx-batch/search-query'), BATCH_SFX_USAGE_FEATURES.query);
  assert.equal(resolveBatchSfxUsageFeature('/api/ai/sfx-batch/search'), BATCH_SFX_USAGE_FEATURES.search);
  assert.equal(resolveBatchSfxUsageFeature('/api/ai/sfx-batch/capture'), undefined);
});

test('user usage separates all four batch activities without changing points or tokens', () => {
  const endpoints = ['/api/ai/sfx-batch/analyze', '/api/ai/sfx-batch/search-query', '/api/ai/sfx-batch/search', '/api/ai/elevenlabs/sound-effect'];
  const events: StoredAiUsageEvent[] = endpoints.map((endpoint, index) => ({
    feature: resolveBatchSfxUsageFeature(endpoint, { usageSource: 'sfx-batch' })!, endpoint,
    provider: index < 2 ? 'gpt' : index === 2 ? 'network' : 'elevenlabs', model: 'test',
    inputTokens: index < 2 ? 100 : 0, outputTokens: index < 2 ? 10 : 0,
    totalTokens: index < 2 ? 110 : 0, reasoningTokens: 0, credits: 0,
    companyPoints: [4, 2, 1, 10][index], timestamp: '2026-11-06T00:00:00Z',
    userId: 'alice', displayName: 'Alice', identitySource: 'device', department: '', ipAddress: '',
  }));
  const users = summarizeUsageUsers([...events, { ...events[3], userId: 'bob', displayName: 'Bob' }]);
  const alice = users.find(user => user.userId === 'alice')!;
  assert.equal(alice.details.length, 4); assert.equal(alice.companyPoints, 17); assert.equal(alice.totalTokens, 220);
  assert.deepEqual(new Set(alice.details.map(detail => detail.feature)), new Set(Object.values(BATCH_SFX_USAGE_FEATURES)));
  assert.equal(users.find(user => user.userId === 'bob')!.companyPoints, 10);
});
