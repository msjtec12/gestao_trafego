/**
 * Client-safe security helpers (NO Node.js built-in imports).
 * Safe to import from both server code and "use client" components.
 */

const SENSITIVE_KEYS_REGEX =
  /^(password|secret|token|access_?token|refresh_?token|client_?secret|api_?key|authorization|developer_?token|encrypted_?.*|cookie|session_?token|private_?key|webhook_?secret)$/i;

const INLINE_BEARER_OR_KEY_REGEX =
  /(Bearer\s+[A-Za-z0-9\-._~+/]+=*|sk-[A-Za-z0-9]{16,}|ya29\.[A-Za-z0-9\-_]+|1\/\/0[A-Za-z0-9\-_]+|postgresql:\/\/[^\s"']+)/gi;

export function redactSensitiveData<T>(
  payload: T,
  seen: WeakSet<object> = new WeakSet()
): T {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === "string") {
    return payload.replace(
      INLINE_BEARER_OR_KEY_REGEX,
      "[REDACTED_TOKEN]"
    ) as unknown as T;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactSensitiveData(item, seen)) as unknown as T;
  }

  if (typeof payload === "object") {
    if (seen.has(payload as object)) {
      return "[CIRCULAR_REF]" as unknown as T;
    }
    seen.add(payload as object);

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>
    )) {
      if (SENSITIVE_KEYS_REGEX.test(key)) {
        clean[key] = "[REDACTED]";
      } else {
        clean[key] = redactSensitiveData(value, seen);
      }
    }
    return clean as T;
  }

  return payload;
}

/**
 * Sanitizes errors before returning to HTTP clients or UI so internal SQL,
 * file paths, database connection strings, or stack traces are never exposed.
 */
export function toPublicSafeErrorMessage(
  error: unknown,
  fallbackMessage = "Não foi possível concluir a operação. Tente novamente ou contate o administrador."
): { readonly publicMessage: string; readonly errorCode: string } {
  if (!error || typeof error !== "object") {
    return { publicMessage: fallbackMessage, errorCode: "INTERNAL_ERROR" };
  }

  const errObj = error as {
    name?: string;
    code?: string;
    errorCode?: string;
    message?: string;
  };
  const code = errObj.errorCode ?? errObj.code ?? errObj.name ?? "INTERNAL_ERROR";
  const rawMessage = typeof errObj.message === "string" ? errObj.message : "";

  if (
    String(code) === "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" ||
    rawMessage.includes("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION")
  ) {
    return {
      errorCode: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
      publicMessage:
        "O projeto Google Cloud vinculado às credenciais OAuth possui apenas Acesso de Teste na Google Ads API. Solicite aprovação para produção (Explorer, Basic ou Standard) no Google Cloud Console ou conecte uma conta de teste do Google Ads.",
    };
  }

  const internalLeakPatterns = [
    /postgresql:\/\//i,
    /select\s+.*\s+from\s+/i,
    /insert\s+into\s+/i,
    /c:\\users\\/i,
    /\/home\//i,
    /node_modules/i,
    /at\s+[A-Za-z0-9_.]+\s+\(/i,
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i,
  ];

  if (
    !rawMessage ||
    internalLeakPatterns.some((pattern) => pattern.test(rawMessage))
  ) {
    return {
      publicMessage: fallbackMessage,
      errorCode: String(code),
    };
  }

  return {
    publicMessage: redactSensitiveData(rawMessage),
    errorCode: String(code),
  };
}
