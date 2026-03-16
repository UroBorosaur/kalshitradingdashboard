import { Flame, ShieldAlert, Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Account } from "@/lib/types";
import { formatCurrency, formatPct } from "@/lib/utils";

interface AccountSummaryPanelProps {
  account: Account;
}

export function AccountSummaryPanel({ account }: AccountSummaryPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-sm tracking-wide text-slate-300">Account Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400">
            <Wallet className="h-4 w-4" />
            <span>Account Balance</span>
          </div>
          <span className="font-semibold text-emerald-300">{formatCurrency(account.balance)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-400">Trade Risk</span>
          <span className="font-semibold text-sky-300">{formatPct(account.riskPercent)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-400">Risk Value</span>
          <span className="font-semibold text-amber-300">{formatCurrency(account.riskValue)}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400">
            <Flame className="h-4 w-4" />
            <span>Current Streak</span>
          </div>
          <span className={account.currentStreak >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-red-300"}>
            {account.currentStreak >= 0 ? "+" : ""}
            {account.currentStreak}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400">
            <ShieldAlert className="h-4 w-4" />
            <span>Max Drawdown</span>
          </div>
          <span className="font-semibold text-red-300">{formatPct(account.maxDrawdown)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
