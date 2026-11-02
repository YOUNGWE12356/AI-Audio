import assert from 'node:assert/strict';
import test from 'node:test';
import { loopPlayhead, scheduleLoopPasses } from './workstationLoop';

test('loop passes are scheduled ahead at exact audio-clock boundaries without drift', () => {
  const passes: number[][] = [];
  const schedule = (playhead: number, at: number) => { passes.push([playhead, at]); };
  let next = scheduleLoopPasses(10, 10.2, 0.7, schedule);
  assert.deepEqual(passes, [[0, 10.2]]);
  next = scheduleLoopPasses(10.5, next, 0.7, schedule);
  next = scheduleLoopPasses(11.2, next, 0.7, schedule);
  assert.ok(Math.abs(passes[1][1] - 10.9) < 1e-10);
  assert.ok(Math.abs(passes[2][1] - 11.6) < 1e-10);
  assert.ok(Math.abs(next - 12.3) < 1e-10);
});

test('delayed timers resume the current phase rather than accumulating missed passes', () => {
  const passes: number[][] = [];
  const next = scheduleLoopPasses(20.3, 11, 2, (head, at) => { passes.push([head, at]); });
  assert.ok(Math.abs(passes[0][0] - 1.3) < 1e-10);
  assert.equal(passes[0][1], 20.3);
  assert.equal(next, 21);
  assert.equal(loopPlayhead(20.3 - 11, 2), passes[0][0]);
  assert.equal(loopPlayhead(16, 8), 0);
  assert.equal(loopPlayhead(8.25, 8), 0.25);
  assert.equal(loopPlayhead(5, 0), 0);
  assert.equal(scheduleLoopPasses(10, 11, 0, () => assert.fail()), 11);
});

test('short effects schedule bounded passes and do not include minimum timeline padding', () => {
  const passes: number[][] = [];
  const next = scheduleLoopPasses(0, 0.1, 0.1, (head, at) => { passes.push([head, at]); });
  assert.deepEqual(passes, [[0, 0.1], [0, 0.2]]);
  assert.ok(Math.abs(next - 0.3) < 1e-10);
});
