# CryptoPulse V4 Terminal

CryptoPulse V4 is a modern, transparent, deterministic crypto intelligence terminal and market signal engine built with Next.js, React, TypeScript, Tailwind CSS, and SQLite (`better-sqlite3`).

---

## 🔒 Non-Negotiable System Isolation

CryptoPulse V1, V2, and V3 are frozen legacy systems. V4 is a completely independent application:
- **Database**: Strictly isolated local SQLite database at `data/v4.db`.
- **Zero Legacy Writes**: V4 never writes to or alters V1/V2/V3 production databases, D1 schemas, cron schedules, or scoring logic.

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- Node.js 20+ installed on your machine.

### Installation & Execution

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

3. **Run Production Build**:
   ```bash
   npm run build
   npm start
   ```

4. **Run Test Suite & Quality Checks**:
   ```bash
   npm test        # Runs Vitest unit tests (15/15 passing)
   npm run typecheck
   npm run lint
   ```

---

## 📊 Historical Data Backfill

To initialize 90 days of hourly candle data for BTC, ETH, and LINK, run the technical replay backfill:

```bash
curl -X POST http://localhost:3000/api/backfill
```

Replayed signals are strictly marked as `SIMULATED / BACKTEST` with zero look-ahead bias (only candles $\le T$ are processed at historical timestamp $T$).

---

## 🛠 Deployment Options

For full deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### 1. Node.js Server / VPS (Recommended for SQLite)
Since V4 uses native `better-sqlite3` for zero-config isolation, running on any Node.js host (Docker, Railway, Render, Fly.io, or Ubuntu VPS) works out of the box:

```bash
npm run build
npm start
```

### 2. Environment Configuration (Optional LLM)
Create a `.env` file to configure optional AI explanation capabilities:

```env
LLM_API_KEY=your_optional_llm_api_key
```

If no API key is provided, CryptoPulse V4 automatically uses its deterministic, fact-grounded text builder.
