import { useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { SAMPLE_BUFFER_SIZE } from "@/config/bleConfig";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ProcessedBreathSample } from "@/services/breathSignalProcessor";
import { buildNormalizedChannelPoints } from "@/services/normalizedChart";

const CHART_HEIGHT = 180;
const CHART_PADDING = 12;
const CHANNEL_1_COLOR = "#1769E0";
const CHANNEL_2_COLOR = "#E0821A";

export type SensorChartMode = "raw" | "signal" | "filtered" | "normalized";

const MODE_FIELDS: Record<
  SensorChartMode,
  {
    channel1: keyof ProcessedBreathSample;
    channel2: keyof ProcessedBreathSample;
  }
> = {
  raw: { channel1: "raw1", channel2: "raw2" },
  signal: { channel1: "signal1", channel2: "signal2" },
  filtered: { channel1: "filtered1", channel2: "filtered2" },
  normalized: { channel1: "filtered1", channel2: "filtered2" },
};

type ChartPoint = {
  x: number;
  y: number;
};

function formatAxisValue(value: number | null) {
  return value === null ? "--" : Math.round(value).toString();
}

function buildLineSegments(
  points: ChartPoint[],
  color: string,
  showSinglePoint = false,
) {
  if (showSinglePoint && points.length === 1) {
    return [
      {
        key: "point",
        left: points[0].x - 1,
        top: points[0].y - 1,
        width: 2,
        rotate: "0deg",
        color,
      },
    ];
  }
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    return {
      key: `${index}-${Math.round(point.x)}-${Math.round(point.y)}`,
      left: (previous.x + point.x - length) / 2,
      top: (previous.y + point.y) / 2,
      width: length,
      rotate: `${angle}deg`,
      color,
    };
  });
}

function buildChannelPoints(
  values: number[],
  paddedMin: number,
  paddedRange: number,
  chartWidth: number,
) {
  const usableWidth = Math.max(0, chartWidth - CHART_PADDING * 2);
  const usableHeight = CHART_HEIGHT - CHART_PADDING * 2;

  return values.map((value, index) => {
    const progress = values.length === 1 ? 1 : index / (values.length - 1);

    return {
      x: CHART_PADDING + progress * usableWidth,
      y:
        CHART_PADDING +
        ((paddedMin + paddedRange - value) / paddedRange) * usableHeight,
    };
  });
}

export function SensorChart({
  samples,
  mode,
}: {
  samples: ProcessedBreathSample[];
  mode: SensorChartMode;
}) {
  const theme = useTheme();
  const [chartWidth, setChartWidth] = useState(0);
  const visibleSamples = useMemo(
    () => samples.slice(-SAMPLE_BUFFER_SIZE),
    [samples],
  );

  const chartData = useMemo(() => {
    if (visibleSamples.length === 0 || chartWidth === 0) {
      return {
        segments1: [],
        segments2: [],
        maxValue: null,
        minValue: null,
        referenceY: null,
      };
    }

    const { channel1, channel2 } = MODE_FIELDS[mode];
    const values1 = visibleSamples.map((sample) => sample[channel1] as number);
    const values2 = visibleSamples.map((sample) => sample[channel2] as number);
    if (mode === "normalized") {
      return {
        segments1: buildLineSegments(
          buildNormalizedChannelPoints(
            values1,
            chartWidth,
            CHART_HEIGHT,
            CHART_PADDING,
            0,
          ),
          CHANNEL_1_COLOR,
          true,
        ),
        segments2: buildLineSegments(
          buildNormalizedChannelPoints(
            values2,
            chartWidth,
            CHART_HEIGHT,
            CHART_PADDING,
            1,
          ),
          CHANNEL_2_COLOR,
          true,
        ),
        minValue: -1,
        maxValue: 1,
        referenceY: null,
      };
    }
    const referenceValue =
      mode === "raw"
        ? ((visibleSamples.at(-1)?.baseline1 ?? 0) +
            (visibleSamples.at(-1)?.baseline2 ?? 0)) /
          2
        : 0;
    const minValue = Math.min(...values1, ...values2, referenceValue);
    const maxValue = Math.max(...values1, ...values2, referenceValue);
    const range = Math.max(1, maxValue - minValue);
    const paddedMin = minValue - range * 0.1;
    const paddedMax = maxValue + range * 0.1;
    const paddedRange = paddedMax - paddedMin;

    const points1 = buildChannelPoints(
      values1,
      paddedMin,
      paddedRange,
      chartWidth,
    );
    const points2 = buildChannelPoints(
      values2,
      paddedMin,
      paddedRange,
      chartWidth,
    );

    return {
      segments1: buildLineSegments(points1, CHANNEL_1_COLOR),
      segments2: buildLineSegments(points2, CHANNEL_2_COLOR),
      maxValue,
      minValue,
      referenceY:
        CHART_PADDING +
        ((paddedMax - referenceValue) / paddedRange) *
          (CHART_HEIGHT - CHART_PADDING * 2),
    };
  }, [chartWidth, mode, visibleSamples]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setChartWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: CHANNEL_1_COLOR }]}
          />
          <ThemedText type="code" themeColor="textSecondary">
            {mode === "normalized" ? "CH1" : "CH1"}
          </ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: CHANNEL_2_COLOR }]}
          />
          <ThemedText type="code" themeColor="textSecondary">
            {mode === "normalized" ? "CH2" : "CH2"}
          </ThemedText>
        </View>
      </View>

      <View
        onLayout={handleLayout}
        style={[
          styles.chart,
          {
            backgroundColor: theme.background,
            borderColor: theme.backgroundSelected,
          },
        ]}
      >
        <View
          style={[
            styles.gridLine,
            styles.gridLineTop,
            { backgroundColor: theme.backgroundSelected },
          ]}
        />
        <View
          style={[
            styles.gridLine,
            styles.gridLineMiddle,
            { backgroundColor: theme.backgroundSelected },
          ]}
        />
        <View
          style={[
            styles.gridLine,
            styles.gridLineBottom,
            { backgroundColor: theme.backgroundSelected },
          ]}
        />

        {chartData.referenceY !== null ? (
          <View
            style={[
              styles.baseline,
              {
                top: chartData.referenceY,
                backgroundColor: theme.backgroundSelected,
              },
            ]}
          />
        ) : null}

        {chartData.segments1.map((segment) => (
          <View
            key={`ch1-${segment.key}`}
            style={[
              styles.segment,
              {
                left: segment.left,
                top: segment.top,
                width: segment.width,
                backgroundColor: segment.color,
                transform: [{ rotate: segment.rotate }],
              },
            ]}
          />
        ))}

        {chartData.segments2.map((segment) => (
          <View
            key={`ch2-${segment.key}`}
            style={[
              styles.segment,
              {
                left: segment.left,
                top: segment.top,
                width: segment.width,
                backgroundColor: segment.color,
                transform: [{ rotate: segment.rotate }],
              },
            ]}
          />
        ))}

        {visibleSamples.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText type="small" themeColor="textSecondary">
              Waiting for processed samples
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.axisRow}>
        <ThemedText type="code" themeColor="textSecondary">
          min {formatAxisValue(chartData.minValue)}
        </ThemedText>
        <ThemedText type="code" themeColor="textSecondary">
          {mode} last {visibleSamples.length}
        </ThemedText>
        <ThemedText type="code" themeColor="textSecondary">
          max {formatAxisValue(chartData.maxValue)}
        </ThemedText>
      </View>
      {/* {mode === 'normalized' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Filtered channels scaled independently to −1…1 in the visible window.
        </ThemedText>
      ) : null} */}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
  },
  legendRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.half,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chart: {
    height: CHART_HEIGHT,
    overflow: "hidden",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  gridLine: {
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.7,
    position: "absolute",
  },
  gridLineTop: {
    top: "25%",
  },
  gridLineMiddle: {
    top: "50%",
  },
  gridLineBottom: {
    top: "75%",
  },
  baseline: {
    height: 2,
    left: 0,
    opacity: 0.75,
    position: "absolute",
    right: 0,
  },
  segment: {
    height: 2,
    position: "absolute",
  },
  emptyState: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
});
