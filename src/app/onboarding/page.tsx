"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { onboardOrganizationAction } from "@/app/actions/operational-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function OnboardingPage() {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [organizationName, setOrganizationName] = React.useState("");
  const [organizationSlug, setOrganizationSlug] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleOrgNameChange = (val: string) => {
    setOrganizationName(val);
    const autoSlug = val
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setOrganizationSlug(autoSlug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await onboardOrganizationAction({
        fullName,
        email,
        password,
        organizationName,
        organizationSlug,
      });

      if (!res.ok) {
        const details: string[] = [];
        if (res.failedStep) details.push(`Etapa: ${res.failedStep}`);
        if (res.requestId) details.push(`Ref.: ${res.requestId}`);
        const suffix = details.length > 0 ? ` (${details.join(" | ")})` : "";
        setError(`${res.error ?? "Erro ao criar organização."}${suffix}`);
        return;
      }

      window.location.assign("/");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#060d1a] text-slate-900 dark:text-slate-100 p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl overflow-hidden border border-cyan-500/40 bg-[#060d1a] shadow-lg">
            <Image
              src="/konnexy-logo.jpg"
              alt="Logo Oficial Konnexy Ads"
              width={56}
              height={56}
              className="object-cover h-full w-full"
              priority
            />
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            Onboarding — Criar Organização Multi-Tenant
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Configure sua agência ou negócio local em modo seguro{" "}
            <code>READ_ONLY</code>
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-cyan-400" />
                Dados do Proprietário (OWNER) & Organização
              </CardTitle>
              <Badge variant="default">
                <ShieldCheck className="h-3 w-3" />
                RLS + PostgreSQL
              </Badge>
            </div>
            <CardDescription>
              Todos os registros são persistidos no PostgreSQL com trilha de
              auditoria
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <div
                role="alert"
                data-testid="onboarding-error-alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="onboard-fullname"
                  className="block text-xs font-medium mb-1"
                >
                  Seu Nome Completo
                </label>
                <input
                  id="onboard-fullname"
                  data-testid="onboard-fullname-input"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex.: Massami Shitara"
                  className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="onboard-email"
                  className="block text-xs font-medium mb-1"
                >
                  E-mail Corporativo
                </label>
                <input
                  id="onboard-email"
                  data-testid="onboard-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="diretoria@konnexy.com.br"
                  className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="onboard-password"
                  className="block text-xs font-medium mb-1"
                >
                  Senha Forte (mínimo 10 caracteres)
                </label>
                <input
                  id="onboard-password"
                  data-testid="onboard-password-input"
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo de 10 caracteres"
                  className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="onboard-orgname"
                    className="block text-xs font-medium mb-1"
                  >
                    Nome da Organização / Agência
                  </label>
                  <input
                    id="onboard-orgname"
                    data-testid="onboard-orgname-input"
                    type="text"
                    required
                    value={organizationName}
                    onChange={(e) => handleOrgNameChange(e.target.value)}
                    placeholder="Ex.: Konnexy Performance"
                    className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="onboard-orgslug"
                    className="block text-xs font-medium mb-1"
                  >
                    Identificador Único (Slug)
                  </label>
                  <input
                    id="onboard-orgslug"
                    data-testid="onboard-orgslug-input"
                    type="text"
                    required
                    value={organizationSlug}
                    onChange={(e) => setOrganizationSlug(e.target.value)}
                    placeholder="konnexy-performance"
                    className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                data-testid="onboard-submit-btn"
                className="w-full"
              >
                {loading
                  ? "Provisionando Tenant no PostgreSQL..."
                  : "Criar Organização e Acessar Dashboard"}
              </Button>
            </form>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-center text-xs">
              <Link
                href="/login"
                className="text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                Já possui uma organização cadastrada? Fazer Login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
