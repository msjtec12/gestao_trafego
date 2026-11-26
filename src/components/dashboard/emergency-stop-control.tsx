"use client";

import * as React from "react";
import { AlertOctagon, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmergencyStopControlProps {
  readonly emergencyStopActive: boolean;
  readonly onToggle: () => void;
}

export function EmergencyStopControl({
  emergencyStopActive,
  onToggle,
}: EmergencyStopControlProps) {
  return (
    <Button
      type="button"
      variant={emergencyStopActive ? "destructive" : "outline"}
      size="sm"
      onClick={onToggle}
      aria-pressed={emergencyStopActive}
      aria-label={
        emergencyStopActive
          ? "Kill Switch de Simulação Ativo — Clique para restaurar modo supervisionado"
          : "Botão de Emergência (Kill Switch — Simulação UI)"
      }
      data-testid="emergency-kill-switch-btn"
      className={
        emergencyStopActive
          ? "animate-pulse text-xs"
          : "border-red-500/50 text-red-600 dark:text-red-300 hover:bg-red-950/30 text-xs"
      }
    >
      <AlertOctagon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[160px] sm:max-w-none">
        {emergencyStopActive
          ? "KILL SWITCH ATIVO (SIMULAÇÃO UI)"
          : "Botão de Emergência (Kill Switch — Simulação)"}
      </span>
    </Button>
  );
}

export function EmergencyStopAlertBanner({
  emergencyStopActive,
  onRestore,
}: {
  readonly emergencyStopActive: boolean;
  readonly onRestore: () => void;
}) {
  if (!emergencyStopActive) return null;

  return (
    <div
      role="alert"
      data-testid="emergency-stop-alert"
      className="border-b border-red-500/50 bg-red-950/95 text-red-100 px-3 sm:px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
    >
      <div className="flex items-start sm:items-center gap-2 font-semibold">
        <ShieldAlert
          className="h-4 w-4 text-red-400 shrink-0 mt-0.5 sm:mt-0"
          aria-hidden="true"
        />
        <span>
          PARADA DE EMERGÊNCIA ACIONADA (SIMULAÇÃO LOCAL DE INTERFACE): Todas as
          aprovações do painel demonstrativo foram suspensas. A trava global
          persistente de servidor entrará em produção na Etapa 2.
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onRestore}
        aria-label="Restaurar Modo Supervisionado na Simulação"
      >
        Restaurar Modo Supervisionado
      </Button>
    </div>
  );
}
