/**
 * Lee la respuesta del cliente a la encuesta de satisfacción y la convierte en
 * una nota 1-5. Devuelve null si el mensaje no parece una nota (así el turno
 * sigue al bot normal: el cliente escribió otra cosa).
 */
const WORDS: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

export function parseRating(text: string): number | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;

  if (/👍|me gust[oa]|excelente|perfecto|buen[ií]sim|de diez|10\/10/.test(t)) return 5;
  if (/👎|p[eé]sim|horrible|malísim|una porquer/.test(t)) return 1;

  // "4/5", "3 estrellas", o un dígito 1-5 suelto
  const m =
    t.match(/\b([1-5])\s*(?:\/\s*5|estrellas?|de\s*5)/) ||
    t.match(/(?:^|\s)([1-5])(?:$|\s|\.|,|\))/);
  if (m) return Number(m[1]);

  for (const [w, n] of Object.entries(WORDS)) {
    if (new RegExp(`(?:^|\\s)${w}(?:$|\\s|\\.|,)`).test(t)) return n;
  }
  return null;
}
