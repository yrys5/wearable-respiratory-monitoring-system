export type ChartPoint = { x: number; y: number };

export function normalizeChannel(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  return values.map((value) =>
    range === 0 ? 0 : (2 * (value - min)) / range - 1,
  );
}

export function buildNormalizedChannelPoints(
  values: number[],
  chartWidth: number,
  chartHeight: number,
  padding: number,
  channel: 0 | 1,
): ChartPoint[] {
  const centerY = chartHeight * (channel === 0 ? 0.25 : 0.75);
  const amplitude = Math.max(0, chartHeight / 4 - padding);
  const usableWidth = Math.max(0, chartWidth - padding * 2);
  return normalizeChannel(values).map((value, index) => ({
    x:
      padding +
      (values.length === 1 ? 1 : index / (values.length - 1)) * usableWidth,
    y: centerY - value * amplitude,
  }));
}
