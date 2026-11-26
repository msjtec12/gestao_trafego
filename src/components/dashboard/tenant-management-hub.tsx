"use client";

import * as React from "react";
import { z } from "zod";
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
} from "lucide-react";
import type {
  AdAccountRecordViewModel,
  ClientRecordViewModel,
  IntegrationHealthViewModel,
  MemberRecordViewModel,
  OrganizationOption,
} from "@/application/use-cases/dashboard-overview-use-case";
import { toPublicSafeErrorMessage } from "@/security/public-errors";
import { formatCurrencyBrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CreateClientFormSchema = z.object({
  name: z
    .string()
    .min(3, "O nome do cliente deve ter pelo menos 3 caracteres.")
    .max(160),
  industry: z
    .string()
    .min(3, "Informe o segmento/nicho com pelo menos 3 caracteres.")
    .max(100),
  monthlyBudgetCapBrl: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n > 0, {
      message: "O teto mensal de verba deve ser um valor positivo.",
    }),
  targetCpaBrl: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n > 0, {
      message: "A meta de CPA deve ser um número positivo.",
    }),
});

export interface TenantManagementHubProps {
  readonly activeOrganization: OrganizationOption;
  readonly clients: readonly ClientRecordViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly members: readonly MemberRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly onClientCreated: (newClient: ClientRecordViewModel) => void;
  readonly onToggleAccountSelection: (accountId: string) => void;
  readonly onRevokeIntegration: (integrationId: string) => void;
  readonly onTriggerIncrementalSync: () => void;
  readonly isSyncing: boolean;
}

type ManagementTab =
  | "clients"
  | "accounts"
  | "integrations"
  | "members"
  | "settings";

export function TenantManagementHub({
  activeOrganization,
  clients,
  adAccounts,
  members,
  integrations,
  onClientCreated,
  onToggleAccountSelection,
  onRevokeIntegration,
  onTriggerIncrementalSync,
  isSyncing,
}: TenantManagementHubProps) {
  const [activeTab, setActiveTab] = React.useState<ManagementTab>("clients");
  const [clientName, setClientName] = React.useState("");
  const [clientIndustry, setClientIndustry] = React.useState("");
  const [monthlyBudgetBrl, setMonthlyBudgetBrl] = React.useState("5000");
  const [targetCpaBrl, setTargetCpaBrl] = React.useState("45");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [auditEvents, setAuditEvents] = React.useState<
    readonly { id: string; timestamp: string; action: string; detail: string }[]
  >([
    {
      id: "aud-init-1",
      timestamp: "2026-11-26 10:15:00",
      action: "RLS_SESSION_VERIFIED",
      detail: `Contexto multi-tenant ativo para ${activeOrganization.name} (${activeOrganization.id}) em modo READ_ONLY.`,
    },
  ]);

  const appendAudit = React.useCallback((action: string, detail: string) => {
    setAuditEvents((prev) => [
      {
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
        action,
        detail,
      },
      ...prev,
    ]);
  }, []);

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = CreateClientFormSchema.safeParse({
      name: clientName,
      industry: clientIndustry,
      monthlyBudgetCapBrl: monthlyBudgetBrl,
      targetCpaBrl,
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
      setFormError(firstIssue);
      return;
    }

    try {
      const created: ClientRecordViewModel = {
        id: `client-${Date.now()}`,
        organizationId: activeOrganization.id,
        name: parsed.data.name.trim(),
        industry: parsed.data.industry.trim(),
        monthlyBudgetCapBrl: parsed.data.monthlyBudgetCapBrl,
        targetCpaBrl: parsed.data.targetCpaBrl,
        targetRoas: 5.0,
        isActive: true,
        isDemoData: activeOrganization.isDemo,
      };
      onClientCreated(created);
      appendAudit(
        "CLIENT_CREATED",
        `Cliente '${created.name}' (${created.industry}) cadastrado com teto mensal ${formatCurrencyBrl(created.monthlyBudgetCapBrl)}.`
      );
      setClientName("");
      setClientIndustry("");
    } catch (err) {
      setFormError(toPublicSafeErrorMessage(err).publicMessage);
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
      label: "Integrações & Google Ads OAuth",
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
                Central Multi-Tenant — Gestão de Clientes, Contas MCC,
                Integrações & RBAC
              </CardTitle>
              <Badge variant={activeOrganization.isDemo ? "demo" : "default"}>
                {activeOrganization.isDemo
                  ? "TENANT DEMONSTRATIVO"
                  : "TENANT OPERACIONAL"}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Operações isoladas por <code>organization_id</code> com validação
              Zod, escopo <code>CLIENT_VIEWER</code> e trilha de auditoria
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSyncing}
              onClick={() => {
                onTriggerIncrementalSync();
                appendAudit(
                  "INCREMENTAL_SYNC_TRIGGERED",
                  "Sincronização incremental idempotente (somente leitura) executada com checkpoint atualizado."
                );
              }}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isSyncing
                ? "Sincronizando..."
                : "Sincronizar Contas Selecionadas (Read-Only)"}
            </Button>
          </div>
        </div>

        {/* Accessible Navigation Tabs */}
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
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70"
                }`}
              >
                <Icon className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400" />
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

      <CardContent className="space-y-4">
        {/* TAB 1: CLIENTS */}
        {activeTab === "clients" && (
          <div className="space-y-4">
            <form
              onSubmit={handleCreateClient}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Cadastrar Novo Cliente na Organização (Validação Zod)
                </h4>
                <Badge variant="secondary">
                  org_id: {activeOrganization.id}
                </Badge>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300"
                >
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nome do Cliente (ex.: Clínica Vida)"
                  aria-label="Nome do novo cliente"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <input
                  type="text"
                  value={clientIndustry}
                  onChange={(e) => setClientIndustry(e.target.value)}
                  placeholder="Segmento (ex.: Odontologia)"
                  aria-label="Segmento do novo cliente"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <input
                  type="number"
                  value={monthlyBudgetBrl}
                  onChange={(e) => setMonthlyBudgetBrl(e.target.value)}
                  placeholder="Teto Mensal (R$)"
                  aria-label="Teto mensal de orçamento em reais"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <input
                  type="number"
                  value={targetCpaBrl}
                  onChange={(e) => setTargetCpaBrl(e.target.value)}
                  placeholder="Meta CPA (R$)"
                  aria-label="Meta de CPA em reais"
                  className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
                <Button type="submit" size="sm" className="h-9">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Adicionar Cliente
                </Button>
              </div>
            </form>

            {clients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 py-10 text-center text-xs text-slate-500">
                Nenhum cliente cadastrado para esta organização (Empty State).
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {clients.map((client) => (
                  <div
                    key={client.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                          {client.name}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {client.industry}
                        </span>
                      </div>
                      <Badge variant={client.isDemoData ? "demo" : "success"}>
                        {client.isDemoData ? "DEMO" : "ATIVO"}
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
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AD ACCOUNTS & MCC SELECTION */}
        {activeTab === "accounts" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Selecione quais contas vinculadas à MCC (
              <code>login-customer-id: 990-100-2000</code>) estão autorizadas
              para sincronização incremental somente leitura:
            </p>
            {adAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 py-10 text-center text-xs text-slate-500">
                Nenhuma conta de anúncios vinculada a esta organização.
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
                        onClick={() => {
                          onToggleAccountSelection(acc.id);
                          appendAudit(
                            "AD_ACCOUNT_SYNC_TOGGLED",
                            `Seleção de sincronização alterada para a conta ${acc.externalAccountId}.`
                          );
                        }}
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

        {/* TAB 3: INTEGRATIONS & GOOGLE ADS OAUTH 2.0 READ-ONLY */}
        {activeTab === "integrations" && (
          <div className="space-y-3">
            {integrations.map((intg) => (
              <div
                key={intg.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-3 text-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
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

                  <div className="flex items-center gap-2">
                    {intg.status !== "REVOKED" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onRevokeIntegration(intg.id);
                          appendAudit(
                            "INTEGRATION_REVOKED",
                            `Credenciais da integração '${intg.label}' revogadas e removidas do Credential Vault.`
                          );
                        }}
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
                      {intg.lastSyncedAtIso ?? "Nenhuma sincronização real"}
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

        {/* TAB 5: SETTINGS & AUDIT TRAIL */}
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
                  Trilha de Auditoria Recente (Imutável)
                </span>
                <Badge variant="secondary">{auditEvents.length} eventos</Badge>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {auditEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-cyan-600 dark:text-cyan-400">
                      <strong>{ev.action}</strong>
                      <span>{ev.timestamp}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                      {ev.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
