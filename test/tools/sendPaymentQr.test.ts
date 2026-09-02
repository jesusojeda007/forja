import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { PaymentsRepo } from "../../src/db/payments";
import { sendPaymentQrTool } from "../../src/tools/sendPaymentQr";
import { buildTools } from "../../src/tools";

let env: any;
let settings: SettingsRepo;
let payments: PaymentsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  const db = new Db(d1 as any);
  settings = new SettingsRepo(db);
  payments = new PaymentsRepo(db);
  env = { DB: d1, BOT_TIER: "free", TELEGRAM_BOT_TOKEN: "test-token" };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendPaymentQrTool", () => {
  it("sin QR configurado responde sent:false (el bot cae a la KB, no inventa)", async () => {
    const tool = sendPaymentQrTool(env, () => null, () => "telegram", () => "555");
    const result = (await tool.execute!({ monto: 250 }, {} as any)) as any;
    expect(result.sent).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("sin canal activo no envía", async () => {
    await settings.set(SETTING_KEYS.paymentQrUrl, "https://bot.test/qr.png");
    const tool = sendPaymentQrTool(env, () => null, () => null, () => null);
    const result = (await tool.execute!({}, {} as any)) as any;
    expect(result.sent).toBe(false);
  });

  it("con QR + canal envía la imagen vía el adapter (fetch mockeado)", async () => {
    await settings.set(SETTING_KEYS.paymentQrUrl, "https://bot.test/qr.png");
    await settings.set(SETTING_KEYS.paymentInstructions, "Escanea con tu app del banco.");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const tool = sendPaymentQrTool(env, () => null, () => "telegram", () => "555");
    const result = (await tool.execute!(
      { monto: 250, referencia: "Corte + Barba" },
      {} as any,
    )) as any;
    expect(result.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("sendPhoto");
    const body = JSON.parse(String(init!.body));
    expect(body.photo).toBe("https://bot.test/qr.png");
    expect(body.chat_id).toBe("555");
    expect(body.caption).toContain("250");
    expect(body.caption).toContain("Escanea con tu app del banco");
  });

  it("con monto + conversación registra el pago pendiente para conciliar", async () => {
    await settings.set(SETTING_KEYS.paymentQrUrl, "https://bot.test/qr.png");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const tool = sendPaymentQrTool(env, () => "conv-1", () => "telegram", () => "555");
    const result = (await tool.execute!({ monto: 400, referencia: "Combo" }, {} as any)) as any;
    expect(result.sent).toBe(true);
    expect(result.registrado).toBe(true);
    const pending = await payments.listPending(48 * 3600 * 1000);
    expect(pending).toHaveLength(1);
    expect(pending[0].monto).toBe(400);
    expect(pending[0].conversation_id).toBe("conv-1");
  });

  it("sin monto no registra pago (nada que conciliar)", async () => {
    await settings.set(SETTING_KEYS.paymentQrUrl, "https://bot.test/qr.png");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const tool = sendPaymentQrTool(env, () => "conv-1", () => "telegram", () => "555");
    const result = (await tool.execute!({}, {} as any)) as any;
    expect(result.sent).toBe(true);
    expect(result.registrado).toBe(false);
    expect(await payments.listPending(48 * 3600 * 1000)).toHaveLength(0);
  });

  it("si el canal falla devuelve la URL como fallback sin lanzar", async () => {
    await settings.set(SETTING_KEYS.paymentQrUrl, "https://bot.test/qr.png");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const tool = sendPaymentQrTool(env, () => null, () => "telegram", () => "555");
    const result = (await tool.execute!({}, {} as any)) as any;
    expect(result.sent).toBe(false);
    expect(result.qrUrl).toBe("https://bot.test/qr.png");
  });
});

describe("buildTools registra sendPaymentQr en free", () => {
  it("está en el set free (no gatea a Pro)", () => {
    const tools = buildTools({
      env: env as any,
      getConversationId: () => null,
      getChannel: () => null,
      getChannelUserId: () => null,
    });
    expect(tools.sendPaymentQr).toBeDefined();
  });
});
