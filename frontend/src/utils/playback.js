/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {number} baseElapsedMs
 * @param {number | null} startedAtMs
 * @param {number} nowMs
 * @param {number} durationMs
 * @returns {number}
 */
export function computePlaybackElapsed(baseElapsedMs, startedAtMs, nowMs, durationMs) {
  if (startedAtMs === null) {
    return clamp(baseElapsedMs, 0, durationMs);
  }

  const deltaMs = Math.max(0, nowMs - startedAtMs);
  return clamp(baseElapsedMs + deltaMs, 0, durationMs);
}

/**
 * @param {number} currentElapsedMs
 * @returns {{ baseElapsedMs: number, startedAtMs: null }}
 */
export function pausePlaybackAt(currentElapsedMs) {
  return {
    baseElapsedMs: Math.max(0, currentElapsedMs),
    startedAtMs: null,
  };
}

/**
 * @param {number} currentElapsedMs
 * @param {number} nowMs
 * @returns {{ baseElapsedMs: number, startedAtMs: number }}
 */
export function resumePlaybackAt(currentElapsedMs, nowMs) {
  return {
    baseElapsedMs: Math.max(0, currentElapsedMs),
    startedAtMs: nowMs,
  };
}

/**
 * @param {number} nowMs
 * @returns {{ baseElapsedMs: number, startedAtMs: number }}
 */
export function restartPlaybackAt(nowMs) {
  return {
    baseElapsedMs: 0,
    startedAtMs: nowMs,
  };
}

/**
 * @param {{ startMs: number, durationMs: number, opacityFrom: number, opacityTo: number, transition?: string }} step
 * @param {number} elapsedMs
 * @param {boolean} isLastStep
 * @returns {number}
 */
export function computeStepOpacity(step, elapsedMs, isLastStep = false) {
  if (step.transition === 'replace-frame') {
    const endMs = step.startMs + step.durationMs;
    const isActive = elapsedMs >= step.startMs && (elapsedMs < endMs || (isLastStep && elapsedMs >= endMs));
    if (!isActive) {
      return 0;
    }

    const fadeMs = Math.max(120, Math.min(260, step.durationMs * 0.35));
    const fadeProgress = clamp((elapsedMs - step.startMs) / fadeMs, 0, 1);
    const easedProgress = 1 - Math.pow(1 - fadeProgress, 2);
    return step.opacityFrom + (step.opacityTo - step.opacityFrom) * easedProgress;
  }

  if (elapsedMs <= step.startMs) {
    return step.opacityFrom;
  }
  if (elapsedMs >= step.startMs + step.durationMs) {
    return step.opacityTo;
  }

  const progress = (elapsedMs - step.startMs) / step.durationMs;
  const easedProgress = 1 - Math.pow(1 - clamp(progress, 0, 1), 2);
  return step.opacityFrom + (step.opacityTo - step.opacityFrom) * easedProgress;
}
