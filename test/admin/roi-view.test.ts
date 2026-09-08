import { describe, it, expect } from "vitest";
import { adminApp } from "../../src/admin/routes";
import { ADMIN_USERNAME } from "../../src/admin/auth";
import type { Env } from "../../src/env";

const OWNER = "owner-pw";
const CLIENT = "client-pw";

function stubDb(): D1Database {
  const stmt: any = {
    bind: () => stmt,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 1 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

const env = () =>
  ({
    DB: stubDb(),
    DASHBOARD_PASSWORD: OWNER,
    CLIENT_PASSWORD: CLIENT,
    BUSINESS_NAME: "Biz",
    BOT_NAME: "Bot",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    OWNER_EMAIL: "o@e.com",
  }) as unknown as Env;

const auth = (pw: string) => ({
  Authorization: `Basic ${Buffer.from(`${ADMIN_USERNAME}:${pw}`).toString("base64")}`,
});
const req = (path: string, pw: string) => new Request(`https://b.test${path}`, { headers: auth(pw) });

describe("/admin/roi — Retorno", () => {
  it("el dueño lo ve", async () => {
    const res = await adminApp.fetch(req("/roi", OWNER), env());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Retorno");
  });

  it("el cliente TAMBIÉN lo ve (es la justificación de la mensualidad)", async () => {
    const res = await adminApp.fetch(req("/roi", CLIENT), env());
    expect(res.status).toBe(200);
  });

  it("aparece en el nav", async () => {
    const res = await adminApp.fetch(req("/roi", OWNER), env());
    expect(await res.text()).toContain('href="/admin/roi"');
  });
});
