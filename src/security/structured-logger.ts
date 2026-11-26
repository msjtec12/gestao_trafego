import crypto from "crypto";
import { redactSensitiveData } from "@/security/public-errors";

export type FailureCategory =
  | "DATABASE_UNAVAILABLE"
  | "CONFIGURATION_MISSING"
  | "DUPLICATE_EMAIL"
  | "DUPLICATE_SLUG"
  | "INSUFFICIENT_PERMISSION_OR_RLS"
  | "AUTHENTICATION_FAILED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export interface PostgresErrorMetadata {
  readonly pgCode: string | null;
  readonly constraint: string | null;
  readonly table: string | null;
  readonly category: FailureCategory;
  readonly publicMessage: string;
  readonly errorCode: string;
}

interface ErrorLike {
  readonly name?: string;
  readonly code?: string;
  readonly errorCode?: string;
  readonly message?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly cause?: unknown;
}

/**
 * Traverses an Error and its `.cause` chain (Drizzle wraps Postgres errors in
 * `Error("Failed query: ...")` with the real `DatabaseError` inside `.cause`)
 * to extract the underlying PostgreSQL SQLSTATE code and constraint safely.
 */
export function extractPostgresErrorMetadata(
  error: unknown,
  fallbackMessage = "Não foi possível concluir a operação."
): PostgresErrorMetadata {
  let pgCode: string | null = null;
  let constraint: string | null = null;
  let table: string | null = null;
  let appCode: string | null = null;
  let combinedMessage = "";

  let cursor: unknown = error;
  let depth = 0;
  while (cursor && typeof cursor === "object" && depth < 5) {
    const err = cursor as ErrorLike;
    if (typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)) {
      pgCode = pgCode ?? err.code;
    } else if (typeof err.errorCode === "string" && !appCode) {
      appCode = err.errorCode;
    } else if (typeof err.code === "string" && !appCode) {
      appCode = err.code;
    }
    if (typeof err.constraint === "string" && !constraint) {
      constraint = err.constraint;
    }
    if (typeof err.table === "string" && !table) {
      table = err.table;
    }
    if (typeof err.message === "string") {
      combinedMessage = `${combinedMessage} ${err.message}`.trim();
    }
    cursor = err.cause;
    depth += 1;
  }

  const lowerMsg = combinedMessage.toLowerCase();

  // 1. Missing or invalid server configuration / secrets
  if (
    appCode === "DATABASE_CONFIGURATION_ERROR" ||
    appCode === "MISSING_OR_WEAK_SECRET"
  ) {
    return {
      pgCode,
      constraint,
      table,
      category: "CONFIGURATION_MISSING",
      errorCode: appCode,
      publicMessage:
        "Configuração obrigatória do servidor ausente ou inválida (banco de dados ou segredo criptográfico). Contate o administrador.",
    };
  }

  // 2. Authentication failures
  if (
    appCode === "UNAUTHENTICATED_ACCESS" ||
    lowerMsg.includes("e-mail ou senha inválidos") ||
    lowerMsg.includes("muitas tentativas de login")
  ) {
    return {
      pgCode,
      constraint,
      table,
      category: "AUTHENTICATION_FAILED",
      errorCode: appCode ?? "UNAUTHENTICATED_ACCESS",
      publicMessage:
        lowerMsg.includes("muitas tentativas")
          ? redactSensitiveData(
              (error as ErrorLike)?.message ??
                "Muitas tentativas de login. Aguarde antes de tentar novamente."
            )
          : "Falha de autenticação: e-mail ou senha inválidos ou sessão expirada.",
    };
  }

  // 3. Unique constraint violations (23505) or explicit duplicate checks
  if (
    pgCode === "23505" ||
    lowerMsg.includes("e-mail já está cadastrado") ||
    lowerMsg.includes("users_email")
  ) {
    if (
      constraint?.includes("slug") ||
      lowerMsg.includes("organizations_slug") ||
      lowerMsg.includes("slug")
    ) {
      return {
        pgCode: pgCode ?? "23505",
        constraint,
        table,
        category: "DUPLICATE_SLUG",
        errorCode: "DUPLICATE_SLUG",
        publicMessage:
          "Este identificador (slug) de organização já está em uso. Escolha outro slug.",
      };
    }
    return {
      pgCode: pgCode ?? "23505",
      constraint,
      table,
      category: "DUPLICATE_EMAIL",
      errorCode: "DUPLICATE_EMAIL",
      publicMessage:
        "Este e-mail já está cadastrado. Realize o login ou utilize outro e-mail.",
    };
  }

  if (lowerMsg.includes("slug") && lowerMsg.includes("já está em uso")) {
    return {
      pgCode,
      constraint,
      table,
      category: "DUPLICATE_SLUG",
      errorCode: "DUPLICATE_SLUG",
      publicMessage:
        "Este identificador (slug) de organização já está em uso. Escolha outro slug.",
    };
  }

  // 4. PostgreSQL permission denied / RLS policy violation (42501) or RBAC
  if (
    pgCode === "42501" ||
    appCode === "RBAC_PERMISSION_DENIED" ||
    appCode === "TENANT_ISOLATION_VIOLATION" ||
    lowerMsg.includes("row-level security") ||
    lowerMsg.includes("permission denied")
  ) {
    return {
      pgCode: pgCode ?? "42501",
      constraint,
      table,
      category: "INSUFFICIENT_PERMISSION_OR_RLS",
      errorCode: pgCode ? `PG_${pgCode}` : (appCode ?? "PERMISSION_DENIED"),
      publicMessage:
        "Permissão insuficiente no banco de dados ou política de isolamento multi-tenant (RLS) bloqueou a operação.",
    };
  }

  // 5. Database unavailable / network / timeout / WebSocket error
  if (
    pgCode?.startsWith("08") ||
    pgCode === "57P01" ||
    pgCode === "57P03" ||
    pgCode === "53300" ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("enotfound") ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("websocket") ||
    lowerMsg.includes("connection terminated") ||
    lowerMsg.includes("fetch failed")
  ) {
    return {
      pgCode,
      constraint,
      table,
      category: "DATABASE_UNAVAILABLE",
      errorCode: pgCode ? `PG_${pgCode}` : "DATABASE_UNAVAILABLE",
      publicMessage:
        "Banco de dados temporariamente indisponível. Verifique a conectividade com o Neon PostgreSQL e tente novamente.",
    };
  }

  // 6. Zod validation error
  if ((error as ErrorLike)?.name === "ZodError") {
    return {
      pgCode: null,
      constraint: null,
      table: null,
      category: "VALIDATION_ERROR",
      errorCode: "VALIDATION_ERROR",
      publicMessage:
        "Dados informados são inválidos. Verifique os campos obrigatórios (senha com mínimo de 10 caracteres e slug válido).",
    };
  }

  return {
    pgCode,
    constraint,
    table,
    category: "INTERNAL_ERROR",
    errorCode: pgCode ? `PG_${pgCode}` : (appCode ?? "INTERNAL_ERROR"),
    publicMessage: fallbackMessage,
  };
}

export function createRequestCorrelationId(): string {
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Emits a structured, JSON-formatted, strictly sanitized server log entry.
 * NEVER logs passwords, tokens, password hashes, or database connection strings.
 */
export function logStructuredServerFailure(params: {
  readonly requestId: string;
  readonly flow: string;
  readonly step: string;
  readonly operation: string;
  readonly error: unknown;
  readonly extraSafeContext?: Record<string, string | number | boolean | null>;
}): PostgresErrorMetadata {
  const meta = extractPostgresErrorMetadata(params.error);

  const sanitizedEntry = redactSensitiveData({
    level: "error",
    timestamp: new Date().toISOString(),
    requestId: params.requestId,
    flow: params.flow,
    step: params.step,
    operation: params.operation,
    category: meta.category,
    pgCode: meta.pgCode,
    constraint: meta.constraint,
    table: meta.table,
    errorCode: meta.errorCode,
    ...(params.extraSafeContext ?? {}),
  });

  console.error(JSON.stringify(sanitizedEntry));
  return meta;
}
