import { AssetSymbol, Candle } from '@/types';
import { MarketDataProvider } from './provider';

const BINANCE_SYMBOLS: Record<AssetSymbol, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  LINK: 'LINKUSDT',
};

interface BinanceKline {
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
}

export class BinanceProvider implements MarketDataProvider {
  readonly name = 'Binance';

  async fetchRecentCandles(asset: AssetSymbol, limit: number = 100): Promise<Candle[]> {
    const symbol = BINANCE_SYMBOLS[asset];
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Binance API error: ${res.statusText} (${res.status})`);
    }

    const data = (await res.json()) as BinanceKline[];
    return this.parseKlines(data, asset);
  }

  async fetchHistoricalCandles(
    asset: AssetSymbol,
    startTimestampMs: number,
    endTimestampMs: number
  ): Promise<Candle[]> {
    const symbol = BINANCE_SYMBOLS[asset];
    const allCandles: Candle[] = [];
    let currentStart = startTimestampMs;

    while (currentStart < endTimestampMs) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${currentStart}&endTime=${endTimestampMs}&limit=1000`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });

      if (!res.ok) {
        throw new Error(`Binance historical fetch error: ${res.statusText} (${res.status})`);
      }

      const data = (await res.json()) as BinanceKline[];
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      const batch = this.parseKlines(data, asset);
      allCandles.push(...batch);

      const lastCandleTs = batch[batch.length - 1].timestamp;
      if (lastCandleTs <= currentStart) {
        break;
      }
      currentStart = lastCandleTs + 1;

      await new Promise((r) => setTimeout(r, 100));
    }

    const uniqueMap = new Map<number, Candle>();
    for (const c of allCandles) {
      uniqueMap.set(c.timestamp, c);
    }

    return Array.from(uniqueMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  async checkHealth(): Promise<{ isHealthy: boolean; message: string }> {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ping');
      if (res.ok) {
        return { isHealthy: true, message: 'Binance API reachable' };
      }
      return { isHealthy: false, message: `Binance returned status ${res.status}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Binance unreachable';
      return { isHealthy: false, message: msg };
    }
  }

  private parseKlines(klines: BinanceKline[], asset: AssetSymbol): Candle[] {
    return klines.map((k) => {
      const timestamp = Number(k[0]);
      return {
        timestamp,
        asset,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        source: this.name,
      };
    });
  }
}
