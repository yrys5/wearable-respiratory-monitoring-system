import type { StoredPacket } from "@/ble/sampleStore";
import {
  createInitialSignalProcessorState,
  processStrainGaugeSample,
} from "@/services/breathSignalProcessor";

export type StoredExportStatus = {
  complete: boolean | null;
  generatedSequence: number | null;
};

const HEADERS = [
  "session_id",
  "sequence",
  "device_timestamp_ms",
  "received_at_ms",
  "received_at_iso",
  "session_complete",
  "device_generated_sequence",
  "raw_ch1",
  "raw_ch2",
  "accepted_by_signal_filter",
  "baseline_ch1",
  "signal_ch1",
  "filtered_ch1",
  "baseline_ch2",
  "signal_ch2",
  "filtered_ch2",
  "filtered_combined",
].join(",");

function createRowWriter(status: StoredExportStatus) {
  let processor = createInitialSignalProcessorState();
  let previousDeviceTimestamp: number | null = null;
  let timestamp = 0;
  return (packet: StoredPacket) => {
    timestamp =
      previousDeviceTimestamp === null
        ? packet.receivedAt
        : timestamp +
          ((packet.deviceTimestampMs - previousDeviceTimestamp) >>> 0);
    previousDeviceTimestamp = packet.deviceTimestampMs;
    const previousAccepted = processor.acceptedSampleCount;
    processor = processStrainGaugeSample(processor, {
      rawValue: `ch1=${packet.ch1} ch2=${packet.ch2}`,
      numericValue: packet.ch1,
      secondaryValue: packet.ch2,
      channelValues: { ch1: packet.ch1, ch2: packet.ch2 },
      timestamp,
      deviceTimestampMs: packet.deviceTimestampMs,
      sequence: packet.sequence,
      sessionId: packet.sessionId,
      parseError: null,
    });
    const accepted = processor.acceptedSampleCount > previousAccepted;
    const filtered = accepted ? processor.samples.at(-1) : null;
    return [
      packet.sessionId,
      packet.sequence,
      packet.deviceTimestampMs,
      packet.receivedAt,
      new Date(packet.receivedAt).toISOString(),
      status.complete === null ? "" : Number(status.complete),
      status.generatedSequence ?? "",
      packet.ch1,
      packet.ch2,
      accepted ? 1 : 0,
      filtered?.baseline1 ?? "",
      filtered?.signal1 ?? "",
      filtered?.filtered1 ?? "",
      filtered?.baseline2 ?? "",
      filtered?.signal2 ?? "",
      filtered?.filtered2 ?? "",
      filtered?.filteredCombined ?? "",
    ].join(",");
  };
}

export function buildStoredPacketsCsv(
  packets: StoredPacket[],
  status: StoredExportStatus = { complete: null, generatedSequence: null },
) {
  return [HEADERS, ...packets.map(createRowWriter(status))].join("\n");
}

export async function writeStoredPacketsCsv(
  batches: AsyncIterable<StoredPacket[]>,
  writeChunk: (chunk: string) => void | Promise<void>,
  status: StoredExportStatus = { complete: null, generatedSequence: null },
) {
  const writeRow = createRowWriter(status);
  await writeChunk(HEADERS);
  let sampleCount = 0;
  for await (const batch of batches) {
    if (batch.length === 0) continue;
    await writeChunk("\n" + batch.map(writeRow).join("\n"));
    sampleCount += batch.length;
  }
  return sampleCount;
}
