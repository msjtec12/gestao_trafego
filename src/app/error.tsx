"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060d1a] text-slate-100 p-6">
      <div className="max-w-md w-full rounded-xl border border-red-500/40 bg-[#0b1629] p-6 space-y-4">
        <h2 className="text-lg font-bold text-red-400">
          Falha de Execução Detectada
        </h2>
        <p className="text-xs text-slate-300">
          O sistema interceptou um erro inesperado e manteve todas as automações em modo seguro (Somente Leitura).
        </p>
        <code className="block text-[11px] bg-slate-950 p-2.5 rounded text-slate-400 overflow-x-auto">
          {error.message || "Erro interno não especificado"}
        </code>
        <Button onClick={reset} size="sm">
          Tentar Novamente
        </Button>
      </div>
    </div>
  );
}
