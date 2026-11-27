import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  KeyRound,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GuidedOnboardingStep } from "@/application/use-cases/operational-workspace-loader";

export function GuidedOnboardingChecklist({
  steps,
}: {
  readonly steps: readonly GuidedOnboardingStep[];
}) {
  const completedCount = steps.filter((s) => s.status === "CONCLUIDO").length;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  return (
    <Card
      data-testid="guided-onboarding-checklist"
      className="border-cyan-500/30 bg-white dark:bg-slate-900/70"
    >
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              Primeiros Passos — Checklist de Implantação
            </CardTitle>
            <CardDescription>
              Acompanhe o que já está configurado na sua conta e o que depende
              de credenciais externas de anúncios.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={progressPct === 100 ? "success" : "default"}>
              {completedCount} de {steps.length} concluídos ({progressPct}%)
            </Badge>
          </div>
        </div>

        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-2">
          <div
            className="h-full bg-cyan-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </CardHeader>

      <CardContent>
        <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {steps.map((step) => {
            const isDone = step.status === "CONCLUIDO";
            const isBlocked = step.status === "BLOQUEADO_CREDENCIAIS";

            return (
              <li
                key={step.id}
                data-testid={`onboarding-step-${step.id}`}
                className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                  isDone
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : isBlocked
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : isBlocked ? (
                        <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-slate-400 shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {step.stepNumber}. {step.title}
                      </span>
                    </div>

                    <Badge
                      variant={
                        isDone
                          ? "success"
                          : isBlocked
                            ? "warning"
                            : "secondary"
                      }
                      className="text-[10px] shrink-0"
                    >
                      {isDone
                        ? "Configurado"
                        : isBlocked
                          ? "Credencial externa"
                          : "Pendente"}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {step.description}
                  </p>

                  {step.credentialNote && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-md px-2 py-1">
                      {step.credentialNote}
                    </p>
                  )}
                </div>

                <Link
                  href={step.actionHref}
                  className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 dark:text-cyan-400 hover:underline w-fit"
                >
                  {step.actionLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
