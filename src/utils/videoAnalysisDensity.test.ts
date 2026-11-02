import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETAILED_SFX_MAX_FRAMES,
  getDetailedSfxClipLimit,
  getDetailedSfxFrameCount,
} from './videoAnalysisDensity';

test('detailed SFX analysis scales frame density with video duration', () => {
  assert.equal(getDetailedSfxFrameCount(5), 8);
  assert.equal(getDetailedSfxFrameCount(33.27), 23);
  assert.equal(getDetailedSfxFrameCount(45), 30);
  assert.equal(getDetailedSfxFrameCount(300), DETAILED_SFX_MAX_FRAMES);
});

test('SFX clip limit follows the same bounded detail budget', () => {
  assert.equal(getDetailedSfxClipLimit(33.27), 23);
  assert.equal(getDetailedSfxClipLimit(600), DETAILED_SFX_MAX_FRAMES);
});
