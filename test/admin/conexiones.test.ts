import { describe, it, expect } from "vitest";
import { connectionsSummary } from "../../src/admin/views/conexiones";

describe("connectionsSummary — Zernio", () => {
  it("cuenta Zernio como conectado solo con AMBOS secrets", () => {
    const sinNada = connectionsSummary({} as any);
    const soloKey = connectionsSummary({ ZERNIO_API_KEY: "sk_live" } as any);
    const completo = connectionsSummary({
      ZERNIO_API_KEY: "sk_live",
      ZERNIO_WEBHOOK_SECRET: "whsec_x",
    } as any);

    expect(soloKey.connected).toBe(sinNada.connected); // falta el webhook secret
    expect(completo.connected).toBe(sinNada.connected + 1);
  });
});
