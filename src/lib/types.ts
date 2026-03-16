export type AccountType = "DEMO" | "MAIN";
export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "CLOSED" | "MISSED";

export type SetupKey =
  | "BREAKOUT"
  | "PULLBACK"
  | "MEAN_REVERSION"
  | "MOMENTUM_CONTINUATION"
  | "NEWS_FADE";

export type MarketRegime =
  | "TREND_FOLLOWER"
  | "MEAN_REVERSION"
  | "HIGH_VOL_ADVERSARIAL"
  | "NEWS_SHOCK"
  | "LOW_LIQUIDITY_TRAP";

export type AssetClass = "EQUITY" | "FX" | "INDEX_FUTURE" | "CRYPTO";

export type RiskEventType =
  | "FOMC"
  | "EARNINGS_CLUSTER"
  | "LIQUIDITY_DRAIN"
  | "VOL_EXPANSION"
  | "MACRO_DATA";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  riskPercent: number;
  riskValue: number;
  currentStreak: number;
  maxDrawdown: number;
}

export interface SetupDefinition {
  key: SetupKey;
  label: string;
  archetype: "trend" | "reversion" | "event";
  baseEdge: number;
  color: string;
}

export interface TradeQualityBreakdown {
  thesisQuality: number;
  timingQuality: number;
  executionQuality: number;
  regimeFit: number;
  sizingQuality: number;
  exitQuality: number;
}

export interface Trade {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  price: number;
  direction: TradeDirection;
  setup: SetupKey;
  entryDate: string;
  exitDate: string | null;
  pnl: number;
  pnlPercent: number;
  rr: number;
  status: TradeStatus;
  accountType: AccountType;
  tags: string[];
  confidenceScore: number;
  marketRegime: MarketRegime;
  notes: string;
  executionScore: number;
  slippage: number;
  thesisQuality: number;
  opponentProfile: string;
  regimeTransitionDamage: number;
  overusePenalty: number;
  quality: TradeQualityBreakdown;
}

export interface EquitySnapshot {
  date: string;
  balance: number;
  dailyPnl: number;
  drawdown: number;
  accountType: AccountType;
}

export interface MonthlyPerformance {
  year: number;
  month: number;
  rr: number;
  netPercent: number;
  profit: number;
  strikeRate: number;
  trades: number;
}

export interface RiskEvent {
  id: string;
  date: string;
  type: RiskEventType;
  severity: number;
  description: string;
}

export interface StreakStatistics {
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
}

export interface DashboardData {
  accounts: Account[];
  trades: Trade[];
  equity: EquitySnapshot[];
  monthlyPerformance: MonthlyPerformance[];
  setups: SetupDefinition[];
  strategyTags: string[];
  riskEvents: RiskEvent[];
  streakStats: StreakStatistics;
}

export type KpiPeriod = "WEEK" | "MONTH" | "YEAR" | "ALL_TIME";

export interface KpiCardMetrics {
  period: KpiPeriod;
  label: string;
  rr: number;
  returnPct: number;
  pnl: number;
  winRate: number;
  wins: number;
  losses: number;
  breakeven: number;
  trades: number;
}

export interface CoreMetrics {
  winRate: number;
  lossRate: number;
  breakevenRate: number;
  expectancy: number;
  averageRR: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  rollingSharpeLike: number;
  streaks: StreakStatistics;
  regimeAdjustedExpectancy: number;
  setupExpectancy: Record<SetupKey, number>;
  disciplineScore: number;
  exploitabilityScore: number;
  uncertaintyScore: number;
}

export interface BayesianBelief {
  setup: SetupKey;
  priorEdge: number;
  posteriorEdge: number;
  sampleSize: number;
  confidenceLow: number;
  confidenceHigh: number;
}

export interface StrategyMixWeight {
  setup: SetupKey | "NO_TRADE";
  weight: number;
}

export interface SetupRecommendation {
  setup: SetupKey;
  action: "PLAY_BALANCED" | "EXPLOIT_AGGRESSIVELY" | "REDUCE_EXPOSURE" | "STOP_DEPLOYING";
  rationale: string;
}

export interface RegimeDetection {
  regime: MarketRegime;
  confidence: number;
  rationale: string;
}

export interface GameTheoryState {
  regimeDetection: RegimeDetection;
  strategyMix: StrategyMixWeight[];
  robustRiskPosture: "AGGRESSIVE" | "BALANCED" | "DEFENSIVE" | "CAPITAL_PRESERVATION";
  beliefs: BayesianBelief[];
  infoDisadvantageRisk: "LOW" | "MEDIUM" | "HIGH";
  setupRecommendations: SetupRecommendation[];
  repeatedGameDisciplineScore: number;
  noTradeRecommended: boolean;
  noTradeReason: string;
  metaAnalytics: {
    bestAfterLosses: SetupKey[];
    failsWhenOverused: SetupKey[];
    tooPredictable: SetupKey[];
    damagingTransitions: string[];
    strategicDriftMonths: string[];
  };
}
