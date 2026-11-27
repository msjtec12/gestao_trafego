"use client";

import * as React from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import type { NormalizedCampaign } from "@/integrations/contracts/advertising-provider";
import { formatCurrencyBrl, formatNumberPtBr, formatPercentPtBr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface CampaignsTableProps {
  readonly campaigns: NormalizedCampaign[];
  readonly lastVerifiedSyncAtIso?: string | null;
  readonly isStale?: boolean;
  readonly isContaminated?: boolean;
  readonly periodLabel?: string;
}

export function CampaignsTable({
  campaigns,
  lastVerifiedSyncAtIso = null,
  isStale = false,
  isContaminated = false,
  periodLabel = "Últimos 7 dias",
}: CampaignsTableProps) {
  const isDemoDataset =
    campaigns.length > 0 && campaigns.every((c) => c.isDemoData);
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "spend7dBrl", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [channelFilter, setChannelFilter] = React.useState<string>("ALL");

  const filteredData = React.useMemo(() => {
    return campaigns.filter((c) => {
      const matchesStatus =
        statusFilter === "ALL" ? true : c.status === statusFilter;
      const matchesChannel =
        channelFilter === "ALL" ? true : c.channelType === channelFilter;
      const matchesQuery =
        globalFilter.trim() === ""
          ? true
          : c.name.toLowerCase().includes(globalFilter.toLowerCase()) ||
            c.clientName.toLowerCase().includes(globalFilter.toLowerCase()) ||
            c.externalCampaignId
              .toLowerCase()
              .includes(globalFilter.toLowerCase());
      return matchesStatus && matchesChannel && matchesQuery;
    });
  }, [campaigns, statusFilter, channelFilter, globalFilter]);

  const columns = React.useMemo<ColumnDef<NormalizedCampaign>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Campanha / Cliente",
        cell: ({ row }) => {
          const item = row.original;
          const isOfficialNumericId = /^\d+$/.test(item.externalCampaignId);
          return (
            <div className="min-w-[240px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {item.name}
                </span>
                {item.isDemoData ? (
                  <Badge variant="demo">DEMO</Badge>
                ) : !isOfficialNumericId ? (
                  <Badge variant="destructive">NÃO VERIFICADA</Badge>
                ) : null}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                <span>{item.clientName}</span>
                <span>•</span>
                <code className="text-[11px] text-cyan-600 dark:text-cyan-400">
                  ID: {item.externalCampaignId}
                </code>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "channelType",
        header: "Canal",
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.channelType}</Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const st = row.original.status;
          const variant =
            st === "ENABLED"
              ? "success"
              : st === "LIMITED_BY_BUDGET"
                ? "warning"
                : st === "LEARNING"
                  ? "default"
                  : "secondary";
          const label =
            st === "ENABLED"
              ? "Ativa"
              : st === "LIMITED_BY_BUDGET"
                ? "Limitada (Orçamento)"
                : st === "LEARNING"
                  ? "Em Aprendizado"
                  : "Pausada";
          return <Badge variant={variant}>{label}</Badge>;
        },
      },
      {
        accessorKey: "dailyBudgetBrl",
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="inline-flex items-center gap-1 hover:text-cyan-400 cursor-pointer"
          >
            Orçamento/Dia
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => formatCurrencyBrl(row.original.dailyBudgetBrl),
      },
      {
        accessorKey: "spend7dBrl",
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="inline-flex items-center gap-1 hover:text-cyan-400 cursor-pointer"
          >
            Gasto (7d)
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">
            {formatCurrencyBrl(row.original.spend7dBrl)}
          </span>
        ),
      },
      {
        accessorKey: "conversions7d",
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="inline-flex items-center gap-1 hover:text-cyan-400 cursor-pointer"
          >
            Conversões
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => formatNumberPtBr(row.original.conversions7d),
      },
      {
        accessorKey: "cpa7dBrl",
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="inline-flex items-center gap-1 hover:text-cyan-400 cursor-pointer"
          >
            CPA (7d)
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => {
          const cpa = row.original.cpa7dBrl;
          const isHigh = cpa > 80;
          return (
            <span
              className={
                isHigh
                  ? "text-amber-500 dark:text-amber-400 font-semibold"
                  : "text-emerald-600 dark:text-emerald-400 font-medium"
              }
            >
              {formatCurrencyBrl(cpa)}
            </span>
          );
        },
      },
      {
        accessorKey: "roas7d",
        header: ({ column }) => (
          <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="inline-flex items-center gap-1 hover:text-cyan-400 cursor-pointer"
          >
            ROAS
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => `${row.original.roas7d.toFixed(2).replace(".", ",")}x`,
      },
      {
        accessorKey: "ctr7dPct",
        header: "CTR",
        cell: ({ row }) => formatPercentPtBr(row.original.ctr7dPct),
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 5,
      },
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">
                Monitoramento Centralizado de Campanhas
              </CardTitle>
              {isDemoDataset ? (
                <Badge variant="demo">MOCK PROVIDER • DEMO</Badge>
              ) : isContaminated ? (
                <Badge variant="destructive">
                  INTEGRIDADE COMPROMETIDA (RECONCILIAÇÃO NECESSÁRIA)
                </Badge>
              ) : (
                <Badge variant="success">
                  GOOGLE ADS API v26 • SOMENTE LEITURA
                </Badge>
              )}
              {isStale && !isDemoDataset && (
                <Badge variant="warning">DADOS DESATUALIZADOS (&gt;24h)</Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              {isDemoDataset
                ? "Ambiente demonstrativo isolado (MockAdsProvider) • Dados ilustrativos"
                : `Fonte oficial: Google Ads API v26 (READ_ONLY) • Período: ${periodLabel}${
                    lastVerifiedSyncAtIso
                      ? ` • Última sincronização verificada: ${new Date(
                          lastVerifiedSyncAtIso
                        ).toLocaleString("pt-BR")}`
                      : " • Nenhuma sincronização oficial concluída ainda"
                  }`}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Filtrar cliente ou campanha..."
                aria-label="Filtrar campanhas por texto"
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/90 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filtrar por status da campanha"
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/90 px-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="ALL">Todos os Status</option>
                <option value="ENABLED">Ativas</option>
                <option value="LIMITED_BY_BUDGET">Limitadas (Orçamento)</option>
                <option value="LEARNING">Em Aprendizado</option>
                <option value="PAUSED">Pausadas</option>
              </select>

              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                aria-label="Filtrar por canal de mídia"
                className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/90 px-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="ALL">Todos os Canais</option>
                <option value="SEARCH">Google Search</option>
                <option value="PERFORMANCE_MAX">Performance Max</option>
                <option value="META_ADVANTAGE">Meta Advantage+</option>
                <option value="LOCAL_SERVICES">Local Services</option>
              </select>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-4 py-3 font-semibold">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    Nenhuma campanha demonstrativa corresponde aos filtros selecionados (Empty State).
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3.5 whitespace-nowrap">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 text-xs text-slate-500 dark:text-slate-400">
          <div>
            Exibindo{" "}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {table.getRowModel().rows.length}
            </span>{" "}
            de{" "}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {filteredData.length}
            </span>{" "}
            campanhas demonstrativas (`isDemoData: true`)
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <span className="px-2">
              Página{" "}
              <strong>
                {table.getState().pagination.pageIndex + 1} de{" "}
                {Math.max(1, table.getPageCount())}
              </strong>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
