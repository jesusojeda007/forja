import { describe, it, expect } from "vitest";
import { resolveBranding, brandingStyle } from "../../src/agencia/branding";
import type { Env } from "../../src/env";

const env = (over: Partial<Env> = {}) => ({ BOT_NAME: "Bot", ...over }) as Env;

describe("resolveBranding", () => {
  it("sin nada: marca Forja, modo agencia apagado, upsell encendido", () => {
    const b = resolveBranding(env());
    expect(b).toMatchObject({
      agencyMode: false,
      name: "Forja",
      accent: null,
      logoUrl: null,
      upsell: true,
      showPoweredBy: true,
    });
  });

  it("AGENCY_NAME enciende el modo agencia y apaga el upsell", () => {
    const b = resolveBranding(env({ AGENCY_NAME: "Acme Bots" } as Partial<Env>));
    expect(b.agencyMode).toBe(true);
    expect(b.name).toBe("Acme Bots");
    expect(b.upsell).toBe(false);
  });

  it("sanea el nombre: recorta, quita < > y control chars, tope 40", () => {
    const b = resolveBranding(env({ AGENCY_NAME: "  <script>Acme  " } as Partial<Env>));
    expect(b.name).toBe("scriptAcme");
    const long = resolveBranding(env({ AGENCY_NAME: "A".repeat(80) } as Partial<Env>));
    expect(long.name.length).toBe(40);
  });

  it("acepta hex válido y lo normaliza; rechaza lo demás", () => {
    expect(resolveBranding(env({ AGENCY_ACCENT: "#0af" } as Partial<Env>)).accent).toBe("#00aaff");
    expect(resolveBranding(env({ AGENCY_ACCENT: "#0F766E" } as Partial<Env>)).accent).toBe("#0f766e");
    expect(resolveBranding(env({ AGENCY_ACCENT: "red" } as Partial<Env>)).accent).toBeNull();
    expect(resolveBranding(env({ AGENCY_ACCENT: "#12345" } as Partial<Env>)).accent).toBeNull();
    expect(resolveBranding(env({ AGENCY_ACCENT: "javascript:x" } as Partial<Env>)).accent).toBeNull();
  });

  it("logo: solo https", () => {
    expect(resolveBranding(env({ AGENCY_LOGO_URL: "https://cdn.acme.com/logo.png" } as Partial<Env>)).logoUrl).toBe(
      "https://cdn.acme.com/logo.png",
    );
    expect(resolveBranding(env({ AGENCY_LOGO_URL: "http://cdn.acme.com/logo.png" } as Partial<Env>)).logoUrl).toBeNull();
    expect(resolveBranding(env({ AGENCY_LOGO_URL: "data:image/png;base64,xxx" } as Partial<Env>)).logoUrl).toBeNull();
  });

  it("AGENCY_HIDE_POWERED=1 esconde el 'hecho con Forja'", () => {
    expect(resolveBranding(env({ AGENCY_NAME: "Acme", AGENCY_HIDE_POWERED: "1" } as Partial<Env>)).showPoweredBy).toBe(
      false,
    );
  });
});

describe("brandingStyle", () => {
  it("emite override de tokens cuando hay accent", () => {
    const css = brandingStyle(resolveBranding(env({ AGENCY_ACCENT: "#0f766e" } as Partial<Env>)));
    expect(css).toContain("--accent:#0f766e");
    expect(css).toContain("--accent-soft:rgba(15,118,110");
    expect(css).toMatch(/^<style>/);
  });

  it("cadena vacía cuando no hay accent", () => {
    expect(brandingStyle(resolveBranding(env()))).toBe("");
  });
});
