import assert from 'node:assert/strict';
import test from 'node:test';
import { zoomTimelineAtPointer, timelineTickStep } from './timelineZoom';

test('wheel zoom keeps the source time under the mouse at the same screen position', () => {
  const pointerX = 500, header = 216;
  const originalTime = (800 + pointerX - header) / 20;
  const enlarged = zoomTimelineAtPointer(20, 80, 800, pointerX, header);
  assert.equal((enlarged.scrollLeft + pointerX - header) / enlarged.zoom, originalTime);
  const restored = zoomTimelineAtPointer(enlarged.zoom, 20, enlarged.scrollLeft, pointerX, header);
  assert.deepEqual(restored, { zoom: 20, scrollLeft: 800 });
});

test('zoom respects minimum, maximum, and nonnegative scrolling', () => {
  assert.equal(zoomTimelineAtPointer(20, 10000, 0, 400, 216).zoom, 640);
  assert.deepEqual(zoomTimelineAtPointer(20, 0.1, 0, 400, 216), { zoom: 5, scrollLeft: 0 });
});

test('ruler labels become finer as the timeline is enlarged without overlapping', () => {
  assert.equal(timelineTickStep(20), 5);
  assert.equal(timelineTickStep(640), 0.2);
  assert.equal(timelineTickStep(5), 20);
  for (const zoom of [5, 20, 80, 640]) assert.ok(timelineTickStep(zoom) * zoom >= 70);
});
