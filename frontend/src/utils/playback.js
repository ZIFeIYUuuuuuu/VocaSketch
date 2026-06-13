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
