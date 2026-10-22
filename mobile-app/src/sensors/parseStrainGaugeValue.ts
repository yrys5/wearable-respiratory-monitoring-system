import { decodeDataPacket } from "@/ble/protocol";

export type ParsedStrainGaugeSample = {
  rawValue: string;
  numericValue: number | null;
  secondaryValue: number | null;
  channelValues: Record<string, number>;
  timestamp: number;
  deviceTimestampMs: number | null;
  sequence: number | null;
  sessionId: number | null;
  parseError: string | null;
};

export type SensorSample = ParsedStrainGaugeSample;

export function parseStrainGaugeValue(
  base64Value: string | null | undefined,
): SensorSample {
  const timestamp = Date.now();
  try {
    if (!base64Value) throw new Error("Missing DATA value.");
    const packet = decodeDataPacket(base64Value);
    return {
      rawValue: `ch1=${packet.ch1} ch2=${packet.ch2}`,
      numericValue: packet.ch1,
      secondaryValue: packet.ch2,
      channelValues: { ch1: packet.ch1, ch2: packet.ch2 },
      timestamp,
      deviceTimestampMs: packet.deviceTimestampMs,
      sequence: packet.sequence,
      sessionId: packet.sessionId,
      parseError: null,
    };
  } catch (error) {
    return {
      rawValue: base64Value ?? "",
      numericValue: null,
      secondaryValue: null,
      channelValues: {},
      timestamp,
      deviceTimestampMs: null,
      sequence: null,
      sessionId: null,
      parseError:
        error instanceof Error ? error.message : "Invalid DATA packet.",
    };
  }
}
