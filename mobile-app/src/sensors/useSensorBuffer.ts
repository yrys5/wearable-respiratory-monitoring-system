import { useCallback, useMemo, useState } from "react";

import { BLE_CONFIG } from "@/config/bleConfig";
import { ParsedStrainGaugeSample } from "@/sensors/parseStrainGaugeValue";
import {
  calculateSignalProcessorStats,
  createInitialSignalProcessorState,
  ProcessedBreathSample,
  processStrainGaugeSample,
  SignalProcessorState,
  SignalProcessorStats,
  tareSignalProcessor,
} from "@/services/breathSignalProcessor";

export type SensorBufferStats = SignalProcessorStats;

export function useSensorBuffer(maxSamples = BLE_CONFIG.SAMPLE_BUFFER_SIZE) {
  const [processorState, setProcessorState] = useState<SignalProcessorState>(
    () => createInitialSignalProcessorState(),
  );

  const addSample = useCallback(
    (sample: ParsedStrainGaugeSample) => {
      setProcessorState((currentState) =>
        processStrainGaugeSample(currentState, sample, maxSamples),
      );
    },
    [maxSamples],
  );

  const clearSamples = useCallback(() => {
    setProcessorState(createInitialSignalProcessorState());
  }, []);

  const tareBaseline = useCallback(() => {
    setProcessorState((currentState) => tareSignalProcessor(currentState));
  }, []);

  const samples = processorState.samples;
  const stats = useMemo<SensorBufferStats>(
    () => calculateSignalProcessorStats(processorState),
    [processorState],
  );

  return {
    samples,
    stats,
    addSample,
    clearSamples,
    tareBaseline,
  };
}

export type SensorSample = ProcessedBreathSample;
