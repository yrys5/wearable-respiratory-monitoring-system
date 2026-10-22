export type MeasurementSession = {
  deviceId: string;
  sessionId: number;
  startedAt: number;
  durationMs: number | null;
};

export function validateMeasurementDuration(durationMs: number | null) {
  if (
    durationMs !== null &&
    (!Number.isFinite(durationMs) || durationMs <= 0)
  ) {
    throw new Error("Invalid measurement duration.");
  }
}

export function measurementRemainingMs(
  session: MeasurementSession,
  now: number,
) {
  return session.durationMs === null
    ? null
    : Math.max(0, session.startedAt + session.durationMs - now);
}

export function scheduleMeasurementStop(
  session: MeasurementSession,
  onStop: () => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  validateMeasurementDuration(session.durationMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    const remaining = measurementRemainingMs(session, Date.now());
    if (remaining === null) return;
    timer = setTimeout(
      () => {
        timer = null;
        if ((measurementRemainingMs(session, Date.now()) ?? 0) > 0) {
          schedule();
        } else {
          void onStop().catch(onError);
        }
      },
      Math.min(remaining, 2_147_483_647),
    );
  };
  schedule();
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
