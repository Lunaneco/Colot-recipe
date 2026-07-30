import assert from "node:assert/strict";
import test from "node:test";

import {
  appendStrokeSamples,
  beginStrokeSampling,
  finishStrokeSampling,
  stabilizeStrokePoint,
} from "../lib/strokeSampling.ts";

const point = (x, y, time, pressure) => ({ x, y, time, pressure });

function assertNear(actual, expected, tolerance = 1e-9, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function assertEquivalentPlacements(actual, expected, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assertNear(actual[index].x, expected[index].x, tolerance);
    assertNear(actual[index].y, expected[index].y, tolerance);
    assertNear(actual[index].time, expected[index].time, tolerance);
    assertNear(actual[index].pressure, expected[index].pressure, tolerance);
  }
}

test("sparse and dense event streams produce the same fixed-distance placements", () => {
  const options = { spacing: 10, scaleX: 100, scaleY: 100 };
  const origin = point(0.1, 0.2, 100, 0.2);
  const endpoint = point(0.9, 0.6, 180, 1);

  const sparse = appendStrokeSamples(
    beginStrokeSampling(origin),
    [endpoint],
    options,
  ).state;

  let dense = beginStrokeSampling(origin);
  for (let step = 1; step <= 16; step += 1) {
    const amount = step / 16;
    dense = appendStrokeSamples(
      dense,
      [
        point(
          origin.x + (endpoint.x - origin.x) * amount,
          origin.y + (endpoint.y - origin.y) * amount,
          origin.time + (endpoint.time - origin.time) * amount,
          origin.pressure + (endpoint.pressure - origin.pressure) * amount,
        ),
      ],
      options,
    ).state;
  }

  assertEquivalentPlacements(dense.placements, sparse.placements, 1e-8);
  assertNear(dense.carriedDistance, sparse.carriedDistance, 1e-8);
});

test("sampling keeps the exact first contact and finish covers the real endpoint", () => {
  const origin = point(0.25, 0.4, 12, 0.35);
  const endpoint = point(0.51, 0.4, 38, 0.8);
  const options = { spacing: 10, scaleX: 100, scaleY: 100 };

  const finished = finishStrokeSampling(
    beginStrokeSampling(origin),
    endpoint,
    options,
  ).state;

  assert.deepEqual(finished.placements[0], origin);
  assert.deepEqual(finished.placements.at(-1), endpoint);
  assert.equal(finished.carriedDistance, 0);
});

test("pressure is interpolated smoothly without changing placement geometry", () => {
  const options = { spacing: 10 };
  const start = point(0, 0, 0, 0.1);
  const end = point(40, 0, 80, 0.9);
  const placements = appendStrokeSamples(
    beginStrokeSampling(start),
    [end],
    options,
  ).state.placements;

  assert.deepEqual(
    placements.map(({ x }) => x),
    [0, 10, 20, 30, 40],
  );
  assert.deepEqual(
    placements.map(({ pressure }) => Number(pressure.toFixed(6))),
    [0.1, 0.3, 0.5, 0.7, 0.9],
  );
  for (let index = 1; index < placements.length; index += 1) {
    assert.ok(placements[index].pressure > placements[index - 1].pressure);
  }
});

test("time-based stabilization is comparable from raw pen input through 60 Hz", () => {
  function simulate(frameTime) {
    let stabilized = point(0, 0, 0, 0.5);
    for (let time = frameTime; time <= 96; time += frameTime) {
      stabilized = stabilizeStrokePoint(
        stabilized,
        point(time, 0, time, 0.75),
        0.7,
      );
    }
    return stabilized;
  }

  const at60Hz = simulate(16);
  const at120Hz = simulate(8);
  const rawPenRate = simulate(1);

  assert.ok(at60Hz.x > 90 && at60Hz.x < 96);
  assert.ok(at120Hz.x > 90 && at120Hz.x < 96);
  assert.ok(rawPenRate.x > 90 && rawPenRate.x < 96);
  assertNear(at60Hz.x, at120Hz.x, 2);
  assertNear(at60Hz.x, rawPenRate.x, 1.5);
  assert.equal(at60Hz.time, 96);
  assert.equal(at120Hz.time, 96);
  assert.equal(rawPenRate.time, 96);
  assert.equal(at60Hz.pressure, 0.75);
  assert.equal(at120Hz.pressure, 0.75);
  assert.equal(rawPenRate.pressure, 0.75);
});

test("the point cap is identical for sparse, dense, and finished strokes", () => {
  const options = { spacing: 10, maxPoints: 5 };
  const origin = point(0, 0, 0, 0.2);
  const endpoint = point(200, 0, 200, 0.9);

  const sparse = appendStrokeSamples(
    beginStrokeSampling(origin),
    [endpoint],
    options,
  ).state;

  let dense = beginStrokeSampling(origin);
  for (let x = 5; x <= endpoint.x; x += 5) {
    dense = appendStrokeSamples(
      dense,
      [point(x, 0, x, 0.2 + (0.7 * x) / endpoint.x)],
      options,
    ).state;
  }

  const sparseFinished = finishStrokeSampling(sparse, endpoint, options).state;
  const denseFinished = finishStrokeSampling(dense, endpoint, options).state;

  assert.equal(sparse.placements.length, options.maxPoints);
  assert.equal(dense.placements.length, options.maxPoints);
  assert.equal(sparseFinished.placements.length, options.maxPoints);
  assert.equal(denseFinished.placements.length, options.maxPoints);
  assert.deepEqual(sparse.lastInput, sparse.placements.at(-1));
  assert.deepEqual(dense.lastInput, dense.placements.at(-1));
  assertEquivalentPlacements(
    denseFinished.placements,
    sparseFinished.placements,
    1e-9,
  );
});

test("a capped batch returns its unconsumed path so streaming callers lose no distance", () => {
  const options = { spacing: 10, maxPoints: 5 };
  const origin = point(0, 0, 0, 0.2);
  const endpoint = point(200, 0, 200, 0.9);
  const expected = appendStrokeSamples(
    beginStrokeSampling(origin),
    [endpoint],
    { spacing: 10, maxPoints: 100 },
  ).state.placements;

  let state = beginStrokeSampling(origin);
  let remaining = [endpoint];
  const streamed = [origin];
  while (remaining.length > 0) {
    const sampled = appendStrokeSamples(state, remaining, options);
    streamed.push(...sampled.added);
    const latest = sampled.state.placements.at(-1);
    state = {
      ...sampled.state,
      placements: [latest],
    };
    remaining = sampled.remainingInput;
  }

  assertEquivalentPlacements(streamed, expected, 1e-9);
  assert.deepEqual(state.lastInput, endpoint);
});
