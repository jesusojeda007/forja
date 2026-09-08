import { generateText } from "ai";

// Blindaje anti-invento — chequeo de fundamento post-generación.
//
// Después de que el bot genera su respuesta, y SOLO si el dueño activó Blindaje,
// una llamada corta a un modelo rápido verifica que la respuesta no afirme
// ningún dato concreto del negocio que no esté en las fuentes reales del turno
// (contexto del negocio + chunks de searchKb).
//
// FAIL-OPEN es la regla: si el verificador falla, se cae la red, la salida no es
// JSON, lo que sea → `grounded: true`. Blindaje jamás debe dejar mudo al bot ni
// tumbar una respuesta por su propio error. Bloquea solo cuando está SEGURO de
// que hay un invento.

export interface GroundingCheckArgs {
  /** Modelo rápido (Haiku / equivalente). */
  model: unknown;
  /** La respuesta que el bot va a enviar. */
  reply: string;
  /** Fuentes reales del turno: contexto del negocio + chunks de KB, concatenados. */
  sources: string;
  /** Idioma del bot (solo para que el verificador entienda; su salida es JSON). */
  language: string;
}

export interface GroundingCheckResult {
  grounded: boolean;
  /** Datos concretos que la respuesta afirma y las fuentes no respaldan. */
  unsupported: string[];
}

const GROUNDED: GroundingCheckResult = { grounded: true, unsupported: [] };

function buildPrompt(args: GroundingCheckArgs): string {
  return `Eres un verificador de fundamento. Idioma de la conversación: ${args.language}.

FUENTES (lo único que el negocio ha confirmado):
"""
${args.sources || "(sin fuentes)"}
"""

RESPUESTA DEL BOT a revisar:
"""
${args.reply}
"""

¿La RESPUESTA afirma algún DATO CONCRETO del negocio —precio, tarifa, horario,
dirección, teléfono, disponibilidad, existencia de un producto o servicio,
política, plazo, promoción o requisito— que NO aparezca (ni textual ni
claramente equivalente) en las FUENTES?

No cuentes como problema: saludos, preguntas al cliente, orientación general,
ni datos que el propio cliente aportó.

Responde SOLO con un objeto JSON:
{"grounded": true}  si todo lo concreto está respaldado.
{"grounded": false, "unsupported": ["...", "..."]}  si hay datos sin respaldo
(lista cada uno en una frase corta).`;
}

/** Extrae el primer objeto JSON del texto (tolera ```json y prosa alrededor). */
function parseResult(text: string): GroundingCheckResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return GROUNDED;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return GROUNDED;
  }
  if (!parsed || typeof parsed !== "object") return GROUNDED;
  const obj = parsed as Record<string, unknown>;
  if (obj.grounded === false) {
    const unsupported = Array.isArray(obj.unsupported)
      ? obj.unsupported.filter((u): u is string => typeof u === "string")
      : [];
    return { grounded: false, unsupported };
  }
  // grounded true, o ausente/ambiguo → fail-open a grounded.
  return GROUNDED;
}

export async function checkGrounding(args: GroundingCheckArgs): Promise<GroundingCheckResult> {
  if (!args.reply.trim()) return GROUNDED;
  try {
    const res = await generateText({
      model: args.model as any,
      system: "Devuelve únicamente el objeto JSON pedido, sin texto adicional.",
      prompt: buildPrompt(args),
      temperature: 0,
    });
    return parseResult(res.text ?? "");
  } catch (e) {
    console.warn("[blindajeCheck] fallo del verificador — fail-open:", (e as Error)?.message ?? e);
    return GROUNDED;
  }
}
