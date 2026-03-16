import { formatPct } from "@/lib/utils";

interface WinRateGaugeProps {
  value: number;
}

export function WinRateGauge({ value }: WinRateGaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const angle = clamped * 180;

  return (
    <div className="relative h-20 w-36">
      <div
        className="absolute left-0 top-0 h-20 w-36 overflow-hidden rounded-t-full border border-slate-800 bg-slate-900/60"
        style={{
          background: `conic-gradient(from 180deg at 50% 100%, rgba(56,189,248,0.75) 0deg ${angle}deg, rgba(51,65,85,0.45) ${angle}deg 180deg)`,
        }}
      />
      <div className="absolute inset-x-3 bottom-0 top-3 rounded-t-full border border-slate-900 bg-slate-950" />
      <div className="absolute inset-0 flex items-end justify-center pb-2">
        <span className="text-lg font-semibold text-sky-300">{formatPct(clamped, 2)}</span>
      </div>
    </div>
  );
}
