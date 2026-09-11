import React from 'react';
import Link from 'next/link';
import { NavigationHeader } from '@/components/NavigationHeader';
import { AssetCard } from '@/components/AssetCard';
import { Shield, Sparkles, AlertCircle } from 'lucide-react';

async function getMarketOverview() {
  try {
    const res = await fetch('http://localhost:3000/api/market/overview', {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const overview = await getMarketOverview();
  const assets = overview?.assets || [
    { asset: 'BTC', signal: null, freshness: { state: 'UNAVAILABLE', ageMinutes: 0 } },
    { asset: 'ETH', signal: null, freshness: { state: 'UNAVAILABLE', ageMinutes: 0 } },
    { asset: 'LINK', signal: null, freshness: { state: 'UNAVAILABLE', ageMinutes: 0 } },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      <NavigationHeader marketStatus={overview ? 'LIVE' : 'DEGRADED'} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/90 via-zinc-900/40 to-zinc-950 p-6 sm:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-medium text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" /> Deterministic Crypto Intelligence Engine
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl text-zinc-100">
                Market Pulse Terminal
              </h1>
              <p className="mt-2 text-sm text-zinc-400 max-w-2xl leading-relaxed">
                CryptoPulse V4 separates deterministic technical facts from AI explanation. No hallucinated metrics, no look-ahead bias, strict sample-size validation.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 font-mono text-xs text-zinc-400 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Architecture:</span>
                <span className="text-emerald-400 font-semibold">V4 Isolated Engine</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Database:</span>
                <span className="text-zinc-200">Independent SQLite (data/v4.db)</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">Legacy Systems:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Shield className="h-3 w-3" /> V1/V2/V3 Untouched
                </span>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-8">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
            <h2 className="font-mono text-lg font-bold tracking-wider text-zinc-200">
              Supported Asset Signals
            </h2>
            <span className="font-mono text-xs text-zinc-500">
              Auto-refreshed hourly
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            {assets.map((item: { asset: string; signal: any; freshness: any }) => (
              <AssetCard
                key={item.asset}
                asset={item.asset}
                signal={item.signal}
                freshness={item.freshness}
              />
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-6">
          <h3 className="font-mono text-sm font-bold text-zinc-200 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-emerald-400" /> V4 Data & Methodology Principles
          </h3>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs text-zinc-400">
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-950/40">
              <span className="font-bold text-zinc-200 block mb-1">Deterministic Facts</span>
              Indicator values, agreement ratios, and market regime labels are derived strictly by mathematical code.
            </div>
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-950/40">
              <span className="font-bold text-zinc-200 block mb-1">Zero Look-Ahead Bias</span>
              Historical signal replays utilize point-in-time candle slicing (only data available at time T).
            </div>
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-950/40">
              <span className="font-bold text-zinc-200 block mb-1">Statistically Grounded</span>
              Historical win rates and returns require N &ge; 30 resolved observations before claiming significance.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
