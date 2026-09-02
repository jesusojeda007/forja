import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { savePaymentQr, servePaymentQr } from "../../src/payments/qr-storage";

let env: any;
let settings: SettingsRepo;

// PNG mínimo: solo los magic bytes importan para el sniffer.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = { DB: d1, CATALOG: await mf.getR2Bucket("CATALOG"), DASHBOARD_BASE_URL: "https://bot.test" };
  settings = new SettingsRepo(new Db(d1 as any));
});

describe("savePaymentQr", () => {
  it("guarda en R2 y deja la setting apuntando a /qr?v=", async () => {
    const url = await savePaymentQr(env, new File([PNG_BYTES], "qr.png", { type: "image/png" }));
    expect(url).toMatch(/^https:\/\/bot\.test\/qr\?v=\d+$/);
    expect(await settings.get(SETTING_KEYS.paymentQrUrl)).toBe(url);
    const obj = await env.CATALOG.get("payment-qr");
    expect(obj).toBeTruthy();
    expect(obj.httpMetadata?.contentType).toBe("image/png");
  });

  it("rechaza un archivo que no es imagen (aunque se haga pasar por .png)", async () => {
    const html = new File([new TextEncoder().encode("<html><script>alert(1)</script>")], "qr.png", {
      type: "image/png",
    });
    await expect(savePaymentQr(env, html)).rejects.toThrow(/no es una imagen/i);
    expect(await settings.get(SETTING_KEYS.paymentQrUrl)).toBeNull();
  });

  it("rechaza archivos de más de 2MB", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1).fill(0x89)], "qr.png", { type: "image/png" });
    await expect(savePaymentQr(env, big)).rejects.toThrow(/2 MB/i);
  });

  it("rechaza archivo vacío", async () => {
    await expect(savePaymentQr(env, new File([], "qr.png", { type: "image/png" }))).rejects.toThrow();
  });
});

describe("servePaymentQr", () => {
  it("404 mientras no haya QR", async () => {
    const res = await servePaymentQr(env);
    expect(res.status).toBe(404);
  });

  it("sirve la imagen con su content-type y anti-sniff", async () => {
    await savePaymentQr(env, new File([PNG_BYTES], "qr.png", { type: "image/png" }));
    const res = await servePaymentQr(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body[1]).toBe(0x50); // "P" de PNG
  });

  it("sin binding CATALOG responde 404, no explota", async () => {
    const res = await servePaymentQr({ ...env, CATALOG: undefined });
    expect(res.status).toBe(404);
  });
});
