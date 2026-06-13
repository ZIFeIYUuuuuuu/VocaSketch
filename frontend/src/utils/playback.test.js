import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePlaybackElapsed,
  computeStepOpacity,
  pausePlaybackAt,
  restartPlaybackAt,
  resumePlaybackAt,
} from './playback.js';

test('computePlaybackElapsed uses stable base + delta timing', () => {
  const first = computePlaybackElapsed(1200, 100, 250, 5000);
  const second = computePlaybackElapsed(1200, 100, 400, 5000);

  assert.equal(first, 1350);
  assert.equal(second, 1500);
});

test('computePlaybackElapsed clamps to duration', () => {
  assert.equal(computePlaybackElapsed(4900, 100, 500, 5000), 5000);
});

test('pausePlaybackAt freezes current elapsed as new base', () => {
  assert.deepEqual(pausePlaybackAt(1825), {
    baseElapsedMs: 1825,
    startedAtMs: null,
  });
});

test('resumePlaybackAt restarts the clock from current elapsed', () => {
  assert.deepEqual(resumePlaybackAt(1825, 800), {
    baseElapsedMs: 1825,
    startedAtMs: 800,
  });
});

test('restartPlaybackAt resets elapsed to zero', () => {
  assert.deepEqual(restartPlaybackAt(1200), {
    baseElapsedMs: 0,
    startedAtMs: 1200,
  });
});

test('computeStepOpacity replaces frame after its time window', () => {
  const step = {
    startMs: 1000,
    durationMs: 800,
    opacityFrom: 0,
    opacityTo: 1,
    transition: 'replace-frame',
  };

  assert.equal(computeStepOpacity(step, 900), 0);
  assert.ok(computeStepOpacity(step, 1120) > 0);
  assert.equal(computeStepOpacity(step, 1800), 0);
});

test('computeStepOpacity keeps last replace-frame visible after completion', () => {
  const step = {
    startMs: 4000,
    durationMs: 900,
    opacityFrom: 0,
    opacityTo: 1,
    transition: 'replace-frame',
  };

  assert.equal(computeStepOpacity(step, 5000, true), 1);
});
