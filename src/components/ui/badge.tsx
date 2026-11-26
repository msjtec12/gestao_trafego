import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-cyan-600/50 bg-cyan-950/90 text-cyan-100",
        secondary:
          "border-slate-700 bg-slate-800 text-slate-100",
        success:
          "border-emerald-600/50 bg-emerald-950/90 text-emerald-100",
        warning:
          "border-amber-600/50 bg-amber-950/90 text-amber-100",
        destructive:
          "border-red-600/50 bg-red-950/90 text-red-100",
        demo: "border-amber-500/60 bg-amber-950/90 text-amber-100 font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
