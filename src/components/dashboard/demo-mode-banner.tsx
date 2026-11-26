"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function DemoModeBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-mode-banner"
      className="border-b border-amber-600/50 bg-amber-950 text-amber-100 px-3 sm:px-4 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
    >
      <div className="flex items-start sm:items-center gap-2 text-amber-100 font-medium">
        <FlaskConical
          className="h-4 w-4 text-amber-300 shrink-0 mt-0.5 sm:mt-0"
          aria-hidden="true"
        />
        <span>
          <strong>AMBIENTE DEMONSTRATIVO (FOUNDATION STAGE v0.1.1):</strong>{" "}
          Todos os indicadores abaixo são fornecidos pelo{" "}
          <code className="px-1 py-0.5 rounded bg-amber-900 text-amber-100">
            MockAdsProvider
          </code>{" "}
          (
          <code className="px-1 py-0.5 rounded bg-amber-900 text-amber-100">
            isDemoData: true
          </code>
          ). Nenhuma conta real do Google Ads ou Meta Ads está conectada nesta
          entrega inicial.
        </span>
      </div>
      <Badge variant="demo">DADOS DE TESTE IDENTIFICADOS</Badge>
    </div>
  );
}
