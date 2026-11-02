export const DEFAULT_TIMELINE_ZOOM = 20;
export const MIN_TIMELINE_ZOOM = 5;
export const MAX_TIMELINE_ZOOM = 640;

export function zoomTimelineAtPointer(zoom: number, nextZoom: number, scrollLeft: number, pointerX: number, headerWidth: number) {
  const scale = Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, nextZoom));
  const time = Math.max(0, (scrollLeft + pointerX - headerWidth) / zoom);
  return { zoom: scale, scrollLeft: Math.max(0, time * scale + headerWidth - pointerX) };
}

export function timelineTickStep(zoom: number) {
  const minimumStep = 70 / zoom;
  const magnitude = 10 ** Math.floor(Math.log10(minimumStep));
  return [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= minimumStep)!;
}
