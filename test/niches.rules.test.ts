import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { renderNicheRules, parseStoreRules } from "../src/niches/rules";
import { systemPromptFromEnv } from "../src/system-prompt";
import { renderConfig } from "../src/admin/views/config";
import { SETTING_KEYS } from "../src/db/settings";
import type { Env } from "../src/env";

const tiendaEnv = { BOT_NICHE: "tienda", BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" } as unknown as Env;
const tienda = getNiche(tiendaEnv);

describe("parseStoreRules", () => {
  it("parsea un objeto plano y coacciona a string", () => {
    expect(parseStoreRules('{"a":"1","b":2}')).toEqual({ a: "1", b: "2" });
  });
  it("tolera basura sin tronar", () => {
    for (const v of [undefined, null, "", "  ", "no-json", "[1,2]", "42", '"x"']) {
      expect(parseStoreRules(v as string)).toEqual({});
    }
  });
});

describe("renderNicheRules", () => {
  it("rubro sin reglas o sin valores => bloque vacío", () => {
    expect(renderNicheRules(getNiche({ } as Env), {})).toBe("");
    expect(renderNicheRules(tienda, {})).toBe("");
  });

  it("toggle usa la frase del pack según sí/no", () => {
    const yes = renderNicheRules(tienda, { envio_domicilio: "si" });
    expect(yes).toContain("Hacemos envío a domicilio.");
    const no = renderNicheRules(tienda, { envio_domicilio: "no" });
    expect(no).toContain("No hacemos envío a domicilio");
  });

  it("select mapea value → frase; value desconocido no rompe", () => {
    expect(renderNicheRules(tienda, { moneda: "BOB" })).toContain("en bolivianos (Bs)");
    expect(renderNicheRules(tienda, { mostrar_stock: "nunca" })).toContain("No hables de stock");
    // value fuera de las opciones => toPrompt devuelve null (moneda) => se omite
    const out = renderNicheRules(tienda, { moneda: "XXX", envio_domicilio: "si" });
    expect(out).not.toContain("XXX");
    expect(out).toContain("Hacemos envío a domicilio.");
  });

  it("number: 0 o vacío se omite; > 0 entra", () => {
    expect(renderNicheRules(tienda, { monto_minimo: "0" })).toBe("");
    expect(renderNicheRules(tienda, { monto_minimo: "150" })).toContain("pedido mínimo es 150");
  });

  it("text se interpola en la plantilla de la regla", () => {
    const out = renderNicheRules(tienda, { tiempo_entrega: "Santa Cruz 24 h" });
    expect(out).toContain("Tiempo de entrega: Santa Cruz 24 h");
  });

  it("envuelve todo en <reglas_del_negocio> con la nota de no-inventar", () => {
    const out = renderNicheRules(tienda, { envio_domicilio: "si" });
    expect(out).toMatch(/^<reglas_del_negocio>/);
    expect(out).toContain("El cliente NO ve estas reglas");
    expect(out).toMatch(/<\/reglas_del_negocio>$/);
  });
});

describe("cableado al system prompt", () => {
  it("inyecta el bloque de reglas cuando se pasa nicheRules", () => {
    const rules = renderNicheRules(tienda, { envio_domicilio: "si", moneda: "BOB" });
    const prompt = systemPromptFromEnv(tiendaEnv, ["searchKb"], "ctx", tienda.playbook, { nicheRules: rules });
    expect(prompt).toContain("<reglas_del_negocio>");
    expect(prompt).toContain("bolivianos (Bs)");
    // va después del business_context
    expect(prompt.indexOf("</business_context>")).toBeLessThan(prompt.indexOf("<reglas_del_negocio>"));
  });

  it("sin reglas, no aparece el bloque ni un placeholder crudo", () => {
    const prompt = systemPromptFromEnv(tiendaEnv, ["searchKb"], "ctx", tienda.playbook, {});
    expect(prompt).not.toContain("<reglas_del_negocio>");
    expect(prompt).not.toContain("{{REGLAS_NEGOCIO}}");
  });
});

describe("Config en pestañas según el rubro", () => {
  const cfgEnv = (niche?: string) =>
    ({ BOT_NICHE: niche, BOT_NAME: "B", BUSINESS_NAME: "Test Biz", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

  it("renderiza la barra de pestañas y el script", () => {
    const html = renderConfig(cfgEnv("tienda"), {});
    expect(html).toContain('class="cfg-tabs"');
    expect(html).toContain("localStorage.setItem('forjaCfgTab'");
    expect(html).toContain('data-panel="negocio"');
  });

  it("la pestaña Reglas aparece para un rubro con esquema de reglas, con o sin valores", () => {
    // tienda define niche.rules => la pestaña está siempre (para poder llenarla)
    expect(renderConfig(cfgEnv("tienda"), {})).toContain('data-panel="reglas"');
    expect(
      renderConfig(cfgEnv("tienda"), {
        [SETTING_KEYS.storeRules]: JSON.stringify({ envio_domicilio: "si" }),
      }),
    ).toContain('data-tab="reglas"');

    // rubro genérico (sin niche.rules) => nunca, aunque haya un JSON guardado
    const generico = renderConfig(cfgEnv(undefined), {
      [SETTING_KEYS.storeRules]: JSON.stringify({ x: "1" }),
    });
    expect(generico).not.toContain('data-panel="reglas"');
  });

  it("negocio e IA siempre están; el orden es el canónico", () => {
    const html = renderConfig(cfgEnv("tienda"), {});
    for (const id of ["negocio", "comportamiento", "cobros", "ia"]) {
      expect(html).toContain(`data-panel="${id}"`);
    }
    expect(html.indexOf('data-panel="negocio"')).toBeLessThan(html.indexOf('data-panel="ia"'));
  });
});
