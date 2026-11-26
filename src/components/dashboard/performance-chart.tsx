"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { NormalizedDailyMetric } from "@/integrations/contracts/advertising-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface PerformanceChartProps {
  readonly metrics: NormalizedDailyMetric[];
}

export function PerformanceChart({ metrics }: PerformanceChartProps) {
  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">
              Curva de Eficiência — Investimento vs. Conversões & CPA (7 Dias)
            </CardTitle>
            <Badge variant="demo">DADOS DEMO</Badge>
          </div>
          <CardDescription className="mt-1">
            Série temporal consolidada do MockAdsProvider • Valores normalizados em BRL (R$)
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full" aria-label="Gráfico de performance de campanhas">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={metrics}
              margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="label"
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                tickFormatter={(v: number) => `R$${v}`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#22d3ee"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0b1629",
                  borderColor: "#1e293b",
                  borderRadius: "0.75rem",
                  color: "#f1f5f9",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="spendBrl"
                name="Investimento (R$)"
                stroke="#06b6d4"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#spendGradient)"
              />
              <Bar
                yAxisId="right"
                dataKey="conversions"
                name="Conversões"
                fill="#22d3ee"
                radius={[4, 4, 0, 0]}
                barSize={22}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
