import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CONTROL_FLAG } from "@/ble/protocol";
import { getLatestSession, type StoredSession } from "@/ble/sampleStore";
import { useBleDevice } from "@/ble/useBleDevice";
import { SensorChart, SensorChartMode } from "@/components/sensor-chart";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSensorBuffer } from "@/sensors/useSensorBuffer";
import { exportStoredSessionToCsv } from "@/services/breathSampleExport";
import { measurementRemainingMs } from "@/services/measurementTiming";

type ExportStatus = {
  type: "success" | "error";
  message: string;
};

const MEASUREMENT_DURATIONS_SECONDS = [
  10, 15, 20, 30, 60, 90, 120, 240,
] as const;

type MeasurementDurationSeconds =
  | (typeof MEASUREMENT_DURATIONS_SECONDS)[number]
  | null;

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return remainingSeconds === 0
    ? `${minutes}m`
    : `${minutes}m ${remainingSeconds}s`;
}

export default function HomeScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const [chartMode, setChartMode] = useState<SensorChartMode>("filtered");
  const [isDurationPickerOpen, setIsDurationPickerOpen] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [selectedDurationSeconds, setSelectedDurationSeconds] =
    useState<MeasurementDurationSeconds>(30);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [isExporting, setIsExporting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [storedSession, setStoredSession] = useState<StoredSession | null>(
    null,
  );
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const { samples, stats, addSample, clearSamples } = useSensorBuffer();
  const {
    connectedDevice,
    status,
    controlStatus,
    durableSequence,
    storedPacketCount,
    protocolWarning,
    errorMessage,
    parseWarning,
    measurementSession,
    startMeasurement: sendStart,
    stopMeasurement: sendStop,
  } = useBleDevice(addSample);
  const isDeviceRecording =
    status === "connected" &&
    !!(controlStatus && controlStatus.flags & CONTROL_FLAG.RECORDING);
  const isMeasuring = isDeviceRecording;
  const durationSelectionDisabled = isMeasuring || isStarting || isStopping;
  const hasPendingData = !!(
    controlStatus &&
    (controlStatus.bufferedPackets > 0 ||
      controlStatus.generatedSequence > controlStatus.acknowledgedSequence)
  );
  const canStartMeasurement =
    connectedDevice !== null &&
    status === "connected" &&
    !isMeasuring &&
    !isStarting &&
    !isStopping &&
    !isDeviceRecording &&
    !hasPendingData;
  const canExportSamples = !!storedSession?.sampleCount && !isExporting;
  const currentSessionMatches = !!(
    controlStatus &&
    storedSession &&
    connectedDevice &&
    storedSession.deviceId === connectedDevice.id &&
    storedSession.sessionId === controlStatus.sessionId
  );
  const liveSessionComplete = !!(
    controlStatus &&
    currentSessionMatches &&
    !isDeviceRecording &&
    !hasPendingData &&
    durableSequence === controlStatus.generatedSequence &&
    !protocolWarning
  );
  const sessionComplete = currentSessionMatches
    ? liveSessionComplete
    : (storedSession?.verifiedComplete ?? false);
  const selectedDurationMs =
    selectedDurationSeconds === null ? null : selectedDurationSeconds * 1000;
  const activeSession =
    isMeasuring &&
    measurementSession &&
    connectedDevice &&
    measurementSession.deviceId === connectedDevice.id &&
    measurementSession.sessionId === controlStatus?.sessionId
      ? measurementSession
      : null;
  const durationMs = isMeasuring
    ? (activeSession?.durationMs ?? null)
    : selectedDurationMs;
  const elapsedMs = activeSession
    ? Math.max(0, timerNow - activeSession.startedAt)
    : 0;
  const remainingMs = activeSession
    ? measurementRemainingMs(activeSession, timerNow)
    : durationMs;
  const durationLabel =
    isMeasuring && !activeSession
      ? "Unknown"
      : durationMs === null
        ? "No limit"
        : formatDuration(durationMs / 1000);
  const timerLabel = !isMeasuring
    ? ""
    : !activeSession
      ? "Recording"
      : remainingMs === null
        ? `${formatDuration(Math.floor(elapsedMs / 1000))} elapsed`
        : `${formatDuration(Math.ceil(remainingMs / 1000))} left`;
  const measurementProgress =
    isMeasuring && durationMs !== null
      ? Math.min(1, elapsedMs / durationMs)
      : 0;

  const stopMeasurement = useCallback(async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      await sendStop();
    } catch (error) {
      setExportStatus({
        type: "error",
        message: error instanceof Error ? error.message : "STOP failed.",
      });
    } finally {
      setIsStopping(false);
    }
  }, [isStopping, sendStop]);

  useEffect(() => {
    void getLatestSession()
      .then(setStoredSession)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (connectedDevice && controlStatus?.sessionId && storedPacketCount > 0) {
      const complete =
        !(
          controlStatus.flags &
          (CONTROL_FLAG.RECORDING |
            CONTROL_FLAG.OVERFLOW |
            CONTROL_FLAG.ADC_GAP |
            CONTROL_FLAG.SEQUENCE_EXHAUSTED)
        ) &&
        controlStatus.bufferedPackets === 0 &&
        controlStatus.generatedSequence === durableSequence &&
        controlStatus.acknowledgedSequence === controlStatus.generatedSequence;
      setStoredSession({
        deviceId: connectedDevice.id,
        sessionId: controlStatus.sessionId,
        sampleCount: storedPacketCount,
        verifiedComplete: complete,
        generatedSequence: controlStatus.generatedSequence,
      });
    }
  }, [connectedDevice, controlStatus, durableSequence, storedPacketCount]);

  const durationOptions = useMemo(
    () => [
      ...MEASUREMENT_DURATIONS_SECONDS.map((durationSeconds) => ({
        durationSeconds,
        label: formatDuration(durationSeconds),
      })),
      { durationSeconds: null, label: "No limit" },
    ],
    [],
  );

  useEffect(() => {
    if (!isMeasuring) {
      return;
    }
    const updateTimer = () => setTimerNow(Date.now());
    updateTimer();
    const interval = setInterval(updateTimer, 250);

    return () => clearInterval(interval);
  }, [isMeasuring]);

  const startMeasurement = async () => {
    if (!canStartMeasurement) {
      return;
    }
    setIsStarting(true);
    setIsDurationPickerOpen(false);
    clearSamples();
    setExportStatus(null);
    try {
      await sendStart(selectedDurationMs);
      setStoredSession(null);
      const startedAt = Date.now();
      setTimerNow(startedAt);
    } catch (error) {
      setExportStatus({
        type: "error",
        message: error instanceof Error ? error.message : "START failed.",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const exportMeasurement = async () => {
    if (!canExportSamples) {
      return;
    }

    setIsExporting(true);
    setExportStatus(null);

    try {
      if (!storedSession) return;
      const statusMatches = !!(
        connectedDevice &&
        controlStatus &&
        connectedDevice.id === storedSession.deviceId &&
        controlStatus.sessionId === storedSession.sessionId
      );
      const result = await exportStoredSessionToCsv(
        storedSession.deviceId,
        storedSession.sessionId,
        {
          complete: statusMatches
            ? liveSessionComplete
            : storedSession.verifiedComplete,
          generatedSequence: statusMatches
            ? controlStatus!.generatedSequence
            : storedSession.generatedSequence,
        },
      );
      setExportStatus({
        type: "success",
        message: `Exported ${result.sampleCount} samples to ${result.fileName}`,
      });
    } catch (error) {
      setExportStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not export measurement data.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingTop: safeAreaInsets.top + Spacing.three,
          paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
        },
      ]}
    >
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Summary</ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Measurement</ThemedText>
            <View
              style={[
                styles.badge,
                isDeviceRecording ? styles.badgeConnected : styles.badgeNeutral,
              ]}
            >
              <ThemedText type="code" style={styles.badgeText}>
                {isDeviceRecording
                  ? "running"
                  : hasPendingData
                    ? "syncing"
                    : "ready"}
              </ThemedText>
            </View>
          </View>
          <View style={styles.measurementMetaRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Measurement duration: ${durationLabel}`}
              accessibilityState={{
                disabled: durationSelectionDisabled,
                expanded: isDurationPickerOpen && !durationSelectionDisabled,
              }}
              onPress={() => setIsDurationPickerOpen((open) => !open)}
              disabled={durationSelectionDisabled}
              style={({ pressed }) => [
                styles.durationSelector,
                { borderColor: theme.backgroundSelected },
                durationSelectionDisabled && styles.durationButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="small" themeColor="textSecondary">
                Duration
              </ThemedText>
              <ThemedText type="smallBold">{durationLabel}</ThemedText>
              <SymbolView
                name={{
                  ios: "chevron.down",
                  android: "expand_more",
                  web: "expand_more",
                }}
                size={16}
                tintColor={theme.textSecondary}
                style={{
                  transform: [
                    {
                      rotate:
                        isDurationPickerOpen && !durationSelectionDisabled
                          ? "180deg"
                          : "0deg",
                    },
                  ],
                }}
              />
            </Pressable>
            {timerLabel ? (
              <ThemedText type="smallBold">{timerLabel}</ThemedText>
            ) : null}
          </View>
          {isDurationPickerOpen && !durationSelectionDisabled ? (
            <View style={styles.durationGrid}>
              {durationOptions.map(({ durationSeconds, label }) => {
                const isSelected = durationSeconds === selectedDurationSeconds;

                return (
                  <Pressable
                    key={durationSeconds ?? "continuous"}
                    accessibilityRole="button"
                    accessibilityLabel={`Duration: ${label}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      setSelectedDurationSeconds(durationSeconds);
                      setIsDurationPickerOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.durationButton,
                      { borderColor: theme.backgroundSelected },
                      isSelected && styles.durationButtonSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={
                        isSelected
                          ? styles.durationButtonTextSelected
                          : undefined
                      }
                    >
                      {label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {durationMs !== null ? (
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${measurementProgress * 100}%` },
                ]}
              />
            </View>
          ) : null}
          <View style={styles.buttonRow}>
            <ActionButton
              label={isStarting ? "Starting..." : "Start measurement"}
              onPress={() => {
                void startMeasurement();
              }}
              disabled={!canStartMeasurement}
            />
            {isMeasuring || isDeviceRecording ? (
              <ActionButton
                label={isStopping ? "Stopping..." : "Stop"}
                onPress={() => {
                  void stopMeasurement();
                }}
                disabled={isStopping || status !== "connected"}
                variant="danger"
              />
            ) : null}
            <ActionButton
              label={isExporting ? "Exporting..." : "Export CSV"}
              onPress={() => {
                void exportMeasurement();
              }}
              disabled={!canExportSamples}
              variant="secondary"
            />
          </View>
          {storedSession?.sampleCount && !isMeasuring ? (
            <ThemedText
              type="small"
              style={
                sessionComplete
                  ? styles.exportStatusSuccess
                  : styles.exportStatusError
              }
            >
              {sessionComplete
                ? "Data saved."
                : hasPendingData && status === "connected"
                  ? "Saving remaining data…"
                  : "Some measurement data may be missing."}
            </ThemedText>
          ) : null}
          {protocolWarning ? (
            <ThemedText type="small" style={styles.exportStatusError}>
              Sensor data warning. See technical details.
            </ThemedText>
          ) : null}
          {errorMessage ? (
            <ThemedText type="small" style={styles.exportStatusError}>
              {errorMessage}
            </ThemedText>
          ) : null}
          {parseWarning ? (
            <ThemedText type="small" style={styles.exportStatusError}>
              Some sensor data could not be read. See technical details.
            </ThemedText>
          ) : null}
          {exportStatus ? (
            <ThemedText
              type="small"
              style={
                exportStatus.type === "error"
                  ? styles.exportStatusError
                  : styles.exportStatusSuccess
              }
            >
              {exportStatus.message}
            </ThemedText>
          ) : null}
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Live signal chart</ThemedText>
          </View>
          <View style={styles.segmentedControl}>
            {(["raw", "filtered", "normalized"] as SensorChartMode[]).map(
              (mode) => (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chartMode === mode }}
                  onPress={() => setChartMode(mode)}
                  style={[
                    styles.segmentedButton,
                    {
                      flexGrow:
                        mode === "raw" ? 0.7 : mode === "filtered" ? 1 : 1.3,
                    },
                    chartMode === mode && styles.segmentedButtonSelected,
                  ]}
                >
                  <ThemedText
                    type="smallBold"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    style={[
                      styles.segmentedButtonText,
                      chartMode === mode && styles.segmentedButtonTextSelected,
                    ]}
                  >
                    {mode.toUpperCase()}
                  </ThemedText>
                </Pressable>
              ),
            )}
          </View>
          <SensorChart samples={samples} mode={chartMode} />
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Breath rate</ThemedText>
          <ThemedText style={styles.bpmValue}>
            {stats.estimatedBpm === null ? "--" : stats.estimatedBpm.toFixed(1)}{" "}
            bpm
          </ThemedText>
        </ThemedView>
        <ThemedView type="backgroundElement" style={styles.technicalCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showTechnicalDetails }}
            onPress={() => setShowTechnicalDetails((visible) => !visible)}
            style={({ pressed }) => [
              styles.technicalHeading,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" themeColor="textSecondary">
              Technical details
            </ThemedText>
            <SymbolView
              name={{
                ios: "chevron.down",
                android: "expand_more",
                web: "expand_more",
              }}
              size={16}
              tintColor={theme.textSecondary}
              style={{
                transform: [
                  { rotate: showTechnicalDetails ? "180deg" : "0deg" },
                ],
              }}
            />
          </Pressable>
          {showTechnicalDetails ? (
            <View style={styles.technicalContent}>
              <TechnicalDetail label="Connection" value={status} />
              <TechnicalDetail
                label="Device ID"
                value={
                  connectedDevice?.id ??
                  measurementSession?.deviceId ??
                  storedSession?.deviceId ??
                  "—"
                }
              />
              <TechnicalDetail
                label="Session ID"
                value={String(
                  controlStatus?.sessionId ?? storedSession?.sessionId ?? "—",
                )}
              />
              <TechnicalDetail
                label="Packets stored"
                value={String(
                  controlStatus
                    ? storedPacketCount
                    : (storedSession?.sampleCount ?? 0),
                )}
              />
              {controlStatus ? (
                <>
                  <TechnicalDetail
                    label="Contiguous / generated"
                    value={`${durableSequence} / ${controlStatus.generatedSequence}`}
                  />
                  <TechnicalDetail
                    label="Device ACK"
                    value={String(controlStatus.acknowledgedSequence)}
                  />
                  <TechnicalDetail
                    label="Device buffer"
                    value={String(controlStatus.bufferedPackets)}
                  />
                  <TechnicalDetail
                    label="Flags"
                    value={`0x${controlStatus.flags.toString(16).padStart(2, "0")}`}
                  />
                </>
              ) : null}
              {storedSession?.sampleCount ? (
                <TechnicalDetail
                  label="Completeness"
                  value={
                    sessionComplete
                      ? "Complete and acknowledged"
                      : "Not confirmed; CSV may be partial"
                  }
                />
              ) : null}
              {protocolWarning ? (
                <ThemedText type="small" style={styles.exportStatusError}>
                  {protocolWarning}
                </ThemedText>
              ) : null}
              {parseWarning ? (
                <ThemedText type="small" style={styles.exportStatusError}>
                  {parseWarning}
                </ThemedText>
              ) : null}
            </View>
          ) : null}
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.technicalRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="code" selectable>
        {value}
      </ThemedText>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <ThemedText
        type="smallBold"
        style={
          variant === "secondary"
            ? styles.buttonSecondaryText
            : styles.buttonText
        }
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    alignItems: "center",
    paddingHorizontal: Spacing.three,
  },
  container: {
    width: "100%",
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.one,
  },
  card: {
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  badgeConnected: {
    backgroundColor: "#0D8F5A",
  },
  badgeNeutral: {
    backgroundColor: "#4B5563",
  },
  badgeText: {
    color: "#FFFFFF",
    textTransform: "uppercase",
  },
  metaGrid: {
    flexDirection: "row",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  infoItem: {
    minWidth: 130,
    flex: 1,
    gap: Spacing.half,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  measurementMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  durationSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  progressTrack: {
    borderRadius: 8,
    height: 8,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: "#1769E0",
    borderRadius: 8,
    height: "100%",
  },
  durationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  durationButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  durationButtonSelected: {
    backgroundColor: "#1769E0",
    borderColor: "#1769E0",
  },
  durationButtonDisabled: {
    opacity: 0.6,
  },
  durationButtonTextSelected: {
    color: "#FFFFFF",
  },
  exportStatusSuccess: {
    color: "#0D8F5A",
  },
  exportStatusError: {
    color: "#C43E3E",
  },
  inlineActions: {
    flexDirection: "row",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  button: {
    minHeight: 42,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  buttonPrimary: {
    backgroundColor: "#1769E0",
  },
  buttonSecondary: {
    backgroundColor: "#D8DEE8",
  },
  buttonDanger: {
    backgroundColor: "#C43E3E",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: "#FFFFFF",
  },
  buttonSecondaryText: {
    color: "#111827",
  },
  connectedBox: {
    gap: Spacing.two,
  },
  errorBox: {
    backgroundColor: "#F8D7DA",
    borderRadius: 8,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  deviceList: {
    gap: Spacing.two,
  },
  deviceRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  deviceText: {
    flex: 1,
  },
  liveValue: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: "700",
  },
  segmentedControl: {
    // backgroundColor: "#D8DEE8",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.one,
    padding: Spacing.one,
  },
  segmentedButton: {
    alignItems: "center",
    borderRadius: 6,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: Spacing.one,
  },
  segmentedButtonText: {
    fontSize: 12,
    lineHeight: 18,
  },
  segmentedButtonSelected: {
    backgroundColor: "#1769E0",
  },
  segmentedButtonTextSelected: {
    color: "#FFFFFF",
  },
  technicalCard: {
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
  },
  technicalHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    gap: Spacing.two,
  },
  technicalContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  technicalRow: {
    gap: Spacing.half,
  },
  bpmValue: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
