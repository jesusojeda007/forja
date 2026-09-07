import { describe, it, expect } from "vitest";
import { channelLabel, configuredChannels } from "../../src/channels/labels";

describe("channelLabel", () => {
  it("da el nombre legible de Zernio", () => {
    expect(channelLabel("zernio")).toBe("Zernio");
  });

  it("cae al id crudo para un canal desconocido", () => {
    expect(channelLabel("otra-cosa")).toBe("otra-cosa");
  });
});

describe("configuredChannels", () => {
  it("lista Zernio cuando ZERNIO_API_KEY está configurado", () => {
    const out = configuredChannels({ ZERNIO_API_KEY: "sk_live" } as any);
    expect(out.some((c) => c.id === "zernio")).toBe(true);
  });

  it("no lista Zernio sin la API key", () => {
    const out = configuredChannels({} as any);
    expect(out.some((c) => c.id === "zernio")).toBe(false);
  });
});
