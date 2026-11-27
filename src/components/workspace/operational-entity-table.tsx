"use client";

import * as React from "react";
import Link from "next/link";
import { Search, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export interface TableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => React.ReactNode;
}

export function OperationalEntityTable<T extends { readonly id: string }>({
  title,
  description,
  rows,
  columns,
  searchPlaceholder = "Filtrar registros...",
  getSearchableText,
  emptyTitle,
  emptyDescription,
  emptyActionHref = "/integracoes",
  emptyActionLabel = "Conectar Google Ads em Integrações",
}: {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly T[];
  readonly columns: readonly TableColumn<T>[];
  readonly searchPlaceholder?: string;
  readonly getSearchableText: (row: T) => string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyActionHref?: string;
  readonly emptyActionLabel?: string;
}) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => getSearchableText(r).toLowerCase().includes(q));
  }, [rows, query, getSearchableText]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {title} ({filtered.length})
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {emptyDescription}
            </p>
            <Link
              href={emptyActionHref}
              className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline pt-1"
            >
              {emptyActionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                  {columns.map((col) => (
                    <th key={col.key} className="py-2.5 pr-4 font-medium">
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                  >
                    {columns.map((col) => (
                      <td key={col.key} className="py-2.5 pr-4 align-top">
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
