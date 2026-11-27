"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  ShieldAlert,
  Save,
  Lock,
  Database,
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
import {
  toggleEmergencyStopServerAction,
  updateOrganizationProfileServerAction,
} from "@/app/actions/operational-actions";
import type { UserRole } from "@/domain/types";
import type {
  AuditEventViewModel,
  MemberRecordViewModel,
} from "@/application/use-cases/dashboard-overview-use-case";

export function SettingsHubClient({
  organizationId,
  organizationName,
  organizationSlug,
  organizationTimezone,
  organizationCurrency,
  emergencyStopActive: initialKillSwitch,
  authenticatedUserRole,
  members,
  auditTrail,
  domainTables,
}: {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly organizationTimezone: string;
  readonly organizationCurrency: string;
  readonly emergencyStopActive: boolean;
  readonly authenticatedUserRole: UserRole;
  readonly members: readonly MemberRecordViewModel[];
  readonly auditTrail: readonly AuditEventViewModel[];
  readonly domainTables: readonly string[];
}) {
  const router = useRouter();
  const isAdminOrOwner =
    authenticatedUserRole === "OWNER" || authenticatedUserRole === "ADMIN";
  const [activeTab, setActiveTab] = React.useState<"GERAL" | "DIAGNOSTICO">(
    "GERAL"
  );

  const [name, setName] = React.useState(organizationName);
  const [timezone, setTimezone] = React.useState(organizationTimezone);
  const [currencyCode, setCurrencyCode] = React.useState<"BRL" | "USD" | "EUR">(
    (organizationCurrency as "BRL" | "USD" | "EUR") || "BRL"
  );
  const [killSwitch, setKillSwitch] = React.useState(initialKillSwitch);
  const [saving, setSaving] = React.useState(false);
  const [togglingKill, setTogglingKill] = React.useState(false);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    setError(null);
    setSaving(true);
    try {
      const res = await updateOrganizationProfileServerAction({
        name,
        timezone,
        currencyCode,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar o perfil.");
        return;
      }
      setSuccess("Perfil da organização atualizado com sucesso.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleKillSwitch = async () => {
    setSuccess(null);
    setError(null);
    setTogglingKill(true);
    try {
      const res = await toggleEmergencyStopServerAction();
      if (!res.ok) {
        setError(res.error ?? "Não foi possível atualizar a trava.");
        return;
      }
      const next = res.emergencyStopActive ?? !killSwitch;
      setKillSwitch(next);
      setSuccess(
        next
          ? "Parada de Emergência ativada com sucesso."
          : "Parada de Emergência desativada (modo READ_ONLY preservado)."
      );
      router.refresh();
    } finally {
      setTogglingKill(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <Button
          type="button"
          size="sm"
          variant={activeTab === "GERAL" ? "default" : "outline"}
          onClick={() => setActiveTab("GERAL")}
        >
          Configurações Comerciais
        </Button>
        {isAdminOrOwner && (
          <Button
            type="button"
            size="sm"
            variant={activeTab === "DIAGNOSTICO" ? "default" : "outline"}
            data-testid="admin-diagnostics-tab-btn"
            onClick={() => setActiveTab("DIAGNOSTICO")}
          >
            <Lock className="h-3.5 w-3.5" />
            Diagnóstico Administrativo (Restrito)
          </Button>
        )}
      </div>

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

      {activeTab === "GERAL" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-cyan-500" />
                Perfil da Organização
              </CardTitle>
              <CardDescription>
                Informações exibidas nos relatórios comerciais e usadas para
                padronizar datas e valores.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleSaveProfile}
                className="grid grid-cols-1 md:grid-cols-3 gap-3"
              >
                <div>
                  <label
                    htmlFor="org-name"
                    className="block text-xs font-medium mb-1"
                  >
                    Nome da Organização
                  </label>
                  <input
                    id="org-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="org-tz"
                    className="block text-xs font-medium mb-1"
                  >
                    Fuso Horário
                  </label>
                  <select
                    id="org-tz"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                  >
                    <option value="America/Sao_Paulo">
                      America/Sao_Paulo (Brasília)
                    </option>
                    <option value="America/Manaus">America/Manaus</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="org-currency"
                    className="block text-xs font-medium mb-1"
                  >
                    Moeda Padrão
                  </label>
                  <select
                    id="org-currency"
                    value={currencyCode}
                    onChange={(e) =>
                      setCurrencyCode(e.target.value as "BRL" | "USD" | "EUR")
                    }
                    className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                  >
                    <option value="BRL">BRL (Real Brasileiro)</option>
                    <option value="USD">USD (Dólar Americano)</option>
                    <option value="EUR">EUR (Euro)</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <Button type="submit" disabled={saving}>
                    <Save className="h-4 w-4" />
                    {saving ? "Salvando..." : "Salvar Perfil"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-500" />
                Equipe da Organização ({members.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2.5 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold">{m.fullName}</p>
                    <p className="text-slate-500 dark:text-slate-400">
                      {m.email}
                    </p>
                  </div>
                  <Badge variant="secondary">{m.role}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-red-500/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-500" />
                Trava de Segurança & Parada de Emergência
              </CardTitle>
              <CardDescription>
                A organização opera em modo seguro <strong>READ_ONLY</strong>.
                Você pode acionar a parada de emergência para suspender
                imediatamente qualquer rotina automatizada.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs">
                Status atual:{" "}
                <Badge variant={killSwitch ? "destructive" : "success"}>
                  {killSwitch ? "PARADA ATIVA" : "OPERANDO EM READ_ONLY"}
                </Badge>
              </div>
              <Button
                type="button"
                variant={killSwitch ? "outline" : "destructive"}
                disabled={togglingKill}
                onClick={handleToggleKillSwitch}
              >
                {killSwitch
                  ? "Desativar Parada de Emergência"
                  : "Ativar Parada de Emergência"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Restricted Owner/Admin Architecture & Security Diagnostics */
        <div className="space-y-6" data-testid="admin-diagnostics-panel">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-500" />
                Diagnóstico de Arquitetura, Isolamento Multi-Tenant e Auditoria
              </CardTitle>
              <CardDescription>
                Área administrativa restrita a perfis OWNER e ADMIN.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="text-slate-600 dark:text-slate-300">Organization ID</p>
                  <code className="font-mono text-[11px] break-all">
                    {organizationId}
                  </code>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="text-slate-600 dark:text-slate-300">Slug</p>
                  <code className="font-mono text-[11px]">
                    {organizationSlug}
                  </code>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="text-slate-600 dark:text-slate-300">Tabelas de Domínio (Drizzle + RLS)</p>
                  <p className="font-semibold">{domainTables.length} tabelas</p>
                </div>
              </div>

              <div>
                <p className="font-semibold mb-2">
                  Últimos Eventos de Auditoria ({auditTrail.length})
                </p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {auditTrail.slice(0, 15).map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <span className="font-mono text-[11px]">
                        {ev.action} ({ev.entityType})
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">
                        {new Date(ev.timestamp).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
