import { describe, it, expect } from "vitest";
import { adminApp } from "../../src/admin/routes";
import { resolveRole, ADMIN_USERNAME, CLIENT_HIDDEN_TABS } from "../../src/admin/auth";
import { layout } from "../../src/admin/views/layout";
import type { Env } from "../../src/env";

const OWNER_PW = "owner-secret";
const CLIENT_PW = "client-secret";

/** D1 stub mínimo: toda query devuelve vacío. */
function stubDb(): D1Database {
  const stmt: any = {
    bind: () => stmt,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 0 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

function env(over: Partial<Env> = {}): Env {
  return {
    DB: stubDb(),
    DASHBOARD_PASSWORD: OWNER_PW,
    CLIENT_PASSWORD: CLIENT_PW,
    BUSINESS_NAME: "Biz",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    OWNER_EMAIL: "o@e.com",
    BOT_NAME: "Bot",
    ...over,
  } as unknown as Env;
}

function basic(pw: string, user = ADMIN_USERNAME): string {
  return `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
}
const reqTo = (path: string, pw?: string) =>
  new Request(`https://bot.test${path}`, pw ? { headers: { Authorization: basic(pw) } } : undefined);

describe("resolveRole", () => {
  it("password completo => owner", () => {
    expect(resolveRole(basic(OWNER_PW), env())).toBe("owner");
  });
  it("password de cliente => client", () => {
    expect(resolveRole(basic(CLIENT_PW), env())).toBe("client");
  });
  it("password equivocado => null", () => {
    expect(resolveRole(basic("nope"), env())).toBeNull();
  });
  it("sin CLIENT_PASSWORD configurado, ese rol no existe", () => {
    expect(resolveRole(basic(CLIENT_PW), env({ CLIENT_PASSWORD: undefined }))).toBeNull();
  });
  it("CLIENT_PASSWORD igual al de owner no degrada a client", () => {
    expect(resolveRole(basic(OWNER_PW), env({ CLIENT_PASSWORD: OWNER_PW }))).toBe("owner");
  });
});

describe("adminApp — guard de rol cliente", () => {
  it("401 sin credenciales", async () => {
    expect((await adminApp.fetch(reqTo("/tickets"), env())).status).toBe(401);
  });

  it("owner entra a /config", async () => {
    const res = await adminApp.fetch(reqTo("/config", OWNER_PW), env());
    expect(res.status).toBe(200);
  });

  it("client NO entra a /config ni /costs ni /conexiones — lo manda a overview", async () => {
    for (const p of ["/config", "/costs", "/conexiones", "/agente", "/kb", "/mejoras", "/campanas"]) {
      const res = await adminApp.fetch(reqTo(p, CLIENT_PW), env());
      expect(res.status, p).toBe(302);
      expect(res.headers.get("location"), p).toBe("/admin/overview");
    }
  });

  it("client sí entra a /tickets", async () => {
    const res = await adminApp.fetch(reqTo("/tickets", CLIENT_PW), env());
    expect(res.status).toBe(200);
  });

  it("client no ve URLs de otros bots en /projects", async () => {
    const res = await adminApp.fetch(
      reqTo("/projects", CLIENT_PW),
      env({ PEER_BOTS: JSON.stringify([{ name: "Otro", url: "https://otro.workers.dev/admin" }]) }),
    );
    const body = (await res.json()) as { peers: unknown[] };
    expect(body.peers).toEqual([]);
  });
});

describe("layout — nav por rol", () => {
  const page = (role?: "owner" | "client") =>
    layout({ title: "T", activeTab: "tickets", body: "x", env: env(), role });

  it("client no ve los tabs peligrosos en el sidebar", () => {
    const html = page("client");
    for (const id of CLIENT_HIDDEN_TABS) {
      expect(html, id).not.toContain(`href="/admin/${id}"`);
    }
    expect(html).toContain('href="/admin/tickets"');
    expect(html).toContain('href="/admin/conversations"');
  });

  it("owner (default) ve todo", () => {
    const html = page();
    expect(html).toContain('href="/admin/config"');
    expect(html).toContain('href="/admin/costs"');
  });
});
