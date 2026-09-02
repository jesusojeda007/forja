/**
 * Montos en formato boliviano/hispano: "Bs 400", "Bs. 1.250,50", "400,00 BOB",
 * "1,250.50". Regla: si hay punto Y coma, el último es el decimal. Si hay solo
 * uno, es decimal cuando le siguen 1-2 dígitos; si no, separador de miles.
 * Compartido por el parser de emails bancarios y la carga de catálogo por URL.
 */
export function parseMonto(raw: string): number | null {
  const m = raw.match(/(?:Bs\.?|BOB)?\s*([0-9][0-9.,\s]*[0-9])/i);
  if (!m) return null;
  let num = m[1].replace(/\s/g, "");
  const lastComma = num.lastIndexOf(",");
  const lastDot = num.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const dec = Math.max(lastComma, lastDot);
    const decSep = num[dec];
    const thouSep = decSep === "," ? "." : ",";
    num = num.split(thouSep).join("");
    num = num.replace(decSep, ".");
  } else if (lastComma > -1) {
    if (num.length - lastComma - 1 <= 2) num = num.replace(",", ".");
    else num = num.split(",").join("");
  } else if (lastDot > -1) {
    if (num.length - lastDot - 1 > 2 || (num.match(/\./g) ?? []).length > 1) {
      num = num.split(".").join("");
    }
    // si no: el punto es decimal ("Bs 400.50")
  }
  const value = Number.parseFloat(num);
  return Number.isFinite(value) && value > 0 ? value : null;
}
