import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialSignalProcessorState,
  processStrainGaugeSample,
} from "../src/services/breathSignalProcessor.ts";
import {
  measurementRemainingMs,
  scheduleMeasurementStop,
  validateMeasurementDuration,
} from "../src/services/measurementTiming.ts";
import {
  buildNormalizedChannelPoints,
  normalizeChannel,
} from "../src/services/normalizedChart.ts";
import {
  buildStoredPacketsCsv,
  writeStoredPacketsCsv,
} from "../src/services/storedPacketCsv.ts";

const session = {
  deviceId: "sensor",
  sessionId: 42,
  startedAt: 1000,
  durationMs: 10000,
};

test("normalization removes offsets and amplitude differences without changing input", () => {
  const channel1 = [1000, 1100, 1200, 1100, 1000];
  const channel2 = [-20, -10, 0, -10, -20];
  assert.deepEqual(normalizeChannel(channel1), [-1, 0, 1, 0, -1]);
  assert.deepEqual(normalizeChannel(channel2), [-1, 0, 1, 0, -1]);
  assert.deepEqual(channel1, [1000, 1100, 1200, 1100, 1000]);
});

test("empty, constant and single-sample channels have a finite neutral value", () => {
  assert.deepEqual(normalizeChannel([]), []);
  assert.deepEqual(normalizeChannel([500]), [0]);
  assert.deepEqual(normalizeChannel([500, 500, 500]), [0, 0, 0]);
  assert.deepEqual(buildNormalizedChannelPoints([500], 320, 180, 12, 0), [
    { x: 308, y: 45 },
  ]);
});

test("normalized channels occupy disjoint vertical lanes with aligned sample times", () => {
  const top = buildNormalizedChannelPoints([0, 5, 10], 320, 180, 12, 0);
  const bottom = buildNormalizedChannelPoints([0, 5, 10], 320, 180, 12, 1);
  assert.deepEqual(
    top.map((point) => point.x),
    bottom.map((point) => point.x),
  );
  assert.ok(
    Math.max(...top.map((point) => point.y)) <
      Math.min(...bottom.map((point) => point.y)),
  );
  assert.ok(top.every((point) => point.y >= 12 && point.y < 90));
  assert.ok(bottom.every((point) => point.y > 90 && point.y <= 168));
});

test("continuous measurement creates no automatic-stop timer", (t) => {
  const timer = t.mock.method(globalThis, "setTimeout");
  const continuous = { ...session, durationMs: null };
  const cancel = scheduleMeasurementStop(
    continuous,
    async () => assert.fail("Unexpected STOP"),
    assert.fail,
  );
  assert.equal(timer.mock.callCount(), 0);
  assert.equal(
    measurementRemainingMs(continuous, Number.MAX_SAFE_INTEGER),
    null,
  );
  cancel();
});

test("timed session stops once at its original deadline after reconnect", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 4000 });
  let stops = 0;
  const cancel = scheduleMeasurementStop(
    session,
    async () => {
      stops++;
    },
    assert.fail,
  );
  assert.equal(measurementRemainingMs(session, Date.now()), 7000);
  t.mock.timers.tick(6999);
  assert.equal(stops, 0);
  t.mock.timers.tick(1);
  assert.equal(stops, 1);
  t.mock.timers.tick(10000);
  assert.equal(stops, 1);
  cancel();
});

test("manual stop or disconnect cancels the scheduled automatic stop", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let stops = 0;
  const cancel = scheduleMeasurementStop(
    session,
    async () => {
      stops++;
    },
    assert.fail,
  );
  cancel();
  t.mock.timers.tick(20000);
  assert.equal(stops, 0);
});

test("overdue session stops immediately when its timer is restored", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 12000 });
  let stops = 0;
  scheduleMeasurementStop(
    session,
    async () => {
      stops++;
    },
    assert.fail,
  );
  t.mock.timers.tick(0);
  assert.equal(stops, 1);
});

test("automatic-stop failure is reported to the caller", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 12000 });
  const failure = new Error("STOP rejected");
  let reported;
  scheduleMeasurementStop(
    session,
    async () => {
      throw failure;
    },
    (error) => {
      reported = error;
    },
  );
  t.mock.timers.tick(0);
  await Promise.resolve();
  assert.equal(reported, failure);
});

test("unlimited is explicit and invalid timed durations are rejected", () => {
  validateMeasurementDuration(null);
  validateMeasurementDuration(10000);
  for (const invalid of [undefined, 0, -1, NaN, Infinity]) {
    assert.throws(
      () => validateMeasurementDuration(invalid),
      /Invalid measurement duration/,
    );
  }
});

function packet(sequence, overrides = {}) {
  return {
    sessionId: 42,
    sequence,
    deviceTimestampMs: sequence * 100,
    receivedAt: 1700000000000 + sequence * 100,
    ch1: 1000 + (sequence % 100),
    ch2: 2000 + (sequence % 80),
    ...overrides,
  };
}

test("CSV preserves filter state, rejected raw samples and completeness across batches", async () => {
  const packets = [
    packet(1),
    packet(2),
    packet(3, { ch1: 99999 }),
    packet(4),
    packet(5),
  ];
  const status = { complete: false, generatedSequence: 5 };
  const chunks = [];
  async function* batches() {
    yield packets.slice(0, 2);
    yield [];
    yield packets.slice(2, 3);
    yield packets.slice(3);
  }
  const count = await writeStoredPacketsCsv(
    batches(),
    (chunk) => {
      chunks.push(chunk);
    },
    status,
  );
  const csv = chunks.join("");
  assert.equal(count, 5);
  assert.equal(csv, buildStoredPacketsCsv(packets, status));
  const rows = csv
    .split("\n")
    .slice(1)
    .map((row) => row.split(","));
  assert.ok(rows.every((row) => row[5] === "0" && row[6] === "5"));
  assert.equal(rows[2][7], "99999");
  assert.equal(rows[2][9], "0");
  assert.equal(rows[2][12], "");
  assert.equal(rows[3][9], "1");
  assert.ok(Number(rows[3][12]) > Number(rows[1][12]));
});

test("long sessions export every packet in bounded chunks, beyond the live chart buffer", async () => {
  const total = 10000;
  let exportedRows = 0;
  let largestChunk = 0;
  async function* batches() {
    for (let after = 0; after < total; after += 256) {
      yield Array.from({ length: Math.min(256, total - after) }, (_, index) =>
        packet(after + index + 1),
      );
    }
  }
  const count = await writeStoredPacketsCsv(batches(), (chunk) => {
    const lines = chunk.split("\n");
    if (chunk.startsWith("\n")) exportedRows += lines.length - 1;
    largestChunk = Math.max(largestChunk, lines.length - 1);
  });
  assert.equal(count, total);
  assert.equal(exportedRows, total);
  assert.ok(largestChunk <= 256);
});

test("signal history stays bounded during a continuous measurement", () => {
  let state = createInitialSignalProcessorState();
  for (let sequence = 1; sequence <= 1500; sequence++) {
    const sample = packet(sequence);
    state = processStrainGaugeSample(state, {
      rawValue: "",
      numericValue: sample.ch1,
      secondaryValue: sample.ch2,
      channelValues: { ch1: sample.ch1, ch2: sample.ch2 },
      timestamp: sample.receivedAt,
      deviceTimestampMs: sample.deviceTimestampMs,
      sequence,
      sessionId: sample.sessionId,
      parseError: null,
    });
  }
  assert.equal(state.acceptedSampleCount, 1500);
  assert.equal(state.samples.length, 600);
  assert.equal(state.samples.at(-1).sequence, 1500);
});
