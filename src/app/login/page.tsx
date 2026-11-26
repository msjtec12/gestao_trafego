"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Lock, ArrowRight, FlaskConical } from "lucide-react";
import { loginUserAction } from "@/app/actions/operational-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await loginUserAction({ email, password });
      if (!res.ok) {
        setError(res.error ?? "E-mail ou senha inválidos.");
        return;
      }
      window.location.assign("/");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#060d1a] text-slate-900 dark:text-slate-100 p-4">
      <div className="w-full max-w-md space-y-4">
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
            KONNEXY <span className="text-cyan-500 dark:text-cyan-400">ADS</span>
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Acesso Autenticado ao Command Center Operacional Multi-Tenant
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Login Operacional</CardTitle>
              <Badge variant="default">
                <Lock className="h-3 w-3" aria-hidden="true" />
                READ_ONLY
              </Badge>
            </div>
            <CardDescription>
              Autentique-se com sua conta persistida no PostgreSQL
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div
                role="alert"
                data-testid="login-error-alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-xs font-medium mb-1"
                >
                  E-mail Corporativo
                </label>
                <input
                  id="login-email"
                  data-testid="login-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="gestor@suaagencia.com.br"
                  className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium mb-1"
                >
                  Senha
                </label>
                <input
                  id="login-password"
                  data-testid="login-password-input"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                data-testid="login-submit-btn"
                className="w-full"
              >
                {loading ? "Validando sessão..." : "Entrar no Command Center"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>

            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cyan-600 dark:text-cyan-300">
                  Credencial Inicial de Bootstrap (OWNER):
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("admin@konnexy.com.br");
                    setPassword("Konnexy#2026");
                  }}
                  className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400 underline cursor-pointer"
                >
                  Preencher automaticamente
                </button>
              </div>
              <p className="font-mono text-[11px]">
                Login: <strong>admin@konnexy.com.br</strong> | Senha:{" "}
                <strong>Konnexy#2026</strong>
              </p>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2 text-xs text-center">
              <Link
                href="/onboarding"
                data-testid="go-to-onboarding-link"
                className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
              >
                Primeira vez? Criar Organização e Conta (Onboarding)
              </Link>
              <Link
                href="/demo"
                data-testid="go-to-demo-link"
                className="inline-flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-300 hover:underline"
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                Acessar Ambiente Demonstrativo Público Separado (/demo)
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
