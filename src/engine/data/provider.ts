import { AssetSymbol, Candle, FreshnessState } from '@/types';

export interface MarketDataProvider {
  readonly name: string;
  fetchRecentCandles(asset: AssetSymbol, limit?: number): Promise<Candle[]>;
  fetchHistoricalCandles(
    asset: AssetSymbol,
    startTimestampMs: number,
    endTimestampMs: number
  ): Promise<Candle[]>;
  checkHealth(): Promise<{ isHealthy: boolean; message: string }>;
}

export function calculateFreshness(timestampMs: number, nowMs: number = Date.now()): {
  state: FreshnessState;
  ageMinutes: number;
} {
  const ageMs = Math.max(0, nowMs - timestampMs);
  const ageMinutes = Math.round(ageMs / (1000 * 60));

  if (ageMinutes <= 30) {
    return { state: 'LIVE', ageMinutes };
  } else if (ageMinutes <= 180) {
    return { state: 'RECENT', ageMinutes };
  } else if (ageMinutes <= 1440) {
    return { state: 'STALE', ageMinutes };
  } else {
    return { state: 'UNAVAILABLE', ageMinutes };
  }
}
