export type AssetSymbol = 'BTC' | 'ETH' | 'LINK';

export type FreshnessState = 'LIVE' | 'RECENT' | 'STALE' | 'UNAVAILABLE';

export type MarketRegimeType =
  | 'TRENDING_BULLISH'
  | 'TRENDING_BEARISH'
  | 'RANGE_BOUND'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITION'
  | 'UNKNOWN';

export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type SignalMode = 'LIVE' | 'SIMULATED';

export type OutcomeHorizon = '12h' | '24h';

export type OutcomeState = 'GENERATED' | 'RESOLVED' | 'UNRESOLVED' | 'INSUFFICIENT_DATA';

export interface Candle {
  timestamp: number; // Unix timestamp in ms
  asset: AssetSymbol;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

export interface IndicatorResult {
  rsi: {
    value: number;
    state: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
    interpretation: string;
    bias: SignalDirection;
  };
  sma: {
    sma20: number;
    sma50: number;
    priceVsSma20Ratio: number;
    slope: 'RISING' | 'FALLING' | 'FLAT';
    interpretation: string;
    bias: SignalDirection;
  };
  ema: {
    ema12: number;
    ema26: number;
    cross: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    interpretation: string;
    bias: SignalDirection;
  };
  ichimoku: {
    tenkan: number;
    kijun: number;
    senkouA: number;
    senkouB: number;
    priceVsCloud: 'ABOVE' | 'BELOW' | 'INSIDE';
    cloudColor: 'BULLISH' | 'BEARISH';
    interpretation: string;
    bias: SignalDirection;
  };
  momentum: {
    roc: number;
    macd: number;
    macdSignal: number;
    macdHist: number;
    interpretation: string;
    bias: SignalDirection;
  };
  volatility: {
    atr: number;
    bollingerUpper: number;
    bollingerLower: number;
    bollingerMiddle: number;
    state: 'HIGH' | 'LOW' | 'NORMAL';
    interpretation: string;
  };
}

export interface SignalAgreement {
  totalIndicators: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  agreementRatio: number; // e.g. 4/5 = 0.8
  evidenceStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONFLICTED';
}

export interface MarketSignal {
  id?: string;
  asset: AssetSymbol;
  timestamp: number;
  mode: SignalMode;
  direction: SignalDirection;
  score: number; // -2 to +2
  evidence: SignalAgreement;
  regime: MarketRegimeType;
  indicators: IndicatorResult;
  persistence: {
    consecutiveEvaluations: number;
    isStable: boolean;
    historyRecentScores: number[];
  };
  price: number;
  source: string;
}

export interface SignalOutcome {
  id?: string;
  signalId: string;
  asset: AssetSymbol;
  signalTimestamp: number;
  horizon: OutcomeHorizon;
  initialPrice: number;
  signalDirection: SignalDirection;
  signalScore: number;
  mode: SignalMode;
  targetTimestamp: number;
  resolutionTimestamp?: number;
  actualPrice?: number;
  actualReturnPercent?: number;
  status: OutcomeState;
  isSuccess?: boolean;
}

export interface PerformanceStats {
  asset: AssetSymbol | 'ALL';
  horizon: OutcomeHorizon;
  mode: SignalMode;
  sampleCount: number;
  winRatePercent: number | null;
  avgReturnPercent: number | null;
  medianReturnPercent: number | null;
  bestReturnPercent: number | null;
  worstReturnPercent: number | null;
  isStatisticallySufficient: boolean; // true if sampleCount >= 30
}

export interface SystemComponentHealth {
  status: 'OK' | 'DEGRADED' | 'ERROR';
  message: string;
  lastUpdated: number;
}

export interface SystemHealth {
  marketData: SystemComponentHealth;
  technicalEngine: SystemComponentHealth;
  database: SystemComponentHealth;
  aiExplanation: SystemComponentHealth;
  overallStatus: 'LIVE' | 'DEGRADED' | 'OFFLINE';
  lastEvaluationTimestamp: number;
  staleAssets: AssetSymbol[];
}

export interface AIExplanation {
  asset: AssetSymbol;
  timestamp: number;
  provider: 'DETERMINISTIC' | 'LLM';
  summary: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  keyRisks: string[];
  invalidationConditions: string[];
}
