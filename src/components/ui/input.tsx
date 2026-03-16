import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-md border border-slate-700 bg-slate-900/70 px-3 py-1 text-sm text-slate-100 outline-none transition-all placeholder:text-slate-500 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-500/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
