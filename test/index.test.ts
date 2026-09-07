import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

// `src/index.ts` re-exports `SupportAgent` from `./agent`, which imports the
// `agents` SDK. `agents` (via `partyserver`) imports the virtual
// `cloudflare:workers` module at load time, which Node's ESM loader can't
// resolve outside workerd. Mock the `agents` package so the import graph stays
// in Node-land — we only exercise the Hono router here. Tests that need real
// agent/runtime behavior use Miniflare instead.
vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../src/index";

describe("Worker entry", () => {
  const env = {
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "https://test.workers.dev",
  } as any;

  it("returns 200 on /health", async () => {
    const res = await worker.fetch(new Request("https://test/health"), env, {} as any);
    expect(res.status).toBe(200);
  });

  it("returns 404 on unknown route", async () => {
    const res = await worker.fetch(new Request("https://test/nope"), env, {} as any);
    expect(res.status).toBe(404);
  });

  describe("POST /webhooks/zernio", () => {
    const SECRET = "whsec_zernio";
    const bodyText = JSON.stringify({
      id: "evt_1",
      event: "message.received",
      message: {
        id: "m1",
        conversationId: "conv_1",
        platform: "whatsapp",
        direction: "incoming",
        text: "hola",
        attachments: [],
        sender: { id: "5215512345678", name: "Ana" },
      },
      conversation: { id: "conv_1" },
      account: { id: "acct_1", accountId: "acct_1" },
    });

    function ingestSpyEnv() {
      const ingest = vi.fn(async () => {});
      const zernioEnv = {
        ...env,
        ZERNIO_WEBHOOK_SECRET: SECRET,
        ZERNIO_API_KEY: "sk_test",
        AGENT: { idFromName: () => "do-id", get: () => ({ ingest }) },
      } as any;
      return { zernioEnv, ingest };
    }

    const post = (headers: Record<string, string>, entorno: any) =>
      worker.fetch(
        new Request("https://test/webhooks/zernio", { method: "POST", headers, body: bodyText }),
        entorno,
        {} as any,
      );

    it("rechaza (403) sin firma válida", async () => {
      const { zernioEnv } = ingestSpyEnv();
      const res = await post({ "Content-Type": "application/json" }, zernioEnv);
      expect(res.status).toBe(403);
    });

    it("rechaza (403) si el secret no está configurado", async () => {
      const sig = createHmac("sha256", SECRET).update(bodyText).digest("hex");
      const res = await post(
        { "Content-Type": "application/json", "X-Zernio-Signature": sig },
        { ...env, AGENT: { idFromName: () => "x", get: () => ({ ingest: vi.fn() }) } },
      );
      expect(res.status).toBe(403);
    });

    it("con firma válida, entrega el mensaje al agente y responde 200", async () => {
      const { zernioEnv, ingest } = ingestSpyEnv();
      const sig = createHmac("sha256", SECRET).update(bodyText).digest("hex");
      const res = await post(
        { "Content-Type": "application/json", "X-Zernio-Signature": sig },
        zernioEnv,
      );
      expect(res.status).toBe(200);
      expect(ingest).toHaveBeenCalledTimes(1);
      const msg = (ingest.mock.calls[0] as any[])[0];
      expect(msg.channel).toBe("zernio");
      expect(msg.text).toBe("hola");
    });
  });

  describe("POST /kb/reindex", () => {
    const pedir = (headers: Record<string, string>, entorno: any = env) =>
      worker.fetch(
        new Request("https://test/kb/reindex", { method: "POST", headers }),
        entorno,
        {} as any,
      );

    it("responde unauthorized cuando el secret no está configurado", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await pedir({ "X-Reindex-Token": "loquesea" });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });

      // El cuerpo no distingue este caso del token equivocado — a propósito, para
      // no regalarle a quien llama el estado del Worker. Pero el dueño tiene que
      // poder distinguirlo desde `wrangler tail`, y ahí es donde va el aviso.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("KB_REINDEX_TOKEN"));
      warn.mockRestore();
    });

    it("responde unauthorized cuando el token no coincide, sin avisar al log", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await pedir({ "X-Reindex-Token": "equivocado" }, {
        ...env,
        KB_REINDEX_TOKEN: "el-bueno",
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      // Acá el Worker sí está configurado: no hay nada que avisarle al dueño.
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
