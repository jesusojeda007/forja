import { describe, it, expect } from "vitest";
import { parseRating } from "../../src/encuestas/parse";

describe("parseRating", () => {
  it("lee un dígito 1-5 suelto", () => {
    expect(parseRating("5")).toBe(5);
    expect(parseRating("un 4")).toBe(4);
    expect(parseRating("  3  ")).toBe(3);
    expect(parseRating("1")).toBe(1);
  });

  it("lee '4/5' y '3 estrellas'", () => {
    expect(parseRating("4/5")).toBe(4);
    expect(parseRating("3 estrellas")).toBe(3);
  });

  it("lee palabras", () => {
    expect(parseRating("cinco")).toBe(5);
    expect(parseRating("le doy un dos")).toBe(2);
  });

  it("👍 => 5, 👎 => 1", () => {
    expect(parseRating("👍")).toBe(5);
    expect(parseRating("👎")).toBe(1);
  });

  it("lee elogios y quejas simples", () => {
    expect(parseRating("excelente")).toBe(5);
    expect(parseRating("todo perfecto")).toBe(5);
    expect(parseRating("pésimo")).toBe(1);
  });

  it("null si no hay nota clara", () => {
    expect(parseRating("hola, tengo otra duda")).toBeNull();
    expect(parseRating("¿a qué hora abren mañana?")).toBeNull();
    expect(parseRating("")).toBeNull();
    expect(parseRating("quiero 10 unidades del producto 7 por favor")).toBeNull();
  });

  it("ignora números fuera de 1-5", () => {
    expect(parseRating("8")).toBeNull();
    expect(parseRating("0")).toBeNull();
  });
});
