"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  Briefcase,
  CreditCard,
  PlugZap,
  ShieldCheck,
  Settings,
  Plus,
  RefreshCw,
  Ban,
  Lock,
  Pencil,
  Trash2,
  ExternalLink,
} from "lucide-react";
import type {
  AdAccountRecordViewModel,
  AuditEventViewModel,
  ClientRecordViewModel,
  IntegrationHealthViewModel,
  MemberRecordViewModel,
  OrganizationOption,
  SyncRunViewModel,
} from "@/application/use-cases/dashboard-overview-use-case";
import {
  createClientServerAction,
  deactivateClientServerAction,
  requestSyncServerAction,
  revokeIntegrationServerAction,
  toggleAdAccountSelectionServerAction,
  updateClientServerAction,
} from "@/app/actions/operational-actions";
import { formatCurrencyBrl } from "@/lib/utils";
import type { GoogleAdsOAuthConfigStatus } from "@/security/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface TenantManagementHubProps {
  readonly activeOrganization: OrganizationOption;
  readonly clients: readonly ClientRecordViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly members: readonly MemberRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly googleAdsConfigStatus?: GoogleAdsOAuthConfigStatus;
  readonly syncHistory?: readonly SyncRunViewModel[];
  readonly auditTrail?: readonly AuditEventViewModel[];
}

type ManagementTab =
  | "clients"
  | "accounts"
  | "integrations"
  | "members"
  | "settings";

export function TenantManagementHub({
  activeOrganization,
  clients: initialClients,
  adAccounts,
  members,
  integrations,
  googleAdsConfigStatus,
  syncHistory = [],
  auditTrail = [],
}: TenantManagementHubProps) {
  const router = useRouter();
  const [clients, setClients] =
    React.useState<readonly ClientRecordViewModel[]>(initialClients);
  const [activeTab, setActiveTab] = React.useState<ManagementTab>("clients");
  const [clientName, setClientName] = React.useState("");
  const [clientIndustry, setClientIndustry] = React.useState("");
  const [monthlyBudgetBrl, setMonthlyBudgetBrl] = React.useState("5000");
  const [targetCpaBrl, setTargetCpaBrl] = React.useState("45");

  React.useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);

  const [editingClientId, setEditingClientId] = React.useState<string | null>(
    null
  );
  const [editName, setEditName] = React.useState("");
  const [editIndustry, setEditIndustry] = React.useState("");
  const [editBudgetBrl, setEditBudgetBrl] = React.useState("");

  const [formError, setFormError] = React.useState<string | null>(null);
  const [statusBanner, setStatusBanner] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusBanner(null);

    if (activeOrganization.isDemo) {
      setFormError(
        "O ambiente demonstrativo público (/demo) é somente leitura. Faça login em /login para persistir clientes no PostgreSQL."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createClientServerAction({
        name: clientName,
        industry: clientIndustry,
        monthlyBudgetCapBrl: monthlyBudgetBrl,
        targetCpaBrl,
      });

      if (!res.ok) {
        setFormError(res.error ?? "Erro ao cadastrar cliente.");
        return;
      }

      if (res.client) {
        const persistedClient = res.client;
        setClients((prev) =>
          prev.some((c) => c.id === persistedClient.id)
            ? prev
            : [...prev, persistedClient]
        );
      }

      setClientName("");
      setClientIndustry("");
      setStatusBanner("Cliente persistido e auditado no PostgreSQL com sucesso.");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEditClient = async (clientId: string) => {
    setFormError(null);
    setStatusBanner(null);
    setIsSubmitting(true);
    try {
      const res = await updateClientServerAction({
        clientId,
        name: editName,
        industry: editIndustry,
        monthlyBudgetCapBrl: editBudgetBrl,
        targetCpaBrl: 45,
      });

      if (!res.ok) {
        setFormError(res.error ?? "Erro ao atualizar cliente.");
        return;
      }

      setEditingClientId(null);
      setStatusBanner("Cliente atualizado no PostgreSQL com sucesso.");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivateClient = async (clientId: string) => {
    setFormError(null);
    setStatusBanner(null);
    setIsSubmitting(true);
    try {
      const res = await deactivateClientServerAction(clientId);
      if (!res.ok) {
        setFormError(res.error ?? "Erro ao inativar cliente.");
        return;
      }
      setStatusBanner("Cliente inativado e registrado em audit_logs.");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAccount = async (accountId: string) => {
    setFormError(null);
    setStatusBanner(null);
    setIsSubmitting(true);
    try {
      const res = await toggleAdAccountSelectionServerAction(accountId);
      if (!res.ok) {
        setFormError(res.error ?? "Erro ao atualizar conta.");
        return;
      }
      setStatusBanner("Seleção de conta persistida no PostgreSQL.");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeIntegration = async (integrationId: string) => {
    setFormError(null);
    setStatusBanner(null);
    setIsSubmitting(true);
    try {
      const res = await revokeIntegrationServerAction(integrationId);
      if (!res.ok) {
        setFormError(res.error ?? "Erro ao revogar integração.");
        return;
      }
      setStatusBanner(
        "Credenciais revogadas e removidas do Credential Vault no PostgreSQL."
      );
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTriggerSync = async (integrationId: string) => {
    setFormError(null);
    setStatusBanner(null);
    setIsSubmitting(true);
    try {
      const res = await requestSyncServerAction(integrationId);
      if (!res.ok) {
        setFormError(res.error ?? "Falha ao executar sincronização.");
        return;
      }
      setStatusBanner(
        "Sincronização concluída e persistida nos 9 domínios do PostgreSQL."
      );
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabs: readonly {
    id: ManagementTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }[] = [
    {
      id: "clients",
      label: "Clientes",
      icon: Briefcase,
      count: clients.length,
    },
    {
      id: "accounts",
      label: "Contas de Anúncios & MCC",
      icon: CreditCard,
      count: adAccounts.length,
    },
    {
      id: "integrations",
      label: "Integrações & Sincronizações",
      icon: PlugZap,
      count: integrations.length,
    },
    {
      id: "members",
      label: "Membros & Permissões RBAC",
      icon: Users,
      count: members.length,
    },
    {
      id: "settings",
      label: "Organização, Governança & Auditoria",
      icon: Settings,
    },
  ];

  return (
    <Card id="tenant-management-hub">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Building2
                className="h-5 w-5 text-cyan-500 dark:text-cyan-400"
                aria-hidden="true"
              />
              <CardTitle className="text-base">
                Central Multi-Tenant — Gestão Persistente no PostgreSQL
              </CardTitle>
              <Badge variant={activeOrganization.isDemo ? "demo" : "default"}>
                {activeOrganization.isDemo
                  ? "TENANT DEMONSTRATIVO"
                  : "TENANT OPERACIONAL (POSTGRESQL)"}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Todas as operações validam sessão no servidor, RBAC, Zod e
              persistem com auditoria no PostgreSQL
            </CardDescription>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Abas de Gestão Multi-Tenant"
          className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-200 dark:border-slate-800 mt-3"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`management-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`management-panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70"
                }`}
              >
                <Icon
                  className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400"
                  aria-hidden="true"
                />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 py-0.2 text-[10px]">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent
        id={`management-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`management-tab-${activeTab}`}
        className="space-y-4"
      >
        {formError && (
          <div
            role="alert"
            data-testid="management-error-alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300"
          >
            {formError}
          </div>
        )}

        {statusBanner && (
          <div
            role="status"
            data-testid="management-success-status"
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
          >
            {statusBanner}
          </div>
        )}

        {/* TAB 1: CLIENTS */}
        {activeTab === "clients" && (
          <div className="space-y-4">
            <form
              onSubmit={handleCreateClient}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Cadastrar Novo Cliente (Persistente no PostgreSQL)
                </h4>
                <Badge variant="secondary">
                  org_id: {activeOrganization.id}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <input
                  type="text"
                  data-testid="create-client-name-input"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nome do Cliente (ex.: Clínica Vida)"
                  aria-label="Nome do novo cliente"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <input
                  type="text"
                  data-testid="create-client-industry-input"
                  value={clientIndustry}
                  onChange={(e) => setClientIndustry(e.target.value)}
                  placeholder="Segmento (ex.: Odontologia)"
                  aria-label="Segmento do novo cliente"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <input
                  type="number"
                  data-testid="create-client-budget-input"
                  value={monthlyBudgetBrl}
                  onChange={(e) => setMonthlyBudgetBrl(e.target.value)}
                  placeholder="Teto Mensal (R$)"
                  aria-label="Teto mensal de orçamento em reais"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <input
                  type="number"
                  data-testid="create-client-cpa-input"
                  value={targetCpaBrl}
                  onChange={(e) => setTargetCpaBrl(e.target.value)}
                  placeholder="Meta CPA (R$)"
                  aria-label="Meta de CPA em reais"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  data-testid="create-client-submit-btn"
                  className="h-9"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Adicionar Cliente
                </Button>
              </div>
            </form>

            {clients.length === 0 ? (
              <div
                data-testid="clients-empty-state"
                className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-10 text-center text-xs text-slate-600 dark:text-slate-300"
              >
                Nenhum cliente cadastrado para esta organização no PostgreSQL
                (Empty State).
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {clients.map((client) => {
                  const isEditing = editingClientId === client.id;
                  return (
                    <div
                      key={client.id}
                      data-testid={`client-card-${client.id}`}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-2 text-xs"
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            aria-label="Editar nome do cliente"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs"
                          />
                          <input
                            type="text"
                            aria-label="Editar segmento do cliente"
                            value={editIndustry}
                            onChange={(e) => setEditIndustry(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs"
                          />
                          <input
                            type="number"
                            aria-label="Editar teto mensal do cliente"
                            value={editBudgetBrl}
                            onChange={(e) => setEditBudgetBrl(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs"
                          />
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              disabled={isSubmitting}
                              onClick={() => handleSaveEditClient(client.id)}
                            >
                              Salvar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingClientId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span
                                data-testid={`client-card-name-${client.id}`}
                                className="font-semibold text-slate-900 dark:text-slate-100 block"
                              >
                                {client.name}
                              </span>
                              <span className="text-slate-500 dark:text-slate-400">
                                {client.industry}
                              </span>
                            </div>
                            <Badge
                              variant={client.isDemoData ? "demo" : "success"}
                            >
                              {client.isDemoData ? "DEMO" : "PERSISTIDO"}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                            <span>
                              Teto Mensal:{" "}
                              <strong>
                                {formatCurrencyBrl(client.monthlyBudgetCapBrl)}
                              </strong>
                            </span>
                            <span>
                              Meta CPA:{" "}
                              <strong>
                                {client.targetCpaBrl
                                  ? formatCurrencyBrl(client.targetCpaBrl)
                                  : "N/D"}
                              </strong>
                            </span>
                          </div>

                          {!client.isDemoData && (
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`Editar cliente ${client.name}`}
                                onClick={() => {
                                  setEditingClientId(client.id);
                                  setEditName(client.name);
                                  setEditIndustry(client.industry);
                                  setEditBudgetBrl(
                                    String(client.monthlyBudgetCapBrl)
                                  );
                                }}
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                                Editar
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isSubmitting}
                                aria-label={`Inativar cliente ${client.name}`}
                                onClick={() =>
                                  handleDeactivateClient(client.id)
                                }
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                Inativar
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AD ACCOUNTS & MCC SELECTION */}
        {activeTab === "accounts" && (
          <div className="space-y-3">
            {adAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 py-10 text-center text-xs text-slate-500">
                Nenhuma conta de anúncios sincronizada para esta organização.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {adAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 flex flex-col justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                          {acc.name}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 block">
                          Cliente: {acc.clientName}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-cyan-600 dark:text-cyan-400">
                          <code>ID: {acc.externalAccountId}</code>
                          {acc.managerCustomerId && (
                            <code>MCC: {acc.managerCustomerId}</code>
                          )}
                          <span>• {acc.currencyCode}</span>
                          <span>• {acc.timezone}</span>
                        </div>
                      </div>
                      <Badge
                        variant={acc.isSelectedForSync ? "success" : "secondary"}
                      >
                        {acc.isSelectedForSync
                          ? "Sincronização Ativa"
                          : "Pausada"}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
                      <span className="text-[11px] text-slate-400">
                        Provedor: {acc.provider}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSubmitting || activeOrganization.isDemo}
                        onClick={() => handleToggleAccount(acc.id)}
                      >
                        {acc.isSelectedForSync
                          ? "Desmarcar da Sincronização"
                          : "Autorizar Sincronização"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: INTEGRATIONS, GOOGLE ADS OAUTH & SYNC HISTORY */}
        {activeTab === "integrations" && (
          <div className="space-y-4">
            {googleAdsConfigStatus && !activeOrganization.isDemo && (
              <div
                data-testid="google-ads-config-status-panel"
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Status da Configuração Google Ads (Política Oficial
                    09/09/2026)
                  </span>
                  <Badge
                    variant={
                      googleAdsConfigStatus.configured ? "success" : "warning"
                    }
                  >
                    {googleAdsConfigStatus.configured
                      ? "OAuth Google Cloud Configurado"
                      : "Configuração Pendente"}
                  </Badge>
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  Autorização vinculada ao projeto Google Cloud (OAuth 2.0 +
                  PKCE em modo <strong>READ_ONLY</strong>).{" "}
                  <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> não é mais obrigatório.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px]">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 px-3 py-2">
                    <span className="text-slate-600 dark:text-slate-300 block">
                      URL de Callback Oficial
                    </span>
                    <code className="text-cyan-700 dark:text-cyan-400 break-all">
                      {googleAdsConfigStatus.callbackUrl}
                    </code>
                    {!googleAdsConfigStatus.callbackUrlValid &&
                      googleAdsConfigStatus.callbackUrlError && (
                        <p className="text-red-600 dark:text-red-300 mt-1">
                          {googleAdsConfigStatus.callbackUrlError}
                        </p>
                      )}
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 px-3 py-2">
                    <span className="text-slate-600 dark:text-slate-300 block">
                      Credenciais Obrigatórias (Google Cloud)
                    </span>
                    {googleAdsConfigStatus.missingVariables.length === 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                        GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET ativos
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-300 font-medium">
                        Pendente:{" "}
                        {googleAdsConfigStatus.missingVariables.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {integrations.map((intg) => (
                <div
                  key={intg.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {intg.label}
                        </span>
                        <Badge
                          variant={
                            intg.status === "CONNECTED"
                              ? "success"
                              : intg.status === "SANDBOX_DEMO"
                                ? "demo"
                                : intg.status === "REVOKED"
                                  ? "destructive"
                                  : "warning"
                          }
                        >
                          {intg.status}
                        </Badge>
                        <Badge variant="default">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          {intg.mode}
                        </Badge>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-1">
                        {intg.message}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {intg.provider === "GOOGLE_ADS" &&
                        !activeOrganization.isDemo && (
                          <a
                            href="/api/integrations/google-ads/authorize"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/20"
                          >
                            <ExternalLink
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            Conectar OAuth 2.0 Google Ads
                          </a>
                        )}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSubmitting || activeOrganization.isDemo}
                        onClick={() => handleTriggerSync(intg.id)}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            isSubmitting ? "animate-spin" : ""
                          }`}
                          aria-hidden="true"
                        />
                        Solicitar Sincronização
                      </Button>

                      {intg.status !== "REVOKED" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSubmitting || activeOrganization.isDemo}
                          onClick={() => handleRevokeIntegration(intg.id)}
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                          Revogar Credenciais
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <div>
                      Criptografia Vault:{" "}
                      <strong className="text-slate-800 dark:text-slate-200">
                        AES-256-GCM + AAD (orgId + integrationId)
                      </strong>
                    </div>
                    <div>
                      Última Sincronização:{" "}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {intg.lastSyncedAtIso ?? "Nenhuma sincronização"}
                      </strong>
                    </div>
                    <div>
                      Checkpoint Incremental:{" "}
                      <code className="text-cyan-600 dark:text-cyan-400">
                        {intg.lastCheckpoint ?? "N/D"}
                      </code>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Persistent Sync Runs History */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">
                  Histórico de Sincronizações Persistidas (<code>sync_runs</code>)
                </h4>
                <Badge variant="secondary">
                  {syncHistory.length} execuções
                </Badge>
              </div>
              {syncHistory.length === 0 ? (
                <p className="text-slate-500 py-4 text-center">
                  Nenhuma sincronização registrada para esta organização.
                </p>
              ) : (
                <div className="space-y-2">
                  {syncHistory.map((sr) => (
                    <div
                      key={sr.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold">{sr.provider}</span> •{" "}
                        <Badge
                          variant={
                            sr.status === "COMPLETED"
                              ? "success"
                              : sr.status === "FAILED"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {sr.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Checkpoint:{" "}
                        <code>{sr.checkpointToken ?? "N/D"}</code> • Início:{" "}
                        {sr.startedAtIso}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: MEMBERS & RBAC PERMISSIONS */}
        {activeTab === "members" && (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Membro</th>
                    <th className="px-4 py-2.5">E-mail</th>
                    <th className="px-4 py-2.5">Papel RBAC</th>
                    <th className="px-4 py-2.5">Escopo de Clientes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 font-medium">{m.fullName}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {m.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            m.role === "OWNER" || m.role === "ADMIN"
                              ? "default"
                              : m.role === "CLIENT_VIEWER"
                                ? "warning"
                                : "secondary"
                          }
                        >
                          {m.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {m.role === "CLIENT_VIEWER" ? (
                          <span className="text-amber-600 dark:text-amber-300 font-medium">
                            Restrito a {m.allowedClientIds.length} cliente(s):{" "}
                            <code>{m.allowedClientIds.join(", ")}</code>
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Acesso a todos os clientes da organização
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: SETTINGS & PERSISTENT AUDIT TRAIL */}
        {activeTab === "settings" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <ShieldCheck className="h-4 w-4 text-cyan-400" />
                <span>Parâmetros de Governança da Organização</span>
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Configurações validadas no servidor para{" "}
                <strong>{activeOrganization.name}</strong>:
              </p>
              <ul className="space-y-1.5 pt-2 text-slate-700 dark:text-slate-300">
                <li>
                  • Modo de Execução Padrão:{" "}
                  <Badge variant="default">
                    {activeOrganization.executionMode}
                  </Badge>
                </li>
                <li>
                  • Limite Máximo de Alteração Diária de Orçamento:{" "}
                  <strong>±{activeOrganization.maxDailyBudgetChangePct}%</strong>
                </li>
                <li>
                  • Janela Mínima de Cooldown entre Execuções:{" "}
                  <strong>{activeOrganization.minCooldownMinutes} minutos</strong>
                </li>
                <li>
                  • Moeda & Fuso Padrão:{" "}
                  <strong>
                    {activeOrganization.currencyCode} •{" "}
                    {activeOrganization.timezone}
                  </strong>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">
                  Trilha de Auditoria Persistida (<code>audit_logs</code>)
                </span>
                <Badge variant="secondary">{auditTrail.length} eventos</Badge>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {auditTrail.length === 0 ? (
                  <p className="text-slate-500 py-4 text-center">
                    Nenhum evento de auditoria registrado.
                  </p>
                ) : (
                  auditTrail.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2.5"
                    >
                      <div className="flex items-center justify-between text-[11px] text-cyan-600 dark:text-cyan-400">
                        <strong>{ev.action}</strong>
                        <span>{ev.timestamp}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5 truncate">
                        {ev.entityType} ({ev.entityId}): {ev.detail}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
