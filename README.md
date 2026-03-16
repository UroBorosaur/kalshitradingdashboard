# Trading Analytics Dashboard

Production-style dark-mode trading analytics web app built with Next.js App Router, TypeScript, Tailwind, shadcn-style components, Recharts, Zustand, and Framer Motion.

## Stack
- Next.js 16 App Router (compatible with 14+ requirements)
- TypeScript
- Tailwind CSS
- shadcn-style component primitives (Radix + CVA pattern)
- Recharts
- Zustand (persisted UI state)
- Framer Motion

## Run Locally

```bash
cd /Users/aa/Desktop/Projects/trading-analytics-dashboard
npm install
cp .env.example .env.local
# fill ALPACA_API_KEY + ALPACA_API_SECRET
npm run dev
```

Open `http://localhost:3000`.

## Pages
- `/` Main Dashboard
- `/trades` Trades Page
- `/setups` Setups Page
- `/regime-analysis` Regime Analysis Page
- `/game-theory-engine` Game Theory Engine Page

## Data + Logic
- Mock data: `src/lib/mock-data.ts`
- Metrics engine: `src/lib/metrics.ts`
- Game theory engine: `src/lib/game-theory.ts`
- UI state store: `src/store/dashboard-store.ts`
- Alpaca live integration: `src/lib/live/alpaca.ts`
- Live data mapping: `src/lib/live/mappers.ts`
- Live API routes: `src/app/api/live/*`
- TradingView webhook route: `src/app/api/tradingview/webhook/route.ts`

## Live Data + Paper Trading
This app supports a live mode using **Alpaca Paper Trading** (free account).

1. Create an Alpaca account and generate paper API keys.
2. Set env vars in `.env.local`:
   - `ALPACA_API_KEY`
   - `ALPACA_API_SECRET`
   - `ALPACA_BASE_URL` (supports both `https://paper-api.alpaca.markets` and `https://paper-api.alpaca.markets/v2`)
3. In the dashboard, switch from `Mock` to `Live (Alpaca)` using the top toggle.
4. Use the `Live Broker Connection` panel to:
   - refresh broker state
   - submit paper orders
   - close a position

## Prediction Market Auto-Trader
The Game Theory Engine page now includes a one-click automation panel for prediction markets:
- categories: `BITCOIN`, `SPORTS`, `WEATHER`
- risk modes: `Conservative`, `Mixed`, `Aggressive`
- execution modes: simulation or live placement on Kalshi demo
- optional auto-loop cadence

### Kalshi demo setup (optional for live execution)
Set these in `.env.local`:
- `KALSHI_API_BASE_URL=https://demo-api.kalshi.co/trade-api/v2`
- `KALSHI_MARKET_DATA_BASE_URL=https://demo-api.kalshi.co/trade-api/v2`
- `KALSHI_KEY_ID=...`
- `KALSHI_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----`
- or `KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/kalshi-private-key.pem`

If Kalshi credentials are not set, the auto-trader still runs in simulation mode and returns candidate trades with sizing/EV estimates.
When Kalshi credentials are valid, executed Kalshi orders are ingested into Live mode and appear in the Trades panel.

### Automation API
- Endpoint: `POST /api/automation/run`
- Body:
```json
{
  "mode": "MIXED",
  "execute": false,
  "categories": ["BITCOIN", "SPORTS", "WEATHER"]
}
```

## TradingView Integration
TradingView Premium does not expose a direct personal account API for pulling dashboard data, so integration is done via alert webhooks.

- Endpoint: `POST /api/tradingview/webhook`
- Suggested alert payload:

```json
{
  "passphrase": "change_me",
  "symbol": "AAPL",
  "side": "buy",
  "qty": 1,
  "type": "market",
  "time_in_force": "day"
}
```

Set `TRADINGVIEW_WEBHOOK_PASSPHRASE` in `.env.local` and use the same passphrase in TradingView alert JSON.

## Backend/API Swap Points
Replace mock data with API calls in these places:
1. `src/hooks/use-dashboard-data.ts`
- Replace `mockData` references with data from server actions, route handlers, or React Query.

2. `src/lib/mock-data.ts`
- Keep type shapes, remove generator, and hydrate from backend DTOs.

3. Trade details and monthly stats
- The UI components already consume typed objects; no UI refactor needed when switching to real data.

## Notes
- The Game Theory Engine includes practical opponent/regime modeling, mixed-strategy sizing, Bayesian belief updates, robust risk posture, exploit/equilibrium recommendations, and explicit no-trade recommendations.
- Target outcomes (e.g. turning $100 to $1000 in a week) are modeled probabilistically, not guaranteed.
