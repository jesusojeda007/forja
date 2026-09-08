/**
 * Admin dashboard authentication — HTTP Basic Auth (username is always "admin").
 *
 * Dos passwords posibles (ver resolveRole): el completo (DASHBOARD_PASSWORD, rol
 * "owner") y el opcional de cliente (CLIENT_PASSWORD, rol "client" — Modo
 * Agencia). No hay login form, cookie ni magic link: el diálogo nativo del
 * navegador captura las credenciales. El guard vive en admin/routes.ts.
 */
import type { Env } from "../env";

/** Fixed username for the admin dashboard. */
export const ADMIN_USERNAME = "admin";

/**
 * Roles del panel (Modo Agencia · pieza B):
 *  - "owner"  → password completo (DASHBOARD_PASSWORD). Acceso total.
 *  - "client" → password de cliente (CLIENT_PASSWORD, whitelabel). Vista recortada:
 *               sin Config, Conexiones, Flujo, Conocimiento, Mejoras, Campañas ni Costos.
 * Sin CLIENT_PASSWORD, el rol "client" no existe.
 */
export type AdminRole = "owner" | "client";

/** Tabs (ids del NAV = sufijos de ruta) que el rol "client" no ve ni puede abrir. */
export const CLIENT_HIDDEN_TABS = [
  "config",
  "conexiones",
  "costs",
  "mejoras",
  "campanas",
  "agente",
  "kb",
] as const;

/**
 * Constant-time string comparison to avoid leaking length/content via timing.
 * Returns true only when both strings are byte-for-byte identical.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Fold the length mismatch into the result while still iterating over the
  // longer of the two to keep timing stable.
  let diff = ab.length ^ bb.length;
  const max = Math.max(ab.length, bb.length);
  for (let i = 0; i < max; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** Decode a base64 string in both Worker (atob) and Node/test (Buffer) runtimes. */
function decodeBase64(input: string): string | null {
  try {
    if (typeof atob === "function") {
      return atob(input);
    }
    return Buffer.from(input, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Pure credential check for an HTTP `Authorization` header value.
 *
 * Accepts a value like `Basic YWRtaW46c2VjcmV0MTIz` and returns true only when
 * it decodes to `admin:<DASHBOARD_PASSWORD>`. Has no Hono dependency so it can
 * be unit-tested directly.
 *
 * @param headerValue the raw `Authorization` header value (may be undefined/null)
 * @param env         environment carrying `DASHBOARD_PASSWORD`
 */
export function checkBasicCredentials(
  headerValue: string | null | undefined,
  env: Env,
): boolean {
  if (!headerValue) return false;

  const match = /^Basic\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return false;

  const decoded = decodeBase64(match[1].trim());
  if (decoded === null) return false;

  // Split only on the FIRST colon: passwords may legitimately contain colons.
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  const userOk = timingSafeEqual(username, ADMIN_USERNAME);
  const passOk = timingSafeEqual(password, env.DASHBOARD_PASSWORD ?? "");
  return userOk && passOk;
}

/**
 * Igual que checkBasicCredentials pero contra un password explícito (para el
 * password de cliente). Devuelve true sólo si el header decodifica a
 * `admin:<expectedPassword>`.
 */
export function checkBasicAgainst(
  headerValue: string | null | undefined,
  expectedPassword: string,
): boolean {
  if (!headerValue || !expectedPassword) return false;
  const match = /^Basic\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return false;
  const decoded = decodeBase64(match[1].trim());
  if (decoded === null) return false;
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const userOk = timingSafeEqual(decoded.slice(0, sep), ADMIN_USERNAME);
  const passOk = timingSafeEqual(decoded.slice(sep + 1), expectedPassword);
  return userOk && passOk;
}

/**
 * Resuelve el rol de una request al panel. null = credenciales no válidas.
 * El password de owner gana siempre; el de cliente sólo cuenta si está
 * configurado y es distinto del de owner.
 */
export function resolveRole(
  headerValue: string | null | undefined,
  env: Env,
): AdminRole | null {
  if (checkBasicCredentials(headerValue, env)) return "owner";
  const clientPw = (env.CLIENT_PASSWORD ?? "").trim();
  if (clientPw && clientPw !== (env.DASHBOARD_PASSWORD ?? "").trim() && checkBasicAgainst(headerValue, clientPw)) {
    return "client";
  }
  return null;
}
