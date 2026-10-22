import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import type { Device, Subscription } from "react-native-ble-plx";

import {
  getBleManager,
  getMissingUuidMessage,
  isBreathingDevice,
  toScannedDevice,
} from "@/ble/bleManager";
import { BleDeviceState } from "@/ble/bleTypes";
import {
  CONTROL_COMMAND,
  CONTROL_FLAG,
  controlCommandApplied,
  controlErrorLabel,
  decodeControlStatus,
  encodeControlCommand,
  type ControlStatus,
} from "@/ble/protocol";
import {
  createNewSession,
  getMeasurementSession,
  getPacketsInRange,
  getSessionProgress,
  recordControlStatus,
  saveMeasurementSession,
  storePacket,
  type StoredPacket,
} from "@/ble/sampleStore";
import { BLE_CONFIG, hasConfiguredBleUuids } from "@/config/bleConfig";
import {
  parseStrainGaugeValue,
  type SensorSample,
} from "@/sensors/parseStrainGaugeValue";
import {
  scheduleMeasurementStop,
  validateMeasurementDuration,
} from "@/services/measurementTiming";

const BLE_OPERATION_CANCELLED_ERROR_CODE = 2;
const sampleListeners = new Set<(sample: SensorSample) => void>();
const bleStateListeners = new Set<(state: BleDeviceState) => void>();
let connectedNativeDevice: Device | null = null;
let controlWriteMode: "withResponse" | "withoutResponse" | null = null;
let monitorSubscription: Subscription | null = null;
let monitorGeneration = 0;
let disconnectSubscription: Subscription | null = null;
let isDisconnecting = false;
let packetQueue = Promise.resolve();
let commandQueue = Promise.resolve();
let ackPumping = false;
let ackRetryTimer: ReturnType<typeof setTimeout> | null = null;
let ackRetryAttempts = 0;
let wantedAck = 0;
let ackSessionId = 0;
let lastGapReplay: {
  sessionId: number;
  contiguous: number;
  at: number;
} | null = null;
let gapRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
const GAP_RECOVERY_DELAY_MS = 1500;
const GAP_REPLAY_COOLDOWN_MS = 3000;
const FIRMWARE_PACKET_BUFFER_CAPACITY = 512;
let chartClock: {
  sessionId: number;
  deviceTimestampMs: number;
  displayedAt: number;
} | null = null;
let cancelAutomaticStop: (() => void) | null = null;
let stopOperation: Promise<void> | null = null;
let startInProgress = false;
let connectInProgress = false;
let bleState: BleDeviceState = {
  bluetoothState: "Unknown",
  status: "idle",
  devices: [],
  connectedDevice: null,
  currentSample: null,
  errorMessage: null,
  parseWarning: null,
  hasScanned: false,
  controlStatus: null,
  controlWriteMode: null,
  durableSequence: 0,
  storedPacketCount: 0,
  protocolWarning: null,
  measurementSession: null,
};

function getAndroidVersion() {
  return typeof Platform.Version === "number"
    ? Platform.Version
    : Number(Platform.Version);
}

function isCancelledBleOperation(error: unknown) {
  return (
    error instanceof Error &&
    "errorCode" in error &&
    error.errorCode === BLE_OPERATION_CANCELLED_ERROR_CODE
  );
}

function removeDataMonitor() {
  // Removing a react-native-ble-plx monitor cancels its native transaction.
  // Its asynchronous cancellation callback must not replace the real connection error.
  monitorGeneration += 1;
  const subscription = monitorSubscription;
  monitorSubscription = null;
  subscription?.remove();
}

function emitSensorSample(sample: SensorSample) {
  sampleListeners.forEach((listener) => listener(sample));
}

function updateBleState(
  updater:
    | Partial<BleDeviceState>
    | ((state: BleDeviceState) => Partial<BleDeviceState>),
) {
  const nextState = typeof updater === "function" ? updater(bleState) : updater;
  bleState = {
    ...bleState,
    ...nextState,
  };
  bleStateListeners.forEach((listener) => listener(bleState));
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return "BLE protocol operation failed.";
  const bleError = error as Error & {
    errorCode?: number;
    iosErrorCode?: number;
  };
  const codes = [
    typeof bleError.errorCode === "number" ? `BLE ${bleError.errorCode}` : null,
    typeof bleError.iosErrorCode === "number"
      ? `iOS ${bleError.iosErrorCode}`
      : null,
  ].filter(Boolean);
  return codes.length
    ? `${error.message} (${codes.join(", ")})`
    : error.message;
}

function statusWarning(status: ControlStatus) {
  const problems = [];
  if (status.flags & CONTROL_FLAG.OVERFLOW)
    problems.push("device buffer overflow");
  if (status.flags & CONTROL_FLAG.ADC_GAP) problems.push("ADC gap");
  if (status.flags & CONTROL_FLAG.SEQUENCE_EXHAUSTED)
    problems.push("sequence exhausted");
  if (status.bufferedPackets >= FIRMWARE_PACKET_BUFFER_CAPACITY * 0.75) {
    problems.push(
      `device buffer ${status.bufferedPackets}/${FIRMWARE_PACKET_BUFFER_CAPACITY}`,
    );
  }
  return problems.length ? `Device warning: ${problems.join(", ")}.` : null;
}

async function readControlStatus(device: Device) {
  const characteristic = await device.readCharacteristicForService(
    BLE_CONFIG.SERVICE_UUID,
    BLE_CONFIG.CONTROL_CHARACTERISTIC_UUID,
  );
  if (!characteristic.value) throw new Error("CONTROL status is empty.");
  const status = decodeControlStatus(characteristic.value);
  if (connectedNativeDevice === device) {
    await recordControlStatus(device.id, status);
    updateBleState({
      controlStatus: status,
      protocolWarning: statusWarning(status),
    });
    if (!(status.flags & CONTROL_FLAG.RECORDING)) clearAutomaticStop();
  }
  return status;
}

function sendControl(type: number, sessionId: number, sequence = 0) {
  const targetDevice = connectedNativeDevice;
  const operation = async () => {
    if (
      !targetDevice ||
      connectedNativeDevice !== targetDevice ||
      !controlWriteMode
    ) {
      throw new Error("BLE device is disconnected.");
    }
    const payload = encodeControlCommand(type, sessionId, sequence);
    if (controlWriteMode === "withResponse") {
      await targetDevice.writeCharacteristicWithResponseForService(
        BLE_CONFIG.SERVICE_UUID,
        BLE_CONFIG.CONTROL_CHARACTERISTIC_UUID,
        payload,
      );
    } else {
      await targetDevice.writeCharacteristicWithoutResponseForService(
        BLE_CONFIG.SERVICE_UUID,
        BLE_CONFIG.CONTROL_CHARACTERISTIC_UUID,
        payload,
      );
    }
    // A GATT write completion does not prove that firmware accepted the command.
    // A write without response may also be processed after the first status read.
    const statusAttempts = controlWriteMode === "withoutResponse" ? 10 : 5;
    let status: ControlStatus | null = null;
    for (let attempt = 0; attempt < statusAttempts; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 100));
      status = await readControlStatus(targetDevice);
      if (connectedNativeDevice !== targetDevice)
        throw new Error("BLE device disconnected during CONTROL command.");
      if (controlCommandApplied(status, type, sessionId, sequence))
        return status;
    }
    if (status?.lastCommandType === type && status.lastCommandError !== 0) {
      throw new Error(
        `CONTROL ${type} rejected: ${controlErrorLabel(status.lastCommandError)}.`,
      );
    }
    throw new Error(`CONTROL ${type} was not confirmed by device status.`);
  };
  const result = commandQueue.then(operation, operation);
  commandQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function pumpAcks() {
  if (ackPumping) return;
  const pumpDevice = connectedNativeDevice;
  ackPumping = true;
  try {
    while (
      connectedNativeDevice &&
      ackSessionId &&
      wantedAck > (bleState.controlStatus?.acknowledgedSequence ?? 0)
    ) {
      const sessionId = ackSessionId;
      const target = wantedAck;
      const status = await sendControl(CONTROL_COMMAND.ACK, sessionId, target);
      if (
        status.sessionId !== sessionId ||
        status.acknowledgedSequence < target
      ) {
        throw new Error("Device did not confirm the durable ACK.");
      }
    }
    ackRetryAttempts = 0;
    if (ackRetryTimer) clearTimeout(ackRetryTimer);
    ackRetryTimer = null;
  } catch (error) {
    updateBleState({ errorMessage: describeError(error) });
    if (
      connectedNativeDevice === pumpDevice &&
      ackRetryAttempts < 3 &&
      !describeError(error).startsWith("CONTROL ")
    ) {
      ackRetryAttempts += 1;
      if (ackRetryTimer) clearTimeout(ackRetryTimer);
      ackRetryTimer = setTimeout(
        () => {
          ackRetryTimer = null;
          if (connectedNativeDevice !== pumpDevice || !pumpDevice) return;
          void readControlStatus(pumpDevice)
            .then(() => pumpAcks())
            .catch((retryError) =>
              updateBleState({ errorMessage: describeError(retryError) }),
            );
        },
        500 * 2 ** (ackRetryAttempts - 1),
      );
    }
  } finally {
    ackPumping = false;
    if (
      connectedNativeDevice &&
      connectedNativeDevice !== pumpDevice &&
      ackSessionId &&
      wantedAck > (bleState.controlStatus?.acknowledgedSequence ?? 0)
    ) {
      void pumpAcks();
    }
  }
}

function requestAck(sessionId: number, sequence: number) {
  if (!sequence || bleState.controlStatus?.sessionId !== sessionId) return;
  if (ackSessionId !== sessionId) {
    ackSessionId = sessionId;
    wantedAck = 0;
  }
  wantedAck = Math.max(wantedAck, sequence);
  void pumpAcks();
}

function chartTimestamp(packet: StoredPacket) {
  if (!chartClock || chartClock.sessionId !== packet.sessionId) {
    chartClock = {
      sessionId: packet.sessionId,
      deviceTimestampMs: packet.deviceTimestampMs,
      displayedAt: packet.receivedAt,
    };
  }
  return (
    chartClock.displayedAt +
    ((packet.deviceTimestampMs - chartClock.deviceTimestampMs) >>> 0)
  );
}

function clearAutomaticStop() {
  cancelAutomaticStop?.();
  cancelAutomaticStop = null;
}

function scheduleAutomaticStop() {
  clearAutomaticStop();
  const session = bleState.measurementSession;
  const device = connectedNativeDevice;
  if (
    !session ||
    !device ||
    bleState.status !== "connected" ||
    device.id !== session.deviceId ||
    bleState.controlStatus?.sessionId !== session.sessionId ||
    !(bleState.controlStatus.flags & CONTROL_FLAG.RECORDING)
  )
    return;
  cancelAutomaticStop = scheduleMeasurementStop(
    session,
    async () => {
      if (
        connectedNativeDevice !== device ||
        bleState.controlStatus?.sessionId !== session.sessionId
      )
        return;
      await stopDeviceSession(session.sessionId);
    },
    (error) => {
      updateBleState({
        errorMessage: `Automatic STOP failed: ${describeError(error)}`,
      });
    },
  );
}

function clearGapRecovery() {
  if (gapRecoveryTimer) clearTimeout(gapRecoveryTimer);
  gapRecoveryTimer = null;
}

function scheduleGapRecovery(
  device: Device,
  sessionId: number,
  contiguousSequence: number,
) {
  if (
    gapRecoveryTimer ||
    (lastGapReplay?.sessionId === sessionId &&
      lastGapReplay.contiguous === contiguousSequence &&
      Date.now() - lastGapReplay.at < GAP_REPLAY_COOLDOWN_MS)
  )
    return;

  gapRecoveryTimer = setTimeout(() => {
    gapRecoveryTimer = null;
    void (async () => {
      if (connectedNativeDevice !== device) return;
      const progress = await getSessionProgress(device.id, sessionId);
      // A larger sample count means there are stored packets beyond the first missing sequence.
      if (progress.sampleCount <= progress.contiguousSequence) return;
      const status = await readControlStatus(device);
      if (connectedNativeDevice !== device || status.sessionId !== sessionId)
        return;
      if (status.acknowledgedSequence > progress.contiguousSequence) {
        throw new Error(
          "Device has ACKed samples that are missing from local storage.",
        );
      }
      if (status.generatedSequence <= progress.contiguousSequence) return;
      lastGapReplay = {
        sessionId,
        contiguous: progress.contiguousSequence,
        at: Date.now(),
      };
      try {
        await sendControl(
          CONTROL_COMMAND.RESUME,
          sessionId,
          progress.contiguousSequence,
        );
      } catch (error) {
        lastGapReplay = null;
        throw error;
      }
    })().catch((error) =>
      updateBleState({
        errorMessage: `Gap recovery failed: ${describeError(error)}`,
      }),
    );
  }, GAP_RECOVERY_DELAY_MS);
}

function stopDeviceSession(expectedSessionId?: number) {
  if (stopOperation) return stopOperation;
  stopOperation = (async () => {
    const device = connectedNativeDevice;
    if (!device)
      throw new Error(
        "Device disconnected before STOP. Reconnect to recover the session.",
      );
    const current = await readControlStatus(device);
    if (!current.sessionId) throw new Error("No device session to stop.");
    if (expectedSessionId && current.sessionId !== expectedSessionId) return;
    if (current.flags & CONTROL_FLAG.RECORDING) {
      const stopped = await sendControl(
        CONTROL_COMMAND.STOP,
        current.sessionId,
        0,
      );
      if (stopped.flags & CONTROL_FLAG.RECORDING)
        throw new Error("Device is still recording after STOP.");
    }
    const latest = await readControlStatus(device);
    if (latest.sessionId !== current.sessionId) {
      throw new Error(
        "Device changed session after STOP; final packet count cannot be verified.",
      );
    }
    const progress = await getSessionProgress(device.id, latest.sessionId);
    if (latest.acknowledgedSequence > progress.contiguousSequence) {
      throw new Error(
        "Device has ACKed samples that are missing from local storage.",
      );
    }
    if (progress.contiguousSequence < latest.generatedSequence) {
      clearGapRecovery();
      await sendControl(
        CONTROL_COMMAND.RESUME,
        latest.sessionId,
        progress.contiguousSequence,
      );
    }
    requestAck(latest.sessionId, progress.contiguousSequence);
  })().finally(() => {
    stopOperation = null;
  });
  return stopOperation;
}

async function processData(device: Device, value: string | null | undefined) {
  const sample = parseStrainGaugeValue(value);
  if (
    sample.parseError ||
    sample.sequence === null ||
    sample.sessionId === null ||
    sample.deviceTimestampMs === null ||
    sample.numericValue === null ||
    sample.secondaryValue === null
  ) {
    updateBleState({
      parseWarning: sample.parseError ?? "Invalid DATA packet.",
    });
    return;
  }

  const result = await storePacket(
    device.id,
    {
      ch1: sample.numericValue,
      ch2: sample.secondaryValue,
      sequence: sample.sequence,
      sessionId: sample.sessionId,
      deviceTimestampMs: sample.deviceTimestampMs,
    },
    sample.timestamp,
  );
  if (connectedNativeDevice !== device) return;
  if (
    bleState.controlStatus &&
    bleState.controlStatus.sessionId !== sample.sessionId
  ) {
    updateBleState({
      errorMessage: `Received DATA for unexpected session ${sample.sessionId}.`,
    });
    return;
  }

  updateBleState({
    durableSequence: result.contiguousSequence,
    storedPacketCount: result.sampleCount,
    parseWarning: null,
  });
  requestAck(sample.sessionId, result.contiguousSequence);

  if (result.contiguousSequence > result.previousContiguous) {
    const packets = await getPacketsInRange(
      device.id,
      sample.sessionId,
      result.previousContiguous,
      result.contiguousSequence,
    );
    for (const packet of packets) {
      const orderedSample: SensorSample = {
        rawValue: `ch1=${packet.ch1} ch2=${packet.ch2}`,
        numericValue: packet.ch1,
        secondaryValue: packet.ch2,
        channelValues: { ch1: packet.ch1, ch2: packet.ch2 },
        timestamp: chartTimestamp(packet),
        deviceTimestampMs: packet.deviceTimestampMs,
        sequence: packet.sequence,
        sessionId: packet.sessionId,
        parseError: null,
      };
      emitSensorSample(orderedSample);
      updateBleState({ currentSample: orderedSample });
    }
  }
  if (
    result.sampleCount > result.contiguousSequence &&
    bleState.controlStatus?.sessionId === sample.sessionId
  ) {
    scheduleGapRecovery(device, sample.sessionId, result.contiguousSequence);
  } else {
    clearGapRecovery();
  }
}

async function requestBlePermissions() {
  if (Platform.OS !== "android") {
    return true;
  }

  const androidVersion = getAndroidVersion();
  const permissions =
    androidVersion >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export function useBleDevice(
  onSample?: (sample: SensorSample) => void,
): BleDeviceState & {
  scanDevices: () => Promise<void>;
  stopScan: () => Promise<void>;
  connectToDevice: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  startMeasurement: (durationMs: number | null) => Promise<number>;
  stopMeasurement: () => Promise<void>;
  refreshControlStatus: () => Promise<void>;
  clearError: () => void;
} {
  const managerRef = useRef(getBleManager());
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSampleRef = useRef(onSample);

  const [state, setState] = useState<BleDeviceState>(bleState);

  const {
    bluetoothState,
    status,
    devices,
    connectedDevice,
    currentSample,
    errorMessage,
    parseWarning,
    hasScanned,
    controlStatus,
    controlWriteMode: availableControlWriteMode,
    durableSequence,
    storedPacketCount,
    protocolWarning,
    measurementSession,
  } = state;

  useEffect(() => {
    bleStateListeners.add(setState);

    return () => {
      bleStateListeners.delete(setState);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") scheduleAutomaticStop();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    onSampleRef.current = onSample;
  }, [onSample]);

  useEffect(() => {
    if (!onSample) {
      return;
    }

    const listener = (sample: SensorSample) => {
      onSampleRef.current?.(sample);
    };

    sampleListeners.add(listener);

    return () => {
      sampleListeners.delete(listener);
    };
  }, [onSample]);

  const clearScanTimeout = useCallback(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
  }, []);

  const stopScan = useCallback(async () => {
    clearScanTimeout();

    try {
      await managerRef.current.stopDeviceScan();
    } catch {
      updateBleState({ errorMessage: "Could not stop BLE scan cleanly." });
    }

    updateBleState((currentState) => ({
      status: currentState.status === "scanning" ? "idle" : currentState.status,
    }));
  }, [clearScanTimeout]);

  const clearError = useCallback(() => {
    updateBleState({ errorMessage: null, parseWarning: null });
  }, []);

  const scanDevices = useCallback(async () => {
    if (Platform.OS === "web") {
      updateBleState({
        status: "unsupported",
        errorMessage:
          "BLE scanning is available only in Android/iOS development builds, not on web.",
      });
      return;
    }

    const hasPermissions = await requestBlePermissions();

    if (!hasPermissions) {
      updateBleState({
        status: "permission-denied",
        errorMessage: "Bluetooth permissions were denied.",
      });
      return;
    }

    if (bluetoothState !== "PoweredOn") {
      updateBleState({
        status: "bluetooth-off",
        errorMessage: "Bluetooth is off. Turn it on and scan again.",
      });
      return;
    }

    await stopScan();
    updateBleState({
      devices: [],
      hasScanned: true,
      status: "scanning",
      errorMessage: null,
    });

    try {
      await managerRef.current.startDeviceScan(
        null,
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            updateBleState({
              status: "error",
              errorMessage: error.message || "BLE scan failed.",
            });
            void stopScan();
            return;
          }

          if (!device || !isBreathingDevice(device)) {
            return;
          }

          const scannedDevice = toScannedDevice(device);
          updateBleState((currentState) => {
            const currentDevices = currentState.devices;
            const existingDevice = currentDevices.find(
              (item) => item.id === scannedDevice.id,
            );

            if (existingDevice) {
              return {
                devices: currentDevices.map((item) =>
                  item.id === scannedDevice.id
                    ? { ...item, ...scannedDevice }
                    : item,
                ),
              };
            }

            return {
              devices: [...currentDevices, scannedDevice],
            };
          });
        },
      );

      scanTimeoutRef.current = setTimeout(() => {
        void stopScan();
      }, BLE_CONFIG.SCAN_TIMEOUT_MS);
    } catch (error) {
      updateBleState({
        status: "error",
        errorMessage:
          error instanceof Error ? error.message : "Could not start BLE scan.",
      });
    }
  }, [bluetoothState, stopScan]);

  const subscribeToStrainGauge = useCallback((device: Device) => {
    removeDataMonitor();
    const generation = monitorGeneration;

    monitorSubscription = device.monitorCharacteristicForService(
      BLE_CONFIG.SERVICE_UUID,
      BLE_CONFIG.STRAIN_GAUGE_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (generation !== monitorGeneration) return;
        if (error) {
          if (isDisconnecting && isCancelledBleOperation(error)) {
            return;
          }

          updateBleState({
            errorMessage: `DATA subscription failed: ${describeError(error)}`,
          });
          return;
        }

        packetQueue = packetQueue
          .then(
            () => processData(device, characteristic?.value),
            () => processData(device, characteristic?.value),
          )
          .catch((processingError) => {
            updateBleState({
              errorMessage: `DATA was not saved: ${describeError(processingError)}`,
            });
          });
      },
    );
  }, []);

  const connectToDevice = useCallback(
    async (deviceId: string) => {
      if (connectInProgress) return;
      connectInProgress = true;
      let connectionPhase = "preparing BLE connection";
      try {
        await stopScan();
        updateBleState({ status: "connecting", errorMessage: null });

        if (!hasConfiguredBleUuids())
          throw new Error(getMissingUuidMessage() ?? "Invalid BLE UUIDs.");

        connectionPhase = "opening BLE connection";
        const connected = await managerRef.current.connectToDevice(
          deviceId,
          Platform.OS === "android"
            ? { autoConnect: false, refreshGatt: "OnConnected" }
            : { autoConnect: false },
        );
        connectionPhase = "discovering GATT services";
        const readyDevice =
          await connected.discoverAllServicesAndCharacteristics();

        connectionPhase = "checking DATA and CONTROL characteristics";
        const characteristics = await readyDevice.characteristicsForService(
          BLE_CONFIG.SERVICE_UUID,
        );
        const data = characteristics.find(
          (item) =>
            item.uuid.toLowerCase() ===
            BLE_CONFIG.STRAIN_GAUGE_CHARACTERISTIC_UUID.toLowerCase(),
        );
        const control = characteristics.find(
          (item) =>
            item.uuid.toLowerCase() ===
            BLE_CONFIG.CONTROL_CHARACTERISTIC_UUID.toLowerCase(),
        );
        if (!data?.isNotifiable)
          throw new Error("DATA characteristic must support notifications.");
        if (!control) {
          throw new Error(
            `CONTROL characteristic not found. Discovered: ${characteristics.map((item) => item.uuid).join(", ") || "none"}.`,
          );
        }
        if (
          !control.isReadable ||
          (!control.isWritableWithResponse &&
            !control.isWritableWithoutResponse)
        ) {
          throw new Error(
            `CONTROL properties: read=${control.isReadable}, write with response=${control.isWritableWithResponse}, write without response=${control.isWritableWithoutResponse}. Read and one write mode are required.`,
          );
        }

        connectedNativeDevice = readyDevice;
        controlWriteMode = control.isWritableWithResponse
          ? "withResponse"
          : "withoutResponse";
        clearGapRecovery();
        lastGapReplay = null;
        clearAutomaticStop();
        updateBleState({
          connectedDevice: toScannedDevice(readyDevice),
          status: "connecting",
          controlStatus: null,
          controlWriteMode,
          measurementSession: null,
        });
        disconnectSubscription?.remove();
        disconnectSubscription = managerRef.current.onDeviceDisconnected(
          deviceId,
          (error) => {
            if (connectedNativeDevice !== readyDevice) return;
            connectedNativeDevice = null;
            clearAutomaticStop();
            controlWriteMode = null;
            ackSessionId = 0;
            wantedAck = 0;
            if (ackRetryTimer) clearTimeout(ackRetryTimer);
            ackRetryTimer = null;
            ackRetryAttempts = 0;
            clearGapRecovery();
            lastGapReplay = null;
            removeDataMonitor();
            updateBleState({
              connectedDevice: null,
              controlWriteMode: null,
              status: "idle",
              errorMessage: isDisconnecting
                ? null
                : `BLE device disconnected: ${error ? describeError(error) : "connection closed unexpectedly"}. Reconnect to resume.`,
            });
          },
        );
        connectionPhase = "reading initial CONTROL status";
        let remote = await readControlStatus(readyDevice);
        connectionPhase = "subscribing to DATA notifications";
        subscribeToStrainGauge(readyDevice);
        connectionPhase = "waiting for DATA subscription";
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          remote = await readControlStatus(readyDevice);
          if (remote.flags & CONTROL_FLAG.SUBSCRIBED) break;
        }
        if (!(remote.flags & CONTROL_FLAG.SUBSCRIBED))
          throw new Error("DATA subscription was not confirmed by the device.");
        if (remote.sessionId !== 0) {
          const measurementSession = await getMeasurementSession(
            deviceId,
            remote.sessionId,
          );
          updateBleState({ measurementSession });
          const local = await getSessionProgress(deviceId, remote.sessionId);
          if (remote.acknowledgedSequence > local.contiguousSequence) {
            throw new Error(
              "Device has ACKed samples that are missing from local storage. Session cannot be verified.",
            );
          }
          updateBleState({
            durableSequence: local.contiguousSequence,
            storedPacketCount: local.sampleCount,
          });
          if (
            remote.flags & CONTROL_FLAG.RECORDING ||
            remote.bufferedPackets > 0 ||
            remote.generatedSequence > remote.acknowledgedSequence
          ) {
            connectionPhase = "resuming the previous session";
            remote = await sendControl(
              CONTROL_COMMAND.RESUME,
              remote.sessionId,
              local.contiguousSequence,
            );
            requestAck(remote.sessionId, local.contiguousSequence);
          }
        } else {
          updateBleState({ durableSequence: 0, storedPacketCount: 0 });
        }
        updateBleState({ status: "connected", errorMessage: null });
        scheduleAutomaticStop();
      } catch (error) {
        clearAutomaticStop();
        clearGapRecovery();
        removeDataMonitor();
        disconnectSubscription?.remove();
        disconnectSubscription = null;
        await managerRef.current
          .cancelDeviceConnection(deviceId)
          .catch(() => undefined);
        connectedNativeDevice = null;
        controlWriteMode = null;
        updateBleState({
          status: "error",
          connectedDevice: null,
          controlWriteMode: null,
          errorMessage: `${connectionPhase}: ${describeError(error)}`,
        });
      } finally {
        connectInProgress = false;
      }
    },
    [stopScan, subscribeToStrainGauge],
  );

  const disconnect = useCallback(async () => {
    isDisconnecting = true;
    clearAutomaticStop();
    updateBleState({ status: "disconnecting", errorMessage: null });
    removeDataMonitor();
    disconnectSubscription?.remove();
    disconnectSubscription = null;

    try {
      if (connectedNativeDevice) {
        await managerRef.current.cancelDeviceConnection(
          connectedNativeDevice.id,
        );
      }
    } catch {
      updateBleState({
        errorMessage:
          "Device was already disconnected or could not be disconnected cleanly.",
      });
    } finally {
      connectedNativeDevice = null;
      controlWriteMode = null;
      ackSessionId = 0;
      wantedAck = 0;
      if (ackRetryTimer) clearTimeout(ackRetryTimer);
      ackRetryTimer = null;
      ackRetryAttempts = 0;
      clearGapRecovery();
      lastGapReplay = null;
      updateBleState({
        connectedDevice: null,
        controlWriteMode: null,
        currentSample: null,
        parseWarning: null,
        status: "idle",
      });
      isDisconnecting = false;
    }
  }, []);

  const startMeasurement = useCallback(async (durationMs: number | null) => {
    if (startInProgress) throw new Error("START is already in progress.");
    startInProgress = true;
    try {
      const device = connectedNativeDevice;
      if (!device || bleState.status !== "connected")
        throw new Error("Connect to the sensor first.");
      validateMeasurementDuration(durationMs);
      const current = await readControlStatus(device);
      if (
        current.flags & CONTROL_FLAG.RECORDING ||
        current.bufferedPackets > 0 ||
        current.generatedSequence > current.acknowledgedSequence
      ) {
        throw new Error(
          "Previous session is still recording or transmitting. Stop or wait for its data first.",
        );
      }
      const sessionId = await createNewSession(device.id, current.sessionId);
      const measurementSession = {
        deviceId: device.id,
        sessionId,
        startedAt: Date.now(),
        durationMs,
      };
      await saveMeasurementSession(measurementSession);
      updateBleState({ measurementSession });
      const status = await sendControl(CONTROL_COMMAND.START, sessionId, 0);
      if (
        status.sessionId !== sessionId ||
        !(status.flags & CONTROL_FLAG.RECORDING)
      ) {
        throw new Error("Device did not start the requested session.");
      }
      const progress = await getSessionProgress(device.id, sessionId);
      clearGapRecovery();
      lastGapReplay = null;
      ackSessionId = sessionId;
      wantedAck = progress.contiguousSequence;
      updateBleState({
        durableSequence: progress.contiguousSequence,
        storedPacketCount: progress.sampleCount,
        errorMessage: null,
      });
      requestAck(sessionId, progress.contiguousSequence);
      scheduleAutomaticStop();
      return sessionId;
    } catch (error) {
      // START can take effect even if its confirmation fails. Keep its deadline.
      scheduleAutomaticStop();
      throw error;
    } finally {
      startInProgress = false;
    }
  }, []);

  const stopMeasurement = useCallback(async () => {
    clearAutomaticStop();
    await stopDeviceSession();
  }, []);

  const refreshControlStatus = useCallback(async () => {
    if (!connectedNativeDevice) throw new Error("BLE device is disconnected.");
    try {
      const device = connectedNativeDevice;
      const remote = await readControlStatus(device);
      if (remote.sessionId) {
        const progress = await getSessionProgress(device.id, remote.sessionId);
        updateBleState({
          durableSequence: progress.contiguousSequence,
          storedPacketCount: progress.sampleCount,
        });
        if (remote.acknowledgedSequence > progress.contiguousSequence) {
          throw new Error(
            "Device has ACKed samples that are missing from local storage.",
          );
        }
        if (progress.contiguousSequence < remote.generatedSequence) {
          clearGapRecovery();
          await sendControl(
            CONTROL_COMMAND.RESUME,
            remote.sessionId,
            progress.contiguousSequence,
          );
        }
        requestAck(remote.sessionId, progress.contiguousSequence);
      }
    } catch (error) {
      updateBleState({ errorMessage: describeError(error) });
      throw error;
    }
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    const subscription = manager.onStateChange((newState) => {
      updateBleState({ bluetoothState: newState });

      if (newState !== "PoweredOn") {
        updateBleState((currentState) => ({
          status:
            currentState.status === "scanning"
              ? "bluetooth-off"
              : currentState.status,
        }));
      }
    }, true);

    return () => {
      subscription.remove();
      clearScanTimeout();
      void manager.stopDeviceScan();
    };
  }, [clearScanTimeout]);

  return {
    bluetoothState,
    status,
    devices,
    connectedDevice,
    currentSample,
    errorMessage,
    parseWarning,
    hasScanned,
    controlStatus,
    controlWriteMode: availableControlWriteMode,
    durableSequence,
    storedPacketCount,
    protocolWarning,
    measurementSession,
    scanDevices,
    stopScan,
    connectToDevice,
    disconnect,
    startMeasurement,
    stopMeasurement,
    refreshControlStatus,
    clearError,
  };
}
