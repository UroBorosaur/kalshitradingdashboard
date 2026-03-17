# Kalshi Trading Dashboard

Prediction-market execution and analytics platform built around Kalshi-style binary and binned contracts.

This project combines:
- WebSocket-first market state ingestion
- rulebook-aware pricing and structural coherence logic
- queue-reactive execution planning
- exchange-native hard brakes
- post-trade attribution and reconciliation
- operator dashboards for positions, trades, regimes, and strategy review

## What the system does

The engine is designed to answer the operational questions that matter:
- what the fair probability is
- whether the edge survives fees, uncertainty, and execution risk
- whether a trade should be skipped, watched, or sent
- what price and size to use
- how the portfolio should allocate capital
- why a trade won or lost afterward

The codebase is not organized as a toy model script. It has distinct layers for ingestion, rule parsing, prediction, execution, sizing, storage, and attribution.

## Core surfaces

- `/` product landing page
- `/dashboard` main execution dashboard
- `/positions` position summary
- `/trades` trade and fill surface
- `/setups` ranked setup view
- `/regime-analysis` regime and environment diagnostics
- `/game-theory-engine` strategy and decision support surface

## Architecture

### Data plane
- append-only event storage under `src/lib/storage/`
- raw streams for:
  - quotes
  - order books
  - orders
  - fills
  - balances
  - positions
  - candidate decisions
  - shadow baselines
  - resolutions
  - raw WebSocket stream events
- derived streams for:
  - markouts

### Market state
- Kalshi WebSocket state engine in `src/lib/prediction/kalshi-stream.ts`
- local order book maintenance from snapshot + delta
- private-state tracking for orders, fills, positions, and order-group updates
- reconnect and sequence-gap recovery

### Execution engine
- main engine in `src/lib/prediction/engine.ts`
- probability transforms in `src/lib/prediction/transforms.ts`
- fixed-point price/size logic in `src/lib/prediction/fixed-point.ts`
- order-group hard brakes in:
  - `src/lib/prediction/order-groups.ts`
  - `src/lib/prediction/order-group-rules.ts`

### Attribution
- fill markouts in `src/lib/prediction/markouts.ts`
- execution attribution in `src/lib/prediction/execution-attribution.ts`
- reconciliation helpers in `src/lib/prediction/reconciliation.ts`

## Phase status

Implemented:
- `6A` append-only data plane and replay
- `6B` WebSocket-first Kalshi state engine
- `6C` fixed-point/subpenny/fractional execution math
- `6D` exchange-native order-group hard brakes
- `6E` execution attribution, near misses, gate diagnostics, and reconciliation
- `6F` shadow baseline comparison framework
- `6G` product-surface cleanup

## Shadow baselines

The automation run now compares multiple execution profiles from the same candidate universe:
- current maker
- old smart taker
- maker with toxicity gate removed
- maker with cluster caps removed

Each run reports comparable estimated metrics:
- expected net alpha
- expected net markout after fees
- expected expiry PnL
- fill rate
- cancellation rate
- adverse-selection rate

This is intended to answer whether the more sophisticated engine is actually better, not just more elaborate.

## Requirements

- Node.js 20+
- npm
- Kalshi demo credentials for live-demo execution
- Alpaca credentials if you want the optional external market integrations

## Local setup

```bash
cd /Users/aa/Desktop/Projects/trading-analytics-dashboard
npm install
cp .env.example .env.local
```

Then populate only the credentials you actually need.

### Kalshi demo variables

```bash
KALSHI_API_BASE_URL=https://demo-api.kalshi.co/trade-api/v2
KALSHI_MARKET_DATA_BASE_URL=https://demo-api.kalshi.co/trade-api/v2
KALSHI_KEY_ID=...
KALSHI_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

Alternative:

```bash
KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/kalshi-private-key.pem
```

### Optional Alpaca variables

```bash
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets
```

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Validation commands

```bash
npm test
npm run lint
npm run build
```

## Important files

- `src/lib/prediction/engine.ts`
- `src/lib/prediction/kalshi.ts`
- `src/lib/prediction/kalshi-stream.ts`
- `src/lib/prediction/fixed-point.ts`
- `src/lib/prediction/markouts.ts`
- `src/lib/prediction/execution-attribution.ts`
- `src/lib/prediction/reconciliation.ts`
- `src/lib/prediction/order-groups.ts`
- `src/lib/prediction/order-group-rules.ts`
- `src/lib/storage/prediction-store.ts`
- `src/components/dashboard/prediction-automation-panel.tsx`

## Safety notes

- `.env.local` should not be committed
- `data/` runtime telemetry should not be committed
- demo execution is still execution; treat credentials and order flow seriously

## Current limitations

- fee estimation is good for planning and attribution drift detection, but not full exchange-accounting parity on every fragmented fill path
- some shadow-baseline metrics are estimated from the same candidate universe rather than replayed from full alternative live execution
- the strongest conclusions still require more resolved live/demo samples
