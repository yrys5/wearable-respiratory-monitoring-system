import {
  BASELINE_ALPHA,
  BREATH_THRESHOLD,
  FILTER_ALPHA,
  MIN_BREATH_INTERVAL_MS,
  OUTLIER_THRESHOLD,
  SAMPLE_BUFFER_SIZE,
  SAMPLE_BUFFER_WINDOW_MS,
} from "@/config/bleConfig";
import { ParsedStrainGaugeSample } from "@/sensors/parseStrainGaugeValue";

const BREATH_RATE_WINDOW_MS = 20000;
const BREATH_RATE_INTERVAL_LIMIT = 5;
const MAX_BREATH_INTERVAL_MS = 10000;
const TARE_WINDOW_MS = 5000;

export type ProcessedBreathSample = {
  timestamp: number;
  deviceTimestampMs: number;
  sequence: number;
  sessionId: number;
  raw1: number;
  baseline1: number;
  signal1: number;
  filtered1: number;
  raw2: number;
  baseline2: number;
  signal2: number;
  filtered2: number;
  filteredCombined: number;
};

export type SignalProcessorBreathState = {
  estimatedBpm: number | null;
  detectedBreathCount: number;
  lastBreathTimestamp: number | null;
  recentBreathTimestamps: number[];
};

export type SignalProcessorState = {
  samples: ProcessedBreathSample[];
  packetCount: number;
  acceptedSampleCount: number;
  rejectedSampleCount: number;
  previousRaw1: number | null;
  previousRaw2: number | null;
  previousFiltered1: number | null;
  previousFiltered2: number | null;
  previousCombinedTrend: "rising" | "falling" | null;
  baseline1: number | null;
  baseline2: number | null;
  breaths: SignalProcessorBreathState;
};

export type SignalProcessorStats = {
  packetCount: number;
  acceptedSampleCount: number;
  rejectedSampleCount: number;
  currentRaw1: number | null;
  currentRaw2: number | null;
  baseline1: number | null;
  baseline2: number | null;
  signal1: number | null;
  signal2: number | null;
  filtered1: number | null;
  filtered2: number | null;
  minRaw1: number | null;
  maxRaw1: number | null;
  minRaw2: number | null;
  maxRaw2: number | null;
  peakToPeakRaw1: number | null;
  peakToPeakRaw2: number | null;
  lastSampleTimestamp: number | null;
  estimatedBpm: number | null;
  detectedBreathCount: number;
  lastBreathTimestamp: number | null;
};

export function createInitialSignalProcessorState(): SignalProcessorState {
  return {
    samples: [],
    packetCount: 0,
    acceptedSampleCount: 0,
    rejectedSampleCount: 0,
    previousRaw1: null,
    previousRaw2: null,
    previousFiltered1: null,
    previousFiltered2: null,
    previousCombinedTrend: null,
    baseline1: null,
    baseline2: null,
    breaths: {
      estimatedBpm: null,
      detectedBreathCount: 0,
      lastBreathTimestamp: null,
      recentBreathTimestamps: [],
    },
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pruneSamples(
  samples: ProcessedBreathSample[],
  now: number,
  maxSamples: number,
) {
  const windowStart = now - SAMPLE_BUFFER_WINDOW_MS;
  return samples
    .filter((sample) => sample.timestamp >= windowStart)
    .slice(-maxSamples);
}

function calculateEstimatedBpm(timestamps: number[]) {
  if (timestamps.length < 2) {
    return null;
  }

  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter(
      (interval) =>
        interval >= MIN_BREATH_INTERVAL_MS &&
        interval <= MAX_BREATH_INTERVAL_MS,
    )
    .slice(-BREATH_RATE_INTERVAL_LIMIT);

  return intervals.length > 0 ? 60000 / average(intervals) : null;
}

function updateBreathState(
  state: SignalProcessorState,
  previousSample: ProcessedBreathSample | null,
  currentSample: ProcessedBreathSample,
  nextTrend: SignalProcessorState["previousCombinedTrend"],
) {
  const recentBreathTimestamps = state.breaths.recentBreathTimestamps.filter(
    (timestamp) => currentSample.timestamp - timestamp <= BREATH_RATE_WINDOW_MS,
  );

  if (
    !previousSample ||
    state.previousCombinedTrend !== "rising" ||
    nextTrend !== "falling"
  ) {
    return {
      ...state.breaths,
      recentBreathTimestamps,
      estimatedBpm: calculateEstimatedBpm(recentBreathTimestamps),
    };
  }

  const isPeakHighEnough = previousSample.filteredCombined >= BREATH_THRESHOLD;
  const lastBreathTimestamp = state.breaths.lastBreathTimestamp;
  const isFarEnoughFromLastBreath =
    lastBreathTimestamp === null ||
    previousSample.timestamp - lastBreathTimestamp >= MIN_BREATH_INTERVAL_MS;

  if (!isPeakHighEnough || !isFarEnoughFromLastBreath) {
    return {
      ...state.breaths,
      recentBreathTimestamps,
      estimatedBpm: calculateEstimatedBpm(recentBreathTimestamps),
    };
  }

  const nextRecentBreathTimestamps = [
    ...recentBreathTimestamps,
    previousSample.timestamp,
  ];

  return {
    estimatedBpm: calculateEstimatedBpm(nextRecentBreathTimestamps),
    detectedBreathCount: state.breaths.detectedBreathCount + 1,
    lastBreathTimestamp: previousSample.timestamp,
    recentBreathTimestamps: nextRecentBreathTimestamps,
  };
}

export function processStrainGaugeSample(
  state: SignalProcessorState,
  sample: ParsedStrainGaugeSample,
  maxSamples = SAMPLE_BUFFER_SIZE,
): SignalProcessorState {
  const packetCount = state.packetCount + 1;
  const raw1 = sample.numericValue;
  const raw2 = sample.secondaryValue;

  if (
    raw1 === null ||
    raw2 === null ||
    sample.sequence === null ||
    sample.sessionId === null ||
    sample.deviceTimestampMs === null
  ) {
    return {
      ...state,
      packetCount,
      rejectedSampleCount: state.rejectedSampleCount + 1,
    };
  }

  const isOutlier =
    (state.previousRaw1 !== null &&
      Math.abs(raw1 - state.previousRaw1) > OUTLIER_THRESHOLD) ||
    (state.previousRaw2 !== null &&
      Math.abs(raw2 - state.previousRaw2) > OUTLIER_THRESHOLD);

  if (isOutlier) {
    return {
      ...state,
      packetCount,
      rejectedSampleCount: state.rejectedSampleCount + 1,
    };
  }

  const baseline1 =
    state.baseline1 === null
      ? raw1
      : BASELINE_ALPHA * raw1 + (1 - BASELINE_ALPHA) * state.baseline1;
  const baseline2 =
    state.baseline2 === null
      ? raw2
      : BASELINE_ALPHA * raw2 + (1 - BASELINE_ALPHA) * state.baseline2;
  const signal1 = raw1 - baseline1;
  const signal2 = raw2 - baseline2;
  const filtered1 =
    state.previousFiltered1 === null
      ? signal1
      : FILTER_ALPHA * signal1 + (1 - FILTER_ALPHA) * state.previousFiltered1;
  const filtered2 =
    state.previousFiltered2 === null
      ? signal2
      : FILTER_ALPHA * signal2 + (1 - FILTER_ALPHA) * state.previousFiltered2;
  const filteredCombined = filtered1 + filtered2;
  const processedSample: ProcessedBreathSample = {
    timestamp: sample.timestamp,
    deviceTimestampMs: sample.deviceTimestampMs,
    sequence: sample.sequence,
    sessionId: sample.sessionId,
    raw1,
    baseline1,
    signal1,
    filtered1,
    raw2,
    baseline2,
    signal2,
    filtered2,
    filteredCombined,
  };
  const previousSample = state.samples.at(-1) ?? null;
  const nextTrend =
    state.previousFiltered1 === null || state.previousFiltered2 === null
      ? null
      : filteredCombined > state.previousFiltered1 + state.previousFiltered2
        ? "rising"
        : filteredCombined < state.previousFiltered1 + state.previousFiltered2
          ? "falling"
          : state.previousCombinedTrend;
  const breaths = updateBreathState(
    state,
    previousSample,
    processedSample,
    nextTrend,
  );

  return {
    ...state,
    samples: pruneSamples(
      [...state.samples, processedSample],
      sample.timestamp,
      maxSamples,
    ),
    packetCount,
    acceptedSampleCount: state.acceptedSampleCount + 1,
    previousRaw1: raw1,
    previousRaw2: raw2,
    previousFiltered1: filtered1,
    previousFiltered2: filtered2,
    previousCombinedTrend: nextTrend,
    baseline1,
    baseline2,
    breaths,
  };
}

export function tareSignalProcessor(
  state: SignalProcessorState,
): SignalProcessorState {
  const lastSample = state.samples.at(-1);

  if (!lastSample) {
    return state;
  }

  const windowStart = lastSample.timestamp - TARE_WINDOW_MS;
  const tareSamples = state.samples.filter(
    (sample) => sample.timestamp >= windowStart,
  );
  const baseline1 = average(tareSamples.map((sample) => sample.raw1));
  const baseline2 = average(tareSamples.map((sample) => sample.raw2));
  let previousFiltered1: number | null = null;
  let previousFiltered2: number | null = null;
  const retunedSamples = state.samples.map((sample) => {
    const signal1 = sample.raw1 - baseline1;
    const signal2 = sample.raw2 - baseline2;
    const filtered1 =
      previousFiltered1 === null
        ? signal1
        : FILTER_ALPHA * signal1 + (1 - FILTER_ALPHA) * previousFiltered1;
    const filtered2 =
      previousFiltered2 === null
        ? signal2
        : FILTER_ALPHA * signal2 + (1 - FILTER_ALPHA) * previousFiltered2;

    previousFiltered1 = filtered1;
    previousFiltered2 = filtered2;

    return {
      ...sample,
      baseline1,
      signal1,
      filtered1,
      baseline2,
      signal2,
      filtered2,
      filteredCombined: filtered1 + filtered2,
    };
  });

  return {
    ...state,
    baseline1,
    baseline2,
    previousFiltered1: retunedSamples.at(-1)?.filtered1 ?? 0,
    previousFiltered2: retunedSamples.at(-1)?.filtered2 ?? 0,
    previousCombinedTrend: null,
    samples: retunedSamples,
  };
}

export function calculateSignalProcessorStats(
  state: SignalProcessorState,
): SignalProcessorStats {
  const samples = state.samples;
  const lastSample = samples.at(-1) ?? null;
  const rawValues1 = samples.map((sample) => sample.raw1);
  const rawValues2 = samples.map((sample) => sample.raw2);
  const minRaw1 = rawValues1.length > 0 ? Math.min(...rawValues1) : null;
  const maxRaw1 = rawValues1.length > 0 ? Math.max(...rawValues1) : null;
  const minRaw2 = rawValues2.length > 0 ? Math.min(...rawValues2) : null;
  const maxRaw2 = rawValues2.length > 0 ? Math.max(...rawValues2) : null;

  return {
    packetCount: state.packetCount,
    acceptedSampleCount: state.acceptedSampleCount,
    rejectedSampleCount: state.rejectedSampleCount,
    currentRaw1: lastSample?.raw1 ?? null,
    currentRaw2: lastSample?.raw2 ?? null,
    baseline1: lastSample?.baseline1 ?? state.baseline1,
    baseline2: lastSample?.baseline2 ?? state.baseline2,
    signal1: lastSample?.signal1 ?? null,
    signal2: lastSample?.signal2 ?? null,
    filtered1: lastSample?.filtered1 ?? null,
    filtered2: lastSample?.filtered2 ?? null,
    minRaw1,
    maxRaw1,
    minRaw2,
    maxRaw2,
    peakToPeakRaw1:
      minRaw1 === null || maxRaw1 === null ? null : maxRaw1 - minRaw1,
    peakToPeakRaw2:
      minRaw2 === null || maxRaw2 === null ? null : maxRaw2 - minRaw2,
    lastSampleTimestamp: lastSample?.timestamp ?? null,
    estimatedBpm: state.breaths.estimatedBpm,
    detectedBreathCount: state.breaths.detectedBreathCount,
    lastBreathTimestamp: state.breaths.lastBreathTimestamp,
  };
}
