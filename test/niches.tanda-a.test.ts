import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";
import type { Env } from "../src/env";

const envWith = (niche: string) =>
  ({ BOT_NICHE: niche, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

// Tanda A — servicios con cita: barberia, salon, spa, gimnasio.
// Cada pack: resuelve por BOT_NICHE, re-etiqueta el panel, define columnas de
// metadata, y su playbook entra al system prompt.

const PACKS = [
  {
    id: "barberia",
    navLabel: "Clientes",
    recordSingular: "Cliente",
    sold: "Agendó",
    lost: "No agendó",
    columns: ["servicio", "fecha_cita"],
    playbookMust: "scheduleAppointment",
  },
  {
    id: "salon",
    navLabel: "Clientes",
    recordSingular: "Cliente",
    sold: "Agendó",
    lost: "No agendó",
    columns: ["servicio", "fecha_cita"],
    playbookMust: "scheduleAppointment",
  },
  {
    id: "spa",
    navLabel: "Clientes",
    recordSingular: "Cliente",
    sold: "Reservó",
    lost: "No reservó",
    columns: ["tratamiento", "fecha_cita"],
    playbookMust: "scheduleAppointment",
  },
  {
    id: "gimnasio",
    navLabel: "Prospectos",
    recordSingular: "Prospecto",
    sold: "Inscrito",
    lost: "No inscrito",
    columns: ["plan", "objetivo"],
    playbookMust: "captureLead",
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

  it("define las columnas del giro (viven en lead.metadata)", () => {
    const n = getNiche(envWith(p.id));
    expect(n.columns.map((c) => c.key)).toEqual([...p.columns]);
    for (const c of n.columns) expect(c.label.length).toBeGreaterThan(0);
  });

  it("trae un playbook real y un tono por defecto", () => {
    const n = getNiche(envWith(p.id));
    expect(n.playbook).toContain("<niche_playbook>");
    expect(n.playbook).toContain(p.playbookMust);
    expect(n.defaultTone.length).toBeGreaterThan(0);
    expect(n.kbDocs.length).toBeGreaterThan(0);
  });

  it("inyecta su playbook al system prompt", () => {
    const env = envWith(p.id);
    const prompt = systemPromptFromEnv(env, ["searchKb", "captureLead"], "ctx", getNiche(env).playbook);
    expect(prompt).toContain("<niche_playbook>");
  });

  it("el nav del panel muestra su etiqueta", () => {
    const html = layout({ title: "T", activeTab: "leads", body: "x", env: envWith(p.id) });
    expect(html).toContain(p.navLabel);
    expect(html).toContain('href="/admin/leads"');
  });
});

describe("Tanda A — no rompe el resto", () => {
  it("un nicho desconocido sigue cayendo a genérico", () => {
    expect(getNiche(envWith("giro-que-no-existe")).id).toBe("generico");
  });
});
