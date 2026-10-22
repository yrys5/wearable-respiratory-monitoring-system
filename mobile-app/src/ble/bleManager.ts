import { BleManager, Device } from "react-native-ble-plx";

import { BleScannedDevice } from "@/ble/bleTypes";
import { BLE_CONFIG, hasConfiguredBleUuids } from "@/config/bleConfig";

let bleManager: BleManager | null = null;

export function getBleManager() {
  if (!bleManager) {
    bleManager = new BleManager();
  }

  return bleManager;
}

export function toScannedDevice(device: Device): BleScannedDevice {
  return {
    id: device.id,
    name: device.name ?? device.localName ?? "Unnamed device",
    rssi: device.rssi ?? null,
  };
}

export function isBreathingDevice(device: Device) {
  const name = device.name ?? device.localName ?? "";
  return name
    .toLowerCase()
    .startsWith(BLE_CONFIG.DEVICE_NAME_PREFIX.toLowerCase());
}

export function getMissingUuidMessage() {
  if (hasConfiguredBleUuids()) {
    return null;
  }

  return "Configure valid, distinct DATA and CONTROL UUIDs in src/config/bleConfig.ts.";
}
