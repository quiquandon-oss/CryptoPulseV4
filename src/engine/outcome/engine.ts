import { getDatabase } from '@/db/client';
import {
  AssetSymbol,
  Candle,
  MarketSignal,
  OutcomeHorizon,
  OutcomeState,
  PerformanceStats,
  SignalOutcome,
} from '@/types';
import { generateSignal } from '../technical/signal';
import { saveSignal } from '../technical/repository';

interface SignalOutcomeRow {
  id: string;
  signal_id: string;
  asset: string;
  signal_timestamp: number;
  horizon: string;
  initial_price: number;
  signal_direction: string;
  signal_score: number;
  mode: string;
  target_timestamp: number;
  resolution_timestamp?: number;
  actual_price?: number;
  actual_return_percent?: number;
  status: string;
  is_success?: number;
}

export function replayHistoricalSignals(
  asset: AssetSymbol,
  candles: Candle[],
  sampleIntervalHours: number = 6
): MarketSignal[] {
  if (candles.length < 60) {
    return [];
  }

  const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const replayedSignals: MarketSignal[] = [];

  const startIdx = 60;
  let previousRecentScores: number[] = [];

  for (let i = startIdx; i < sortedCandles.length; i++) {
    if (
      i < sortedCandles.length - 1 &&
      (i - startIdx) % sampleIntervalHours !== 0
    ) {
      continue;
    }

    const historicalSubSlice = sortedCandles.slice(0, i + 1);
    const signal = generateSignal(asset, historicalSubSlice, 'SIMULATED', previousRecentScores);
    const savedId = saveSignal(signal);
    signal.id = savedId;

    replayedSignals.push(signal);
    previousRecentScores = [...previousRecentScores, signal.score].slice(-5);
  }

  return replayedSignals;
}

export function resolveSignalOutcomes(
  signals: MarketSignal[],
  candles: Candle[]
): SignalOutcome[] {
  const db = getDatabase();
  const candleMap = new Map<string, Candle>();

  for (const c of candles) {
    candleMap.set(`${c.asset}_${c.timestamp}`, c);
  }

  const outcomes: SignalOutcome[] = [];
  const horizons: { horizon: OutcomeHorizon; offsetHours: number }[] = [
    { horizon: '12h', offsetHours: 12 },
    { horizon: '24h', offsetHours: 24 },
  ];

  const stmt = db.prepare(`
    INSERT INTO signal_outcomes (
      id, signal_id, asset, signal_timestamp, horizon, initial_price,
      signal_direction, signal_score, mode, target_timestamp,
      resolution_timestamp, actual_price, actual_return_percent, status, is_success, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signal_id, horizon) DO UPDATE SET
      resolution_timestamp = excluded.resolution_timestamp,
      actual_price = excluded.actual_price,
      actual_return_percent = excluded.actual_return_percent,
      status = excluded.status,
      is_success = excluded.is_success
  `);

  const now = Date.now();

  const transaction = db.transaction((items: SignalOutcome[]) => {
    for (const item of items) {
      stmt.run(
        item.id,
        item.signalId,
        item.asset,
        item.signalTimestamp,
        item.horizon,
        item.initialPrice,
        item.signalDirection,
        item.signalScore,
        item.mode,
        item.targetTimestamp,
        item.resolutionTimestamp || null,
        item.actualPrice || null,
        item.actualReturnPercent !== undefined ? item.actualReturnPercent : null,
        item.status,
        item.isSuccess !== undefined ? (item.isSuccess ? 1 : 0) : null,
        now
      );
    }
  });

  for (const signal of signals) {
    if (!signal.id) continue;

    for (const h of horizons) {
      const targetTs = signal.timestamp + h.offsetHours * 3600 * 1000;
      const targetKey = `${signal.asset}_${targetTs}`;
      const targetCandle = candleMap.get(targetKey);

      let status: OutcomeState = 'UNRESOLVED';
      let actualPrice: number | undefined;
      let actualReturnPercent: number | undefined;
      let isSuccess: boolean | undefined;
      let resolutionTimestamp: number | undefined;

      if (targetCandle) {
        status = 'RESOLVED';
        resolutionTimestamp = targetCandle.timestamp;
        actualPrice = targetCandle.close;

        actualReturnPercent =
          Math.round(((actualPrice - signal.price) / signal.price) * 10000) / 100;

        if (signal.direction === 'BULLISH') {
          isSuccess = actualReturnPercent > 0;
        } else if (signal.direction === 'BEARISH') {
          isSuccess = actualReturnPercent < 0;
        } else {
          isSuccess = Math.abs(actualReturnPercent) <= 0.5;
        }
      } else if (Date.now() < targetTs) {
        status = 'UNRESOLVED';
      } else {
        status = 'INSUFFICIENT_DATA';
      }

      const outcome: SignalOutcome = {
        id: `${signal.id}_${h.horizon}`,
        signalId: signal.id,
        asset: signal.asset,
        signalTimestamp: signal.timestamp,
        horizon: h.horizon,
        initialPrice: signal.price,
        signalDirection: signal.direction,
        signalScore: signal.score,
        mode: signal.mode,
        targetTimestamp: targetTs,
        resolutionTimestamp,
        actualPrice,
        actualReturnPercent,
        status,
        isSuccess,
      };

      outcomes.push(outcome);
    }
  }

  transaction(outcomes);
  return outcomes;
}

export function calculatePerformanceStats(
  asset: AssetSymbol | 'ALL',
  horizon: OutcomeHorizon,
  mode: 'SIMULATED' | 'LIVE' = 'SIMULATED'
): PerformanceStats {
  const db = getDatabase();
  let query = `
    SELECT * FROM signal_outcomes
    WHERE horizon = ? AND mode = ? AND status = 'RESOLVED'
  `;
  const params: unknown[] = [horizon, mode];

  if (asset !== 'ALL') {
    query += ` AND asset = ?`;
    params.push(asset);
  }

  const rows = db.prepare(query).all(...params) as SignalOutcomeRow[];
  const sampleCount = rows.length;

  if (sampleCount < 10) {
    return {
      asset,
      horizon,
      mode,
      sampleCount,
      winRatePercent: null,
      avgReturnPercent: null,
      medianReturnPercent: null,
      bestReturnPercent: null,
      worstReturnPercent: null,
      isStatisticallySufficient: false,
    };
  }

  const returns: number[] = rows
    .map((r) => Number(r.actual_return_percent))
    .filter((val) => !isNaN(val))
    .sort((a, b) => a - b);

  const wins = rows.filter((r) => r.is_success === 1).length;

  const winRatePercent = Math.round((wins / sampleCount) * 1000) / 10;
  const avgReturnPercent =
    Math.round((returns.reduce((a, b) => a + b, 0) / sampleCount) * 100) / 100;

  const mid = Math.floor(returns.length / 2);
  const medianReturnPercent =
    returns.length % 2 !== 0
      ? returns[mid]
      : Math.round(((returns[mid - 1] + returns[mid]) / 2) * 100) / 100;

  const bestReturnPercent = returns[returns.length - 1];
  const worstReturnPercent = returns[0];

  return {
    asset,
    horizon,
    mode,
    sampleCount,
    winRatePercent,
    avgReturnPercent,
    medianReturnPercent,
    bestReturnPercent,
    worstReturnPercent,
    isStatisticallySufficient: sampleCount >= 30,
  };
}
