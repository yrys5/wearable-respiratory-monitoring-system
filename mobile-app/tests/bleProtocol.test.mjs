import assert from "node:assert/strict";
import test from "node:test";

import {
  contiguousSequenceAfter,
  CONTROL_COMMAND,
  CONTROL_FLAG,
  controlCommandApplied,
  decodeBase64,
  decodeControlStatus,
  decodeDataPacket,
  encodeBase64,
  encodeControlCommand,
} from "../src/ble/protocol.ts";

test("DATA decodes signed ADC channels and unsigned metadata in little endian", () => {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, -123456, true);
  view.setInt32(4, 987654, true);
  view.setUint32(8, 0xffffffff, true);
  view.setUint32(12, 1234567890, true);
  view.setUint32(16, 0xabcdef12, true);
  assert.deepEqual(decodeDataPacket(encodeBase64(bytes)), {
    ch1: -123456,
    ch2: 987654,
    sequence: 0xffffffff,
    deviceTimestampMs: 1234567890,
    sessionId: 0xabcdef12,
  });
});

test("ACK advances only across a continuous stored prefix", () => {
  assert.equal(contiguousSequenceAfter(0, [1, 3, 4]), 1);
  assert.equal(contiguousSequenceAfter(1, [2, 3, 4]), 4);
  assert.equal(contiguousSequenceAfter(4, [4, 5, 7]), 5);
});

test("DATA rejects old and truncated packets", () => {
  assert.throws(
    () => decodeDataPacket(encodeBase64(new Uint8Array(8))),
    /20 bytes/,
  );
  assert.throws(
    () => decodeDataPacket(encodeBase64(new Uint8Array(20))),
    /invalid session or sequence/,
  );
  assert.throws(() => decodeDataPacket("abc"), /base64/);
});

test("CONTROL command is exactly nine little endian bytes", () => {
  const bytes = decodeBase64(
    encodeControlCommand(CONTROL_COMMAND.RESUME, 0x12345678, 0xabcdef01),
  );
  assert.deepEqual(
    Array.from(bytes),
    [4, 0x78, 0x56, 0x34, 0x12, 0x01, 0xef, 0xcd, 0xab],
  );
});

test("CONTROL status decodes a bitmask and reports logical command errors", () => {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  view.setUint8(
    1,
    CONTROL_FLAG.RECORDING | CONTROL_FLAG.ADC_GAP | CONTROL_FLAG.SUBSCRIBED,
  );
  view.setUint16(2, 256, true);
  view.setUint32(4, 0x12345678, true);
  view.setUint32(8, 1200, true);
  view.setUint32(12, 1198, true);
  view.setUint8(16, 4);
  view.setUint8(17, CONTROL_COMMAND.ACK);
  const status = decodeControlStatus(encodeBase64(bytes));
  assert.equal(status.flags & CONTROL_FLAG.ADC_GAP, CONTROL_FLAG.ADC_GAP);
  assert.equal(status.bufferedPackets, 256);
  assert.equal(status.generatedSequence, 1200);
  assert.equal(status.acknowledgedSequence, 1198);
  assert.equal(status.lastCommandError, 4);
  bytes[0] = 2;
  assert.throws(
    () => decodeControlStatus(encodeBase64(bytes)),
    /Unsupported CONTROL version/,
  );
});

test("CONTROL acceptance requires the expected session and command effect", () => {
  const status = {
    version: 1,
    flags: CONTROL_FLAG.RECORDING,
    bufferedPackets: 2,
    sessionId: 9,
    generatedSequence: 5,
    acknowledgedSequence: 3,
    lastCommandError: 0,
    lastCommandType: CONTROL_COMMAND.ACK,
  };
  assert.equal(controlCommandApplied(status, CONTROL_COMMAND.ACK, 9, 4), false);
  assert.equal(controlCommandApplied(status, CONTROL_COMMAND.ACK, 9, 3), true);
  assert.equal(
    controlCommandApplied(status, CONTROL_COMMAND.ACK, 10, 3),
    false,
  );
  status.lastCommandType = CONTROL_COMMAND.START;
  assert.equal(
    controlCommandApplied(status, CONTROL_COMMAND.START, 9, 0),
    true,
  );
  status.lastCommandType = CONTROL_COMMAND.STOP;
  assert.equal(
    controlCommandApplied(status, CONTROL_COMMAND.STOP, 9, 0),
    false,
  );
  status.flags = 0;
  assert.equal(controlCommandApplied(status, CONTROL_COMMAND.STOP, 9, 0), true);
  status.lastCommandError = 2;
  assert.equal(
    controlCommandApplied(status, CONTROL_COMMAND.STOP, 9, 0),
    false,
  );
});
