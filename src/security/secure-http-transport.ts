import https from "https";
import net from "net";
import {
  resolveAndValidateSafeExternalUrl,
  type DnsResolverFn,
} from "./vault-and-guards";
import { redactSensitiveData } from "./public-errors";

export const OFFICIAL_ALLOWED_EXTERNAL_HOSTS: ReadonlySet<string> =
  new Set<string>([
    "accounts.google.com",
    "oauth2.googleapis.com",
    "www.googleapis.com",
    "googleads.googleapis.com",
    "ads.konnexy.com.br",
  ]);

export interface PinnedHttpsRequestOptions {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly dnsResolver?: DnsResolverFn;
  readonly allowedHosts?: ReadonlySet<string>;
  /**
   * Optional custom socket/request executor for deterministic testing while
   * still running the full allowlist + DNS validation + IP pinning pipeline.
   */
  readonly customPinnedExecutor?: (pinnedReq: {
    readonly pinnedAddress: string;
    readonly family: 4 | 6;
    readonly servername: string;
    readonly pathWithQuery: string;
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly timeoutMs: number;
  }) => Promise<{
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    readonly bodyText: string;
  }>;
}

export interface PinnedHttpsResponse {
  readonly statusCode: number;
  readonly pinnedAddress: string;
  readonly hostname: string;
  readonly bodyText: string;
  readonly json: <T = unknown>() => T;
}

/**
 * Server-side HTTPS transport that prevents SSRF and DNS Rebinding (TOCTOU):
 * 1. Enforces destination host allowlist (`OFFICIAL_ALLOWED_EXTERNAL_HOSTS`).
 * 2. Validates HTTPS protocol, port 443, and resolves DNS records.
 * 3. Rejects any private, loopback, link-local, CGNAT, or reserved IPv4/IPv6 address.
 * 4. Connects the TCP/TLS socket DIRECTLY to `pinnedAddress` (no second DNS lookup)
 *    while preserving TLS SNI (`servername: hostname`) and certificate verification (`rejectUnauthorized: true`).
 * 5. Blocks all HTTP redirects (3xx) fail-closed.
 * 6. Enforces timeout and AbortSignal cancellation and scrubs sensitive tokens from errors.
 */
export async function executePinnedHttpsRequest(
  options: PinnedHttpsRequestOptions
): Promise<PinnedHttpsResponse> {
  const {
    url,
    method = "GET",
    headers = {},
    body,
    timeoutMs = 15_000,
    signal,
    dnsResolver,
    allowedHosts = OFFICIAL_ALLOWED_EXTERNAL_HOSTS,
    customPinnedExecutor,
  } = options;

  if (signal?.aborted) {
    throw new Error("Pinned HTTPS Transport: Request aborted before start.");
  }

  const resolved = await resolveAndValidateSafeExternalUrl(url, {
    dnsResolver,
    maxRedirects: 0,
    timeoutMs,
  });

  if (!allowedHosts.has(resolved.hostname)) {
    throw new Error(
      `SSRF Guard: Host '${resolved.hostname}' is not in the official allowed hosts list.`
    );
  }

  const pinnedAddress = resolved.pinnedAddress;
  const family: 4 | 6 = net.isIPv6(pinnedAddress) ? 6 : 4;
  const pathWithQuery = `${resolved.url.pathname}${resolved.url.search}`;

  const requestHeaders: Record<string, string> = {
    ...headers,
    Host: resolved.hostname,
    Accept: headers.Accept ?? "application/json",
  };

  if (body !== undefined) {
    requestHeaders["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
  }

  const rawResult = customPinnedExecutor
    ? await customPinnedExecutor({
        pinnedAddress,
        family,
        servername: resolved.hostname,
        pathWithQuery,
        method,
        headers: requestHeaders,
        body,
        timeoutMs,
      })
    : await new Promise<{
        readonly statusCode: number;
        readonly headers: Readonly<
          Record<string, string | string[] | undefined>
        >;
        readonly bodyText: string;
      }>((resolve, reject) => {
        const req = https.request(
          {
            // Connect directly to the validated IP address (eliminates DNS rebinding TOCTOU)
            host: pinnedAddress,
            family,
            port: 443,
            path: pathWithQuery,
            method,
            headers: requestHeaders,
            // Preserve TLS SNI and strict X.509 certificate hostname verification
            servername: resolved.hostname,
            rejectUnauthorized: true,
            timeout: timeoutMs,
            lookup: (_hostname, _opts, cb) => {
              // Pin the socket lookup strictly to the already validated IP
              cb(null, pinnedAddress, family);
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              const bodyText = Buffer.concat(chunks).toString("utf8");
              resolve({
                statusCode: res.statusCode ?? 0,
                headers: res.headers,
                bodyText,
              });
            });
          }
        );

        const onAbort = () => {
          req.destroy(
            new Error("Pinned HTTPS Transport: Request cancelled by AbortSignal.")
          );
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        req.on("timeout", () => {
          req.destroy(
            new Error(
              `Pinned HTTPS Transport: Timed out after ${timeoutMs}ms connecting to ${resolved.hostname}.`
            )
          );
        });

        req.on("error", (err) => {
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          const safeMessage = redactSensitiveData(err.message);
          reject(new Error(`Pinned HTTPS Transport Error: ${safeMessage}`));
        });

        if (body !== undefined) {
          req.write(body);
        }
        req.end();
      });

  // Fail-closed on any redirect status code (300-399)
  if (rawResult.statusCode >= 300 && rawResult.statusCode < 400) {
    throw new Error(
      `SSRF Guard: Unauthorized HTTP redirect (${rawResult.statusCode}) from '${resolved.hostname}' was blocked.`
    );
  }

  return {
    statusCode: rawResult.statusCode,
    pinnedAddress,
    hostname: resolved.hostname,
    bodyText: rawResult.bodyText,
    json: <T = unknown>() => JSON.parse(rawResult.bodyText) as T,
  };
}
