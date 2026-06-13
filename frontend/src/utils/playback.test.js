import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePlaybackElapsed,
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
