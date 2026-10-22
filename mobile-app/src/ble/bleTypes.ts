import type { State } from "react-native-ble-plx";

import type { ControlStatus } from "@/ble/protocol";
import { SensorSample } from "@/sensors/parseStrainGaugeValue";
import type { MeasurementSession } from "@/services/measurementTiming";

export type BleConnectionStatus =
  | "idle"
  | "permission-denied"
  | "bluetooth-off"
  | "scanning"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error"
  | "unsupported";

export type BleScannedDevice = {
  id: string;
  name: string;
  rssi: number | null;
};

export type BleDeviceState = {
  bluetoothState: State | "Unknown";
  status: BleConnectionStatus;
  devices: BleScannedDevice[];
  connectedDevice: BleScannedDevice | null;
  currentSample: SensorSample | null;
  errorMessage: string | null;
  parseWarning: string | null;
  hasScanned: boolean;
  controlStatus: ControlStatus | null;
  controlWriteMode: "withResponse" | "withoutResponse" | null;
  durableSequence: number;
  storedPacketCount: number;
  protocolWarning: string | null;
  measurementSession: MeasurementSession | null;
};
