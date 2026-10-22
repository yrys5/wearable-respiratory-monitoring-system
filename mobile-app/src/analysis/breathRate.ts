import { SensorSample } from "@/sensors/parseStrainGaugeValue";

const MIN_SAMPLES_FOR_ANALYSIS = 30;
const RECENT_SAMPLE_LIMIT = 240;
const SMOOTHING_RADIUS = 3;
const MIN_PEAK_INTERVAL_MS = 1500;
const MAX_PEAK_INTERVAL_MS = 8000;

type NumericPoint = {
  value: number;
  timestamp: number;
};

export type BreathAnalysis = {
  breathsPerMinute: number | null;
  baseline: number | null;
  lastDelta: number | null;
  amplitude: number | null;
  peakCount: number;
  sampleCount: number;
};

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toNumericPoints(samples: SensorSample[]) {
  return samples
    .filter(
      (sample): sample is SensorSample & { numericValue: number } =>
        sample.numericValue !== null,
    )
    .map((sample) => ({
      value: sample.numericValue,
      timestamp: sample.timestamp,
    }));
}

function smoothPoints(points: NumericPoint[]) {
  return points.map((point, index) => {
    const start = Math.max(0, index - SMOOTHING_RADIUS);
    const end = Math.min(points.length, index + SMOOTHING_RADIUS + 1);
    const values = points
      .slice(start, end)
      .map((currentPoint) => currentPoint.value);

    return {
      ...point,
      value: average(values),
    };
  });
}

function findExtrema(
  points: NumericPoint[],
  baseline: number,
  minProminence: number,
  kind: "peak" | "valley",
) {
  const extrema: NumericPoint[] = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const isPeak =
      kind === "peak" &&
      current.value >= previous.value &&
      current.value > next.value &&
      current.value - baseline >= minProminence;
    const isValley =
      kind === "valley" &&
      current.value <= previous.value &&
      current.value < next.value &&
      baseline - current.value >= minProminence;

    if (!isPeak && !isValley) {
      continue;
    }

    const lastExtremum = extrema.at(-1);

    if (
      !lastExtremum ||
      current.timestamp - lastExtremum.timestamp >= MIN_PEAK_INTERVAL_MS
    ) {
      extrema.push(current);
      continue;
    }

    const currentIsStronger =
      kind === "peak"
        ? current.value > lastExtremum.value
        : current.value < lastExtremum.value;

    if (currentIsStronger) {
      extrema[extrema.length - 1] = current;
    }
  }

  return extrema;
}

function bpmFromExtrema(extrema: NumericPoint[]) {
  if (extrema.length < 2) {
    return null;
  }

  const intervals = extrema
    .slice(1)
    .map((point, index) => point.timestamp - extrema[index].timestamp)
    .filter(
      (interval) =>
        interval >= MIN_PEAK_INTERVAL_MS && interval <= MAX_PEAK_INTERVAL_MS,
    );

  if (intervals.length === 0) {
    return null;
  }

  return 60000 / average(intervals);
}

export function calculateBreathAnalysis(
  samples: SensorSample[],
): BreathAnalysis {
  const numericPoints = toNumericPoints(samples).slice(-RECENT_SAMPLE_LIMIT);
  const sampleCount = numericPoints.length;

  if (sampleCount === 0) {
    return {
      breathsPerMinute: null,
      baseline: null,
      lastDelta: null,
      amplitude: null,
      peakCount: 0,
      sampleCount,
    };
  }

  const values = numericPoints.map((point) => point.value);
  const baseline = average(values);
  const lastDelta = numericPoints.at(-1)?.value ?? null;
  const amplitude = Math.max(...values) - Math.min(...values);

  if (sampleCount < MIN_SAMPLES_FOR_ANALYSIS || amplitude < 1) {
    return {
      breathsPerMinute: null,
      baseline,
      lastDelta: lastDelta === null ? null : lastDelta - baseline,
      amplitude,
      peakCount: 0,
      sampleCount,
    };
  }

  const smoothedPoints = smoothPoints(numericPoints);
  const minProminence = Math.max(250, amplitude * 0.12);
  const peaks = findExtrema(smoothedPoints, baseline, minProminence, "peak");
  const valleys = findExtrema(
    smoothedPoints,
    baseline,
    minProminence,
    "valley",
  );
  const peakBpm = bpmFromExtrema(peaks);
  const valleyBpm = bpmFromExtrema(valleys);
  const preferredExtrema = peaks.length >= valleys.length ? peaks : valleys;

  return {
    breathsPerMinute: peakBpm ?? valleyBpm,
    baseline,
    lastDelta: lastDelta === null ? null : lastDelta - baseline,
    amplitude,
    peakCount: preferredExtrema.length,
    sampleCount,
  };
}

export function calculateBreathsPerMinute(
  samples: SensorSample[],
): number | null {
  return calculateBreathAnalysis(samples).breathsPerMinute;
}
