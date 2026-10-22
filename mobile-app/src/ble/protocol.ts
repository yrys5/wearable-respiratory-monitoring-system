export const DATA_PACKET_LENGTH = 20;
export const CONTROL_COMMAND_LENGTH = 9;
export const CONTROL_STATUS_LENGTH = 20;

export const CONTROL_COMMAND = {
  ACK: 1,
  START: 2,
  STOP: 3,
  RESUME: 4,
} as const;

export const CONTROL_FLAG = {
  RECORDING: 1,
  OVERFLOW: 2,
  ADC_GAP: 4,
  SEQUENCE_EXHAUSTED: 8,
  TRANSMISSION_RESUMED: 16,
  CONNECTED: 32,
  SUBSCRIBED: 64,
} as const;

const CONTROL_ERRORS: Record<number, string> = {
  0: "OK",
  1: "invalid command format or parameters",
  2: "session busy",
  3: "different or missing session",
  4: "ACK exceeds sent sequence",
  5: "requested data already acknowledged and released",
  6: "connection or DATA subscription not ready",
};

export function controlErrorLabel(code: number) {
  return CONTROL_ERRORS[code] ?? `unknown error ${code}`;
}

export type DataPacket = {
  ch1: number;
  ch2: number;
  sequence: number;
  deviceTimestampMs: number;
  sessionId: number;
};

export type ControlStatus = {
  version: number;
  flags: number;
  bufferedPackets: number;
  sessionId: number;
  generatedSequence: number;
  acknowledgedSequence: number;
  lastCommandError: number;
  lastCommandType: number;
};

export function controlCommandApplied(
  status: ControlStatus,
  type: number,
  sessionId: number,
  sequence: number,
) {
  if (
    status.lastCommandType !== type ||
    status.lastCommandError !== 0 ||
    status.sessionId !== sessionId
  ) {
    return false;
  }
  switch (type) {
    case CONTROL_COMMAND.ACK:
      return status.acknowledgedSequence >= sequence;
    case CONTROL_COMMAND.START:
      return (status.flags & CONTROL_FLAG.RECORDING) !== 0;
    case CONTROL_COMMAND.STOP:
      return (status.flags & CONTROL_FLAG.RECORDING) === 0;
    case CONTROL_COMMAND.RESUME:
      return true;
    default:
      return false;
  }
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function decodeBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error("Invalid BLE base64 payload.");
  }

  const result: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const chunk = value.slice(index, index + 4);
    const packed =
      (ALPHABET.indexOf(chunk[0]) << 18) |
      (ALPHABET.indexOf(chunk[1]) << 12) |
      ((chunk[2] === "=" ? 0 : ALPHABET.indexOf(chunk[2])) << 6) |
      (chunk[3] === "=" ? 0 : ALPHABET.indexOf(chunk[3]));
    result.push((packed >>> 16) & 255);
    if (chunk[2] !== "=") result.push((packed >>> 8) & 255);
    if (chunk[3] !== "=") result.push(packed & 255);
  }
  return Uint8Array.from(result);
}

export function encodeBase64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const packed =
      (bytes[index] << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    value += ALPHABET[(packed >>> 18) & 63] + ALPHABET[(packed >>> 12) & 63];
    value += index + 1 < bytes.length ? ALPHABET[(packed >>> 6) & 63] : "=";
    value += index + 2 < bytes.length ? ALPHABET[packed & 63] : "=";
  }
  return value;
}

export function decodeDataPacket(value: string): DataPacket {
  const bytes = decodeBase64(value);
  if (bytes.length !== DATA_PACKET_LENGTH)
    throw new Error(`DATA must contain ${DATA_PACKET_LENGTH} bytes.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sequence = view.getUint32(8, true);
  const sessionId = view.getUint32(16, true);
  if (sequence === 0 || sessionId === 0)
    throw new Error("DATA has an invalid session or sequence.");
  return {
    ch1: view.getInt32(0, true),
    ch2: view.getInt32(4, true),
    sequence,
    deviceTimestampMs: view.getUint32(12, true),
    sessionId,
  };
}

export function decodeControlStatus(value: string): ControlStatus {
  const bytes = decodeBase64(value);
  if (bytes.length !== CONTROL_STATUS_LENGTH)
    throw new Error(
      `CONTROL status must contain ${CONTROL_STATUS_LENGTH} bytes.`,
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== 1)
    throw new Error(`Unsupported CONTROL version: ${version}.`);
  return {
    version,
    flags: view.getUint8(1),
    bufferedPackets: view.getUint16(2, true),
    sessionId: view.getUint32(4, true),
    generatedSequence: view.getUint32(8, true),
    acknowledgedSequence: view.getUint32(12, true),
    lastCommandError: view.getUint8(16),
    lastCommandType: view.getUint8(17),
  };
}

export function encodeControlCommand(
  type: number,
  sessionId: number,
  sequence = 0,
): string {
  if (
    ![1, 2, 3, 4].includes(type) ||
    !Number.isInteger(sessionId) ||
    sessionId < 1 ||
    sessionId > 0xffffffff ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > 0xffffffff
  ) {
    throw new Error("Invalid CONTROL command.");
  }
  const bytes = new Uint8Array(CONTROL_COMMAND_LENGTH);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, type);
  view.setUint32(1, sessionId, true);
  view.setUint32(5, sequence, true);
  return encodeBase64(bytes);
}

export function contiguousSequenceAfter(
  previous: number,
  orderedSequences: number[],
) {
  let contiguous = previous;
  for (const sequence of orderedSequences) {
    if (sequence <= contiguous) continue;
    if (sequence !== contiguous + 1) break;
    contiguous = sequence;
  }
  return contiguous;
}
