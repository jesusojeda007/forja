import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";
import type { Env } from "../src/env";

const envWith = (niche: string) =>
  ({ BOT_NICHE: niche, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

// Tanda D — alto valor: inmobiliaria, hoteleria, coach, crm.

const PACKS = [
  {
    id: "inmobiliaria",
    navLabel: "Prospectos",
    recordSingular: "Prospecto",
    sold: "Cerró",
    lost: "Descartó",
    columns: ["operacion", "presupuesto", "zona"],
    mustAgenda: true,
  },
  {
    id: "hoteleria",
    navLabel: "Reservas",
    recordSingular: "Reserva",
    sold: "Confirmada",
    lost: "Cancelada",
    columns: ["fechas", "huespedes"],
    mustAgenda: true,
  },
  {
    id: "coach",
    navLabel: "Prospectos",
    recordSingular: "Prospecto",
    sold: "Contrató",
    lost: "No contrató",
    columns: ["servicio", "objetivo"],
    mustAgenda: true,
  },
  {
    id: "crm",
    navLabel: "Oportunidades",
    recordSingular: "Oportunidad",
    sold: "Ganada",
    lost: "Perdida",
    columns: ["empresa", "necesidad", "presupuesto"],
    mustAgenda: true,
  },
] as const;

describe.each(PACKS)("pack $id", (p) => {
  it("resuelve por BOT_NICHE con su re-etiquetado", () => {
    const n = getNiche(envWith(p.id));
    expect(n.id).toBe(p.id);
    expect(n.navLabel).toBe(p.navLabel);
    expect(n.recordSingular).toBe(p.recordSingular);
    expect(n.statusLabels.sold).toBe(p.sold);
    expect(n.statusLabels.lost).toBe(p.lost);
  });

  it("columnas del giro (viven en lead.metadata)", () => {
    const n = getNiche(envWith(p.id));
    expect(n.columns.map((c) => c.key)).toEqual([...p.columns]);
    for (const c of n.columns) expect(c.label.length).toBeGreaterThan(0);
  });

  it("playbook real: agenda con scheduleAppointment, escala con handoffHuman, capta con captureLead", () => {
    const n = getNiche(envWith(p.id));
    expect(n.playbook).toContain("<niche_playbook>");
    expect(n.playbook).toContain("scheduleAppointment");
    expect(n.playbook).toContain("handoffHuman");
    expect(n.playbook).toContain("captureLead");
    expect(n.defaultTone.length).toBeGreaterThan(0);
    expect(n.kbDocs.length).toBeGreaterThan(0);
  });

  it("inyecta su playbook al system prompt", () => {
    const env = envWith(p.id);
    const prompt = systemPromptFromEnv(env, ["searchKb", "scheduleAppointment"], "ctx", getNiche(env).playbook);
    expect(prompt).toContain("<niche_playbook>");
  });

  it("el nav del panel muestra su etiqueta", () => {
    const html = layout({ title: "T", activeTab: "leads", body: "x", env: envWith(p.id) });
    expect(html).toContain(p.navLabel);
    expect(html).toContain('href="/admin/leads"');
  });
});

describe("crm — no cierra la venta", () => {
  it("el playbook prohíbe vender/cerrar y manda a agendar con ventas", () => {
    const pb = getNiche(envWith("crm")).playbook.toLowerCase();
    expect(pb).toContain("no vend");
  });
});

describe("Tanda D — completa los 13", () => {
  it("los 13 giros + generico + tienda resuelven a su propio pack", () => {
    const todos = [
      "generico", "tienda",
      "barberia", "salon", "spa", "gimnasio",
      "clinica", "dentista",
      "restaurante", "cafeteria", "panaderia",
      "inmobiliaria", "hoteleria", "coach", "crm",
    ];
    for (const id of todos) expect(getNiche(envWith(id)).id).toBe(id);
  });
});
