import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { getSessionPacketBatches, type StoredPacket } from "@/ble/sampleStore";
import type { ProcessedBreathSample } from "@/services/breathSignalProcessor";
import {
  buildStoredPacketsCsv,
  writeStoredPacketsCsv,
  type StoredExportStatus,
} from "@/services/storedPacketCsv";

export {
  buildStoredPacketsCsv,
  type StoredExportStatus
} from "@/services/storedPacketCsv";

const CSV_MIME_TYPE = "text/csv";
const CSV_HEADERS = [
  "timestamp_ms",
  "timestamp_iso",
  "elapsed_ms",
  "session_id",
  "sequence",
  "device_timestamp_ms",
  "raw_ch1",
  "baseline_ch1",
  "signal_ch1",
  "filtered_ch1",
  "raw_ch2",
  "baseline_ch2",
  "signal_ch2",
  "filtered_ch2",
  "filtered_combined",
];

export type BreathSampleExportResult = {
  fileName: string;
  sampleCount: number;
};

function escapeCsvValue(value: number | string | null) {
  if (value === null) {
    return "";
  }

  const stringValue = String(value);

  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function createExportFileName(now = new Date()) {
  return `breathing-measurement-${now.toISOString().replace(/[:.]/g, "-")}.csv`;
}

export function buildBreathSamplesCsv(samples: ProcessedBreathSample[]) {
  const firstTimestamp = samples[0]?.timestamp ?? 0;
  const rows = samples.map((sample) =>
    [
      sample.timestamp,
      new Date(sample.timestamp).toISOString(),
      sample.timestamp - firstTimestamp,
      sample.sessionId,
      sample.sequence,
      sample.deviceTimestampMs,
      sample.raw1,
      sample.baseline1,
      sample.signal1,
      sample.filtered1,
      sample.raw2,
      sample.baseline2,
      sample.signal2,
      sample.filtered2,
      sample.filteredCombined,
    ]
      .map((value) =>
        typeof value === "number"
          ? escapeCsvValue(formatNumber(value))
          : escapeCsvValue(value),
      )
      .join(","),
  );

  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

function downloadCsvOnWeb(csv: string, fileName: string) {
  if (typeof document === "undefined") {
    throw new Error("CSV export is not available in this environment.");
  }

  const blob = new Blob([csv], { type: `${CSV_MIME_TYPE};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBreathSamplesToCsv(
  samples: ProcessedBreathSample[],
): Promise<BreathSampleExportResult> {
  if (samples.length === 0) {
    throw new Error("No measurement samples to export.");
  }

  const csv = buildBreathSamplesCsv(samples);
  const fileName = createExportFileName();

  if (Platform.OS === "web") {
    downloadCsvOnWeb(csv, fileName);
    return { fileName, sampleCount: samples.length };
  }

  const canShare = await Sharing.isAvailableAsync();

  if (!canShare) {
    throw new Error("Sharing is not available on this device.");
  }

  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(csv);

  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Export measurement CSV",
    mimeType: CSV_MIME_TYPE,
    UTI: "public.comma-separated-values-text",
  });

  return { fileName, sampleCount: samples.length };
}

export async function exportStoredPacketsToCsv(
  packets: StoredPacket[],
  status?: StoredExportStatus,
): Promise<BreathSampleExportResult> {
  if (packets.length === 0) throw new Error("No stored packets to export.");
  const csv = buildStoredPacketsCsv(packets, status);
  const fileName = createExportFileName();
  if (Platform.OS === "web") {
    downloadCsvOnWeb(csv, fileName);
    return { fileName, sampleCount: packets.length };
  }
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(csv);
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Export measurement CSV",
    mimeType: CSV_MIME_TYPE,
    UTI: "public.comma-separated-values-text",
  });
  return { fileName, sampleCount: packets.length };
}

export async function exportStoredSessionToCsv(
  deviceId: string,
  sessionId: number,
  status?: StoredExportStatus,
): Promise<BreathSampleExportResult> {
  if (Platform.OS === "web")
    throw new Error(
      "BLE measurement storage is available only on Android and iOS.",
    );
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const fileName = createExportFileName();
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  let sampleCount: number;
  try {
    const handle = file.open();
    try {
      const encoder = new TextEncoder();
      sampleCount = await writeStoredPacketsCsv(
        getSessionPacketBatches(deviceId, sessionId),
        (chunk) => handle.writeBytes(encoder.encode(chunk)),
        status,
      );
    } finally {
      handle.close();
    }
    if (sampleCount === 0) throw new Error("No stored packets to export.");
  } catch (error) {
    file.delete();
    throw error;
  }
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Export measurement CSV",
    mimeType: CSV_MIME_TYPE,
    UTI: "public.comma-separated-values-text",
  });
  return { fileName, sampleCount };
}
