"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Globe,
  Plus,
  Search,
  ArrowUpRight,
  Target,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClientServerAction } from "@/app/actions/operational-actions";
import type { CommercialClientViewModel } from "@/application/use-cases/operational-workspace-loader";
import type { AdAccountRecordViewModel } from "@/application/use-cases/dashboard-overview-use-case";

function formatBrl(v: number | null): string {
  if (v === null) return "Não definido";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ClientsPortfolioClient({
  clients: initialClients,
  adAccounts,
}: {
  readonly clients: readonly CommercialClientViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
}) {
  const router = useRouter();
  const [clients, setClients] =
    React.useState<readonly CommercialClientViewModel[]>(initialClients);
  const [search, setSearch] = React.useState("");
  const [name, setName] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [websiteUrl, setWebsiteUrl] = React.useState("");
  const [monthlyBudgetCapBrl, setMonthlyBudgetCapBrl] = React.useState("");
  const [targetCpaBrl, setTargetCpaBrl] = React.useState("");
  const [targetRoas, setTargetRoas] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const filteredClients = clients.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await createClientServerAction({
        name,
        industry,
        websiteUrl: websiteUrl.trim() || undefined,
        monthlyBudgetCapBrl,
        targetCpaBrl,
        targetRoas: targetRoas.trim() || undefined,
      });
      if (!res.ok || !res.client) {
        setError(res.error ?? "Não foi possível cadastrar o cliente.");
        return;
      }
      setClients((prev) => [
        { ...res.client!, createdAtIso: new Date().toISOString() },
        ...prev,
      ]);
      setName("");
      setIndustry("");
      setWebsiteUrl("");
      setMonthlyBudgetCapBrl("");
      setTargetCpaBrl("");
      setTargetRoas("");
      setSuccess(`Cliente "${res.client.name}" cadastrado com sucesso.`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-cyan-500" />
            Novo Cliente Comercial
          </CardTitle>
          <CardDescription>
            Cadastre dados comerciais, site oficial, verba mensal e metas de CPA
            e ROAS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {success && (
            <div
              role="status"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {success}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <div>
              <label
                htmlFor="cli-name"
                className="block text-xs font-medium mb-1"
              >
                Nome do Cliente
              </label>
              <input
                id="cli-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Clínica Sorriso Premium"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="cli-industry"
                className="block text-xs font-medium mb-1"
              >
                Segmento
              </label>
              <input
                id="cli-industry"
                type="text"
                required
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Ex.: Odontologia, E-commerce, Imobiliária"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="cli-website"
                className="block text-xs font-medium mb-1"
              >
                Site Oficial (opcional)
              </label>
              <input
                id="cli-website"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://cliente.com.br"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="cli-budget"
                className="block text-xs font-medium mb-1"
              >
                Orçamento Mensal (R$)
              </label>
              <input
                id="cli-budget"
                type="number"
                required
                min="1"
                step="0.01"
                value={monthlyBudgetCapBrl}
                onChange={(e) => setMonthlyBudgetCapBrl(e.target.value)}
                placeholder="10000"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="cli-cpa"
                className="block text-xs font-medium mb-1"
              >
                CPA Desejado (R$)
              </label>
              <input
                id="cli-cpa"
                type="number"
                required
                min="1"
                step="0.01"
                value={targetCpaBrl}
                onChange={(e) => setTargetCpaBrl(e.target.value)}
                placeholder="45"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="cli-roas"
                className="block text-xs font-medium mb-1"
              >
                ROAS Desejado (opcional, ex.: 4.5)
              </label>
              <input
                id="cli-roas"
                type="number"
                min="0.1"
                step="0.1"
                value={targetRoas}
                onChange={(e) => setTargetRoas(e.target.value)}
                placeholder="4.5"
                className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>

            <div className="md:col-span-3">
              <Button type="submit" disabled={submitting}>
                <Plus className="h-4 w-4" />
                {submitting ? "Salvando cliente..." : "Cadastrar Cliente"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Clientes Ativos ({filteredClients.length})
        </h2>
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou segmento..."
            aria-label="Buscar cliente ou segmento"
            className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 text-xs"
          />
        </div>
      </div>

      {filteredClients.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Building2 className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-medium">Nenhum cliente encontrado</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cadastre seu primeiro cliente acima para organizar contas, metas,
              análises de IA e relatórios.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredClients.map((client) => {
            const linkedAccounts = adAccounts.filter(
              (a) => a.clientId === client.id
            );
            return (
              <Card key={client.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{client.name}</CardTitle>
                      <CardDescription>{client.industry}</CardDescription>
                    </div>
                    <Badge variant="success">Ativo</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  {client.websiteUrl && (
                    <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 truncate">
                      <Globe className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
                      <span className="truncate">{client.websiteUrl}</span>
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-lg bg-slate-100 dark:bg-slate-800/60 p-2.5">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Wallet className="h-3 w-3" /> Orçamento Mensal
                      </span>
                      <p className="font-semibold mt-0.5">
                        {formatBrl(client.monthlyBudgetCapBrl)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-100 dark:bg-slate-800/60 p-2.5">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Target className="h-3 w-3" /> CPA / ROAS Meta
                      </span>
                      <p className="font-semibold mt-0.5">
                        {formatBrl(client.targetCpaBrl)}
                        {client.targetRoas !== null
                          ? ` · ${client.targetRoas}x`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">
                      {linkedAccounts.length} conta(s) vinculada(s)
                    </span>
                    <Link
                      href={`/clientes/${client.id}`}
                      className="inline-flex items-center gap-1 font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Abrir ficha <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
