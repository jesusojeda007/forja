import { describe, it, expect } from "vitest";
import { layout, renderUpgrade } from "../../src/admin/views/layout";
import type { Env } from "../../src/env";

const page = (over: Partial<Env> = {}) =>
  layout({
    title: "Resumen",
    activeTab: "overview",
    body: "<p>x</p>",
    env: { BOT_TIER: "pro", BOT_NAME: "Bot", ...over } as Env,
  });

describe("whitelabel del panel", () => {
  it("default: sigue diciendo Forja y no mete override de estilo", () => {
    const html = page();
    expect(html).toContain("Forja");
    expect(html).not.toContain("<title>Forja · ");
    expect(html).not.toContain("/* branding */");
  });

  it("AGENCY_NAME reemplaza la marca en el sidebar y prefija el <title>", () => {
    const html = page({ AGENCY_NAME: "Acme Bots" } as Partial<Env>);
    expect(html).toContain("Acme Bots");
    expect(html).toContain("<title>Acme Bots · Resumen</title>");
    // el nombre viejo ya no está en el bloque de marca (sidebar)
    const brand = html.slice(html.indexOf('class="sb-brand"'), html.indexOf('class="sb-brand"') + 400);
    expect(brand).not.toContain("Forja");
  });

  it("AGENCY_ACCENT inyecta el override de tokens", () => {
    const html = page({ AGENCY_NAME: "Acme", AGENCY_ACCENT: "#7c3aed" } as Partial<Env>);
    expect(html).toContain("--accent:#7c3aed");
  });

  it("AGENCY_LOGO_URL pone un <img> en vez del ícono", () => {
    const html = page({ AGENCY_NAME: "Acme", AGENCY_LOGO_URL: "https://cdn.acme.com/l.png" } as Partial<Env>);
    expect(html).toContain('src="https://cdn.acme.com/l.png"');
  });

  it("renderUpgrade en modo agencia no enlaza a horizontesia.com", () => {
    const agency = renderUpgrade({ BOT_TIER: "free", BOT_NAME: "Bot", AGENCY_NAME: "Acme" } as Env, "Insights");
    expect(agency).not.toContain("horizontesia.com");
    expect(agency).toContain("Insights");

    const plain = renderUpgrade({ BOT_TIER: "free", BOT_NAME: "Bot" } as Env, "Insights");
    expect(plain).toContain("horizontesia.com");
  });
});
