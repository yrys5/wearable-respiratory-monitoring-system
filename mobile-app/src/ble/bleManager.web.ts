import { BleScannedDevice } from "@/ble/bleTypes";

const unsupportedManager = {
  onStateChange() {
    return {
      remove() {},
    };
  },
  async startDeviceScan() {},
  async stopDeviceScan() {},
  async connectToDevice() {
    throw new Error("BLE is available only in Android/iOS development builds.");
  },
  async cancelDeviceConnection() {},
};

export function getBleManager() {
  return unsupportedManager;
}

export function toScannedDevice(): BleScannedDevice {
  return {
    id: "unsupported-web-device",
    name: "Unsupported on web",
    rssi: null,
  };
}

export function isBreathingDevice() {
  return false;
}

export function getMissingUuidMessage() {
  return null;
}
