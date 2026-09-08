import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";
import type { Env } from "../src/env";

const envWith = (niche?: string) => ({ BOT_NICHE: niche, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

describe("getNiche", () => {
  it("nicho ausente o desconocido → genérico (comportamiento del Starter)", () => {
    for (const v of [undefined, "", "xyz", "giro-inexistente"]) {
      const n = getNiche(envWith(v));
      expect(n.id).toBe("generico");
      expect(n.navLabel).toBe("Leads");
      expect(n.playbook).toBe("");
      expect(n.defaultTone).toBe("");
    }
  });

  it("normaliza mayúsculas/espacios al resolver el pack", () => {
    expect(getNiche(envWith("  GENERICO ")).id).toBe("generico");
    expect(getNiche(envWith("  TIENDA ")).id).toBe("tienda");
  });
});

describe("pack tienda", () => {
  it("resuelve el pack con su re-etiquetado y playbook", () => {
    const n = getNiche(envWith("tienda"));
    expect(n.id).toBe("tienda");
    expect(n.navLabel).toBe("Interesados");
    expect(n.recordSingular).toBe("Interesado");
    expect(n.statusLabels.sold).toBe("Compró");
    expect(n.columns.map((c) => c.key)).toEqual(["producto", "monto"]);
    expect(n.playbook).toContain("<niche_playbook>");
    // tickets queda visible en tienda (los reclamos tienen que caer en algún lado)
    expect(n.hiddenTabs).not.toContain("tickets");
  });

  it("inyecta el playbook del nicho al prompt", () => {
    const env = envWith("tienda");
    const prompt = systemPromptFromEnv(env, ["searchKb"], "ctx", getNiche(env).playbook);
    expect(prompt).toContain("<niche_playbook>");
  });

  it("nav: dice 'Interesados', muestra Pedidos y Tickets", () => {
    const html = layout({ title: "T", activeTab: "leads", body: "x", env: envWith("tienda") });
    expect(html).toContain("Interesados");
    expect(html).toContain('href="/admin/leads"');
    expect(html).toContain('href="/admin/pedidos"');
    expect(html).toContain('href="/admin/tickets"');
  });

  it("DISABLED_TABS se suma a las ocultas por el pack", () => {
    const env = { ...envWith("tienda"), DISABLED_TABS: "campanas" } as unknown as Env;
    const html = layout({ title: "T", activeTab: "leads", body: "x", env });
    expect(html).not.toContain('href="/admin/campanas"');
  });
});

describe("dashboard (nav genérico)", () => {
  const page = (niche?: string) => layout({ title: "T", activeTab: "leads", body: "x", env: envWith(niche) });

  it("genérico: el nav dice 'Leads'", () => {
    const html = page(undefined);
    expect(html).toContain("Leads");
    expect(html).toContain('href="/admin/leads"');
  });
});

describe("cableado del playbook al prompt", () => {
  it("genérico no inyecta playbook", () => {
    const env = envWith(undefined);
    const prompt = systemPromptFromEnv(env, ["searchKb"], "ctx", getNiche(env).playbook || undefined);
    expect(prompt).not.toContain("<diagnostic_playbooks>");
  });
});
