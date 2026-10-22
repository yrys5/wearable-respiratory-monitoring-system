import type { DataPacket } from "@/ble/protocol";
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

function unsupported(): never {
  throw new Error(
    "BLE measurement storage is available only on Android and iOS.",
  );
}

export async function createNewSession(
  _deviceId: string,
  _previousSessionId: number,
): Promise<number> {
  unsupported();
}
export async function saveMeasurementSession(
  _session: MeasurementSession,
): Promise<void> {
  unsupported();
}
export async function getMeasurementSession(
  _deviceId: string,
  _sessionId: number,
): Promise<MeasurementSession | null> {
  unsupported();
}
export async function getSessionProgress(
  _deviceId: string,
  _sessionId: number,
): Promise<SessionProgress> {
  unsupported();
}
export async function storePacket(
  _deviceId: string,
  _packet: DataPacket,
  _receivedAt: number,
): Promise<
  SessionProgress & { inserted: boolean; previousContiguous: number }
> {
  unsupported();
}
export async function getSessionPackets(
  _deviceId: string,
  _sessionId: number,
): Promise<StoredPacket[]> {
  unsupported();
}
export async function* getSessionPacketBatches(
  _deviceId: string,
  _sessionId: number,
): AsyncGenerator<StoredPacket[]> {
  unsupported();
}
export async function getLatestSession(): Promise<StoredSession | null> {
  unsupported();
}
export async function recordControlStatus(
  _deviceId: string,
  _status: import("@/ble/protocol").ControlStatus,
): Promise<void> {
  unsupported();
}
export async function getPacketsInRange(
  _deviceId: string,
  _sessionId: number,
  _after: number,
  _through: number,
): Promise<StoredPacket[]> {
  unsupported();
}
