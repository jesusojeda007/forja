import { describe, it, expect, vi } from "vitest";

// Mock the member config import
vi.mock("../../member/config.local", () => ({
  catalog: [
    { name: "Concha", price: 25, description: "Pan dulce clásico" },
    { name: "Pan de muerto", price: 45, description: "Solo en temporada" },
    { name: "Licuadora Portátil", price: 69, description: "batidos donde quieras", stock: 1 },
    { name: "Licuadora", price: 229, description: "jarra de 1500 ml", stock: 3 },
    { name: "Set de Cuchillos", price: 49, description: "seis cuchillos de acero" },
  ],
}));

import { catalogQueryTool } from "../../src/tools/catalogQuery";

describe("catalogQueryTool", () => {
  it("returns matching products by fuzzy name", async () => {
    const tool = catalogQueryTool({} as any);
    const result = (await tool.execute!({ query: "concha" }, {} as any)) as {
      matches: { name: string; price: number; description?: string; sku?: string }[];
    };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Concha");
  });

  it("returns empty matches when nothing matches", async () => {
    const tool = catalogQueryTool({} as any);
    const result = (await tool.execute!({ query: "xyzabc" }, {} as any)) as {
      matches: { name: string; price: number; description?: string; sku?: string }[];
    };
    expect(result.matches).toHaveLength(0);
  });

  const run = async (query: string) =>
    (await catalogQueryTool({} as any).execute!({ query }, {} as any)) as {
      matches: { name: string }[];
    };

  it("tolera plural: 'licuadoras' encuentra 'Licuadora' y 'Licuadora Portátil'", async () => {
    const r = await run("tienen licuadoras?");
    expect(r.matches.map((m) => m.name).sort()).toEqual(["Licuadora", "Licuadora Portátil"]);
  });

  it("tolera acentos y frases: 'cuánto sale la licuadora portatil'", async () => {
    const r = await run("cuánto sale la licuadora portatil");
    expect(r.matches[0].name).toBe("Licuadora Portátil"); // match exacto de frase rankea primero
  });

  it("plural en 'cuchillos' encuentra 'Set de Cuchillos'", async () => {
    const r = await run("precio del set de cuchillos");
    expect(r.matches.map((m) => m.name)).toContain("Set de Cuchillos");
  });

  it("ignora stopwords: 'hola que precio tienen' no matchea todo el catálogo", async () => {
    const r = await run("hola, que precio tienen?");
    expect(r.matches).toHaveLength(0);
  });
});
