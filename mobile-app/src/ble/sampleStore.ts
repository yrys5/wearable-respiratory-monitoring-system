import * as SQLite from "expo-sqlite";

import {
  CONTROL_FLAG,
  contiguousSequenceAfter,
  type ControlStatus,
  type DataPacket,
} from "@/ble/protocol";
import type { MeasurementSession } from "@/services/measurementTiming";

export type StoredPacket = DataPacket & { receivedAt: number };
export type SessionProgress = {
  contiguousSequence: number;
  sampleCount: number;
};
export type StoredSession = {
  deviceId: string;
  sessionId: number;
  sampleCount: number;
  verifiedComplete: boolean;
  generatedSequence: number | null;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let writeQueue = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function openDatabase() {
  const db = await SQLite.openDatabaseAsync("breathing-sessions.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS sessions (
      device_id TEXT NOT NULL,
      session_id INTEGER NOT NULL,
      contiguous_sequence INTEGER NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      verified_complete INTEGER NOT NULL DEFAULT 0,
      generated_sequence INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (device_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS samples (
      device_id TEXT NOT NULL,
      session_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      device_timestamp_ms INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      ch1 INTEGER NOT NULL,
      ch2 INTEGER NOT NULL,
      PRIMARY KEY (device_id, session_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS measurement_settings (
      device_id TEXT NOT NULL,
      session_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      duration_ms INTEGER,
      PRIMARY KEY (device_id, session_id)
    );
  `);
  return db;
}

function getDatabase() {
  if (!databasePromise)
    databasePromise = openDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  return databasePromise;
}

export function createNewSession(deviceId: string, previousSessionId: number) {
  return enqueueWrite(() =>
    createNewSessionUnqueued(deviceId, previousSessionId),
  );
}

export function saveMeasurementSession(session: MeasurementSession) {
  return enqueueWrite(async () => {
    const db = await getDatabase();
    await db.runAsync(
      "INSERT OR REPLACE INTO measurement_settings (device_id, session_id, started_at, duration_ms) VALUES (?, ?, ?, ?)",
      session.deviceId,
      session.sessionId,
      session.startedAt,
      session.durationMs,
    );
  });
}

export async function getMeasurementSession(
  deviceId: string,
  sessionId: number,
): Promise<MeasurementSession | null> {
  await writeQueue;
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    started_at: number;
    duration_ms: number | null;
  }>(
    "SELECT started_at, duration_ms FROM measurement_settings WHERE device_id = ? AND session_id = ?",
    deviceId,
    sessionId,
  );
  return row
    ? {
        deviceId,
        sessionId,
        startedAt: row.started_at,
        durationMs: row.duration_ms,
      }
    : null;
}

async function createNewSessionUnqueued(
  deviceId: string,
  previousSessionId: number,
) {
  const db = await getDatabase();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sessionId = Math.floor(Math.random() * 0xffffffff) + 1;
    if (sessionId === previousSessionId) continue;
    const result = await db.runAsync(
      "INSERT OR IGNORE INTO sessions (device_id, session_id, created_at) VALUES (?, ?, ?)",
      deviceId,
      sessionId,
      Date.now(),
    );
    if (result.changes === 1) return sessionId;
  }
  throw new Error("Could not allocate a new measurement session ID.");
}

export async function getSessionProgress(
  deviceId: string,
  sessionId: number,
): Promise<SessionProgress> {
  await writeQueue;
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    contiguous_sequence: number;
    sample_count: number;
  }>(
    "SELECT contiguous_sequence, sample_count FROM sessions WHERE device_id = ? AND session_id = ?",
    deviceId,
    sessionId,
  );
  return {
    contiguousSequence: row?.contiguous_sequence ?? 0,
    sampleCount: row?.sample_count ?? 0,
  };
}

export async function storePacket(
  deviceId: string,
  packet: DataPacket,
  receivedAt: number,
) {
  return enqueueWrite(() => storePacketUnqueued(deviceId, packet, receivedAt));
}

async function storePacketUnqueued(
  deviceId: string,
  packet: DataPacket,
  receivedAt: number,
) {
  const db = await getDatabase();
  let progress: SessionProgress = { contiguousSequence: 0, sampleCount: 0 };
  let inserted = false;
  let previousContiguous = 0;

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      "INSERT OR IGNORE INTO sessions (device_id, session_id, created_at) VALUES (?, ?, ?)",
      deviceId,
      packet.sessionId,
      receivedAt,
    );
    const result = await txn.runAsync(
      `INSERT OR IGNORE INTO samples
       (device_id, session_id, sequence, device_timestamp_ms, received_at, ch1, ch2)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      deviceId,
      packet.sessionId,
      packet.sequence,
      packet.deviceTimestampMs,
      receivedAt,
      packet.ch1,
      packet.ch2,
    );
    inserted = result.changes > 0;
    if (inserted) {
      await txn.runAsync(
        "UPDATE sessions SET sample_count = sample_count + 1, verified_complete = 0 WHERE device_id = ? AND session_id = ?",
        deviceId,
        packet.sessionId,
      );
    }
    if (!inserted) {
      const existing = await txn.getFirstAsync<{
        device_timestamp_ms: number;
        ch1: number;
        ch2: number;
      }>(
        "SELECT device_timestamp_ms, ch1, ch2 FROM samples WHERE device_id = ? AND session_id = ? AND sequence = ?",
        deviceId,
        packet.sessionId,
        packet.sequence,
      );
      if (
        !existing ||
        existing.device_timestamp_ms !== packet.deviceTimestampMs ||
        existing.ch1 !== packet.ch1 ||
        existing.ch2 !== packet.ch2
      ) {
        throw new Error(
          `Conflicting duplicate DATA sequence ${packet.sequence}.`,
        );
      }
    }

    const session = await txn.getFirstAsync<{
      contiguous_sequence: number;
      sample_count: number;
    }>(
      "SELECT contiguous_sequence, sample_count FROM sessions WHERE device_id = ? AND session_id = ?",
      deviceId,
      packet.sessionId,
    );
    let contiguous = session?.contiguous_sequence ?? 0;
    previousContiguous = contiguous;
    if (packet.sequence === contiguous + 1) {
      const rows = await txn.getAllAsync<{ sequence: number }>(
        "SELECT sequence FROM samples WHERE device_id = ? AND session_id = ? AND sequence > ? ORDER BY sequence",
        deviceId,
        packet.sessionId,
        contiguous,
      );
      contiguous = contiguousSequenceAfter(
        contiguous,
        rows.map((row) => row.sequence),
      );
      await txn.runAsync(
        "UPDATE sessions SET contiguous_sequence = ? WHERE device_id = ? AND session_id = ?",
        contiguous,
        deviceId,
        packet.sessionId,
      );
    }
    progress = {
      contiguousSequence: contiguous,
      sampleCount: session?.sample_count ?? 0,
    };
  });

  return { ...progress, inserted, previousContiguous };
}

export async function recordControlStatus(
  deviceId: string,
  status: ControlStatus,
) {
  if (!status.sessionId) return;
  return enqueueWrite(() => recordControlStatusUnqueued(deviceId, status));
}

async function recordControlStatusUnqueued(
  deviceId: string,
  status: ControlStatus,
) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      "INSERT OR IGNORE INTO sessions (device_id, session_id, created_at) VALUES (?, ?, ?)",
      deviceId,
      status.sessionId,
      Date.now(),
    );
    const row = await txn.getFirstAsync<{ contiguous_sequence: number }>(
      "SELECT contiguous_sequence FROM sessions WHERE device_id = ? AND session_id = ?",
      deviceId,
      status.sessionId,
    );
    const incompleteFlags =
      CONTROL_FLAG.RECORDING |
      CONTROL_FLAG.OVERFLOW |
      CONTROL_FLAG.ADC_GAP |
      CONTROL_FLAG.SEQUENCE_EXHAUSTED;
    const complete =
      !(status.flags & incompleteFlags) &&
      status.bufferedPackets === 0 &&
      status.generatedSequence === row?.contiguous_sequence &&
      status.acknowledgedSequence === status.generatedSequence;
    await txn.runAsync(
      "UPDATE sessions SET verified_complete = ?, generated_sequence = ? WHERE device_id = ? AND session_id = ?",
      Number(complete),
      status.generatedSequence,
      deviceId,
      status.sessionId,
    );
  });
}

export async function getSessionPackets(
  deviceId: string,
  sessionId: number,
): Promise<StoredPacket[]> {
  await writeQueue;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    ch1: number;
    ch2: number;
    sequence: number;
    device_timestamp_ms: number;
    session_id: number;
    received_at: number;
  }>(
    `SELECT ch1, ch2, sequence, device_timestamp_ms, session_id, received_at
     FROM samples WHERE device_id = ? AND session_id = ? ORDER BY sequence`,
    deviceId,
    sessionId,
  );
  return rows.map((row) => ({
    ch1: row.ch1,
    ch2: row.ch2,
    sequence: row.sequence,
    deviceTimestampMs: row.device_timestamp_ms,
    sessionId: row.session_id,
    receivedAt: row.received_at,
  }));
}

export async function* getSessionPacketBatches(
  deviceId: string,
  sessionId: number,
): AsyncGenerator<StoredPacket[]> {
  await writeQueue;
  const db = await getDatabase();
  // Freeze the boundary so exporting an ongoing measurement always finishes.
  const snapshot = await db.getFirstAsync<{ last_sequence: number | null }>(
    "SELECT MAX(sequence) AS last_sequence FROM samples WHERE device_id = ? AND session_id = ?",
    deviceId,
    sessionId,
  );
  const through = snapshot?.last_sequence ?? 0;
  let after = 0;
  while (after < through) {
    const rows = await db.getAllAsync<{
      ch1: number;
      ch2: number;
      sequence: number;
      device_timestamp_ms: number;
      session_id: number;
      received_at: number;
    }>(
      `SELECT ch1, ch2, sequence, device_timestamp_ms, session_id, received_at
       FROM samples WHERE device_id = ? AND session_id = ? AND sequence > ? AND sequence <= ?
       ORDER BY sequence LIMIT 256`,
      deviceId,
      sessionId,
      after,
      through,
    );
    if (rows.length === 0) return;
    after = rows[rows.length - 1].sequence;
    yield rows.map((row) => ({
      ch1: row.ch1,
      ch2: row.ch2,
      sequence: row.sequence,
      deviceTimestampMs: row.device_timestamp_ms,
      sessionId: row.session_id,
      receivedAt: row.received_at,
    }));
  }
}

export async function getLatestSession(): Promise<StoredSession | null> {
  await writeQueue;
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    device_id: string;
    session_id: number;
    sample_count: number;
    verified_complete: number;
    generated_sequence: number | null;
  }>(
    "SELECT device_id, session_id, sample_count, verified_complete, generated_sequence FROM sessions WHERE sample_count > 0 ORDER BY created_at DESC LIMIT 1",
  );
  return row
    ? {
        deviceId: row.device_id,
        sessionId: row.session_id,
        sampleCount: row.sample_count,
        verifiedComplete: row.verified_complete === 1,
        generatedSequence: row.generated_sequence,
      }
    : null;
}

export async function getPacketsInRange(
  deviceId: string,
  sessionId: number,
  after: number,
  through: number,
): Promise<StoredPacket[]> {
  await writeQueue;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    ch1: number;
    ch2: number;
    sequence: number;
    device_timestamp_ms: number;
    session_id: number;
    received_at: number;
  }>(
    `SELECT ch1, ch2, sequence, device_timestamp_ms, session_id, received_at
     FROM samples WHERE device_id = ? AND session_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence`,
    deviceId,
    sessionId,
    after,
    through,
  );
  return rows.map((row) => ({
    ch1: row.ch1,
    ch2: row.ch2,
    sequence: row.sequence,
    deviceTimestampMs: row.device_timestamp_ms,
    sessionId: row.session_id,
    receivedAt: row.received_at,
  }));
}
