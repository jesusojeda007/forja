import { describe, it, expect } from "vitest";
import { adminApp } from "../../src/admin/routes";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";

const stubDb = () => {
  const stmt: any = {
    bind: () => stmt,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
  return { prepare: () => stmt } as unknown as D1Database;
};

function makeEnv(over: Record<string, unknown> = {}): Env {
  return {
    DB: stubDb(),
    DASHBOARD_PASSWORD: PASSWORD,
    BUSINESS_NAME: "Test Biz",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    ...over,
  } as unknown as Env;
}
const req = (path: string, init?: RequestInit) => new Request(`https://bot.test${path}`, init);
const htmlGet = (path: string) => req(path, { headers: { accept: "text/html" } });

describe("admin login (formulario + cookie de sesión)", () => {
  it("GET /admin/login renderiza el formulario de contraseña", async () => {
    const res = await adminApp.fetch(req("/login"), makeEnv());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="password"');
    expect(html).toContain("Test Biz");
    expect(html).not.toContain("Basic realm");
  });

  it("un navegador sin sesión es redirigido a /admin/login?next=…", async () => {
    const res = await adminApp.fetch(htmlGet("/config"), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login?next=%2Fadmin%2Fconfig");
  });

  it("un cliente no-navegador sigue recibiendo 401 (no redirect)", async () => {
    const res = await adminApp.fetch(req("/config"), makeEnv());
    expect(res.status).toBe(401);
  });

  it("POST /admin/login con contraseña incorrecta → redirect ?error=1, sin cookie", async () => {
    const body = new URLSearchParams({ password: "nope" });
    const res = await adminApp.fetch(req("/login", { method: "POST", body }), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login?error=1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("POST /admin/login OK → set-cookie firmado + redirect a overview; la cookie abre rutas protegidas", async () => {
    const body = new URLSearchParams({ password: PASSWORD });
    const res = await adminApp.fetch(req("/login", { method: "POST", body }), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("forja_admin=");
    expect(cookie).toContain("HttpOnly");

    const jar = cookie!.split(";")[0];
    const protectedRes = await adminApp.fetch(
      req("/config", { headers: { accept: "text/html", cookie: jar } }),
      makeEnv(),
    );
    expect(protectedRes.status).toBe(200);
  });

  it("respeta ?next= (solo rutas /admin, no open redirect)", async () => {
    const ok = await adminApp.fetch(
      req("/login?next=%2Fadmin%2Fkb", { method: "POST", body: new URLSearchParams({ password: PASSWORD }) }),
      makeEnv(),
    );
    expect(ok.headers.get("location")).toBe("/admin/kb");

    const evil = await adminApp.fetch(
      req("/login?next=https%3A%2F%2Fevil.com", { method: "POST", body: new URLSearchParams({ password: PASSWORD }) }),
      makeEnv(),
    );
    expect(evil.headers.get("location")).toBe("/admin/overview");
  });

  it("POST /admin/logout borra la cookie y manda a /admin/login", async () => {
    const res = await adminApp.fetch(req("/logout", { method: "POST" }), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/forja_admin=;|Max-Age=0/);
  });

  it("Basic Auth sigue funcionando en paralelo", async () => {
    const token = Buffer.from(`admin:${PASSWORD}`).toString("base64");
    const res = await adminApp.fetch(
      req("/config", { headers: { Authorization: `Basic ${token}` } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("una ruta con barra final redirige (308) a la versión sin barra", async () => {
    for (const [path, target] of [
      ["/config/", "/config"],
      ["/overview/", "/overview"],
    ]) {
      const res = await adminApp.fetch(req(path, { headers: { accept: "text/html" } }), makeEnv());
      expect(res.status, path).toBe(308);
      expect(res.headers.get("location")).toBe(target);
    }
  });

  it("DASHBOARD_PUBLIC=1 saltea el login por completo", async () => {
    const res = await adminApp.fetch(htmlGet("/config"), makeEnv({ DASHBOARD_PUBLIC: "1" }));
    expect(res.status).toBe(200);
  });
});
