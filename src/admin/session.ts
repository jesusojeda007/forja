/**
 * Admin dashboard session — a signed cookie so the owner logs in once with a
 * normal form instead of the browser's Basic Auth dialog on every visit.
 *
 * The cookie payload is just the expiry timestamp; it's signed (HMAC) with the
 * `DASHBOARD_PASSWORD` secret via Hono's signed-cookie helper. Rotating the
 * password therefore invalidates every existing session — intended.
 *
 * Basic Auth still works in parallel (curl, API clients, the control plane) —
 * see the guard in routes.ts.
 */
import type { Context } from "hono";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import type { AdminRole } from "./auth";

export const SESSION_COOKIE = "forja_admin";

/** 30 días. Se renueva en cada login. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Ctx = Context<{ Bindings: Env; Variables: { role: AdminRole } }>;

/** Emite la cookie de sesión firmada tras un login correcto. */
export async function startAdminSession(c: Ctx): Promise<void> {
  const exp = String(Date.now() + TTL_MS);
  await setSignedCookie(c, SESSION_COOKIE, exp, c.env.DASHBOARD_PASSWORD ?? "", {
    path: "/admin",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

/** true si la request trae una cookie de sesión válida y no vencida. */
export async function hasAdminSession(c: Ctx): Promise<boolean> {
  const secret = c.env.DASHBOARD_PASSWORD;
  if (!secret) return false;
  let value: string | false | undefined;
  try {
    value = await getSignedCookie(c, secret, SESSION_COOKIE);
  } catch {
    return false;
  }
  if (!value) return false;
  const exp = Number(value);
  return Number.isFinite(exp) && exp > Date.now();
}

/** Borra la cookie (logout). */
export function endAdminSession(c: Ctx): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/admin" });
}
