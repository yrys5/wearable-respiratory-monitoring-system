import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { controlErrorLabel } from "@/ble/protocol";
import { useBleDevice } from "@/ble/useBleDevice";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BLE_CONFIG } from "@/config/bleConfig";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

function statusLabel(status: string) {
  return status.replace(/-/g, " ");
}

export default function ExploreScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const {
    bluetoothState,
    status,
    devices,
    connectedDevice,
    errorMessage,
    parseWarning,
    hasScanned,
    controlStatus,
    controlWriteMode,
    durableSequence,
    storedPacketCount,
    protocolWarning,
    scanDevices,
    stopScan,
    connectToDevice,
    disconnect,
    clearError,
    refreshControlStatus,
  } = useBleDevice();
  const isScanning = status === "scanning";
  const isConnected = status === "connected";

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
          <ThemedText type="subtitle">Setup</ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">BLE connection</ThemedText>
            <View
              style={[
                styles.badge,
                isConnected ? styles.badgeConnected : styles.badgeNeutral,
              ]}
            >
              <ThemedText type="code" style={styles.badgeText}>
                {statusLabel(status)}
              </ThemedText>
            </View>
          </View>

          <View style={styles.metaGrid}>
            <InfoItem label="Bluetooth" value={bluetoothState} />
            <InfoItem
              label="Device prefix"
              value={BLE_CONFIG.DEVICE_NAME_PREFIX}
            />
          </View>

          {controlStatus ? (
            <View style={styles.metaGrid}>
              <InfoItem
                label="Session"
                value={String(controlStatus.sessionId)}
              />
              <InfoItem
                label="CONTROL write"
                value={
                  controlWriteMode === "withResponse"
                    ? "With response"
                    : "Without response"
                }
              />
              <InfoItem
                label="Saved / generated"
                value={`${durableSequence} / ${controlStatus.generatedSequence}`}
              />
              <InfoItem
                label="Packets stored"
                value={String(storedPacketCount)}
              />
              <InfoItem
                label="Device ACK"
                value={String(controlStatus.acknowledgedSequence)}
              />
              <InfoItem
                label="Device buffer"
                value={String(controlStatus.bufferedPackets)}
              />
              <InfoItem
                label="Flags"
                value={`0x${controlStatus.flags.toString(16).padStart(2, "0")}`}
              />
              <InfoItem
                label="Last command error"
                value={controlErrorLabel(controlStatus.lastCommandError)}
              />
            </View>
          ) : null}
          {protocolWarning ? (
            <ThemedText type="small" style={styles.protocolWarning}>
              {protocolWarning}
            </ThemedText>
          ) : null}

          <View style={styles.buttonRow}>
            <ActionButton
              label={isScanning ? "Scanning..." : "Scan devices"}
              onPress={scanDevices}
              disabled={isScanning || status === "connecting"}
            />
            <ActionButton
              label="Stop"
              onPress={stopScan}
              disabled={!isScanning}
              variant="secondary"
            />
            <ActionButton
              label="Refresh status"
              onPress={() => {
                void refreshControlStatus().catch(() => undefined);
              }}
              disabled={!isConnected}
              variant="secondary"
            />
          </View>

          {connectedDevice ? (
            <View style={styles.connectedBox}>
              <InfoItem label="Connected device" value={connectedDevice.name} />
              <ActionButton
                label="Disconnect"
                onPress={disconnect}
                variant="danger"
              />
            </View>
          ) : null}

          {errorMessage ? (
            <Pressable onPress={clearError} style={styles.errorBox}>
              <ThemedText type="smallBold">Error</ThemedText>
              <ThemedText type="small">{errorMessage}</ThemedText>
            </Pressable>
          ) : null}
          {parseWarning ? (
            <ThemedText type="small" style={styles.protocolWarning}>
              {parseWarning}
            </ThemedText>
          ) : null}
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Found BLE devices</ThemedText>
          {devices.length > 0 ? (
            <View style={styles.deviceList}>
              {devices.map((device) => (
                <Pressable
                  key={device.id}
                  onPress={() => connectToDevice(device.id)}
                  disabled={status === "connecting" || isConnected}
                  style={({ pressed }) => [
                    styles.deviceRow,
                    { borderColor: theme.backgroundSelected },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.deviceText}>
                    <ThemedText type="smallBold">{device.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {device.id}
                    </ThemedText>
                  </View>
                  <ThemedText type="code">
                    RSSI {device.rssi ?? "--"}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {hasScanned && !isScanning
                ? "No matching devices found. Check the name prefix and power cycle the sensor."
                : "Scan to find devices matching the configured name prefix."}
            </ThemedText>
          )}
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <ThemedText type="code" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
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
    borderRadius: 8,
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
  protocolWarning: {
    color: "#C43E3E",
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
  pressed: {
    opacity: 0.72,
  },
});
