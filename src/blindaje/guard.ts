import type { Env } from "../env";
import type { LlmOverrides } from "../llm/provider";
import { createModel } from "../llm/provider";
import { checkGrounding } from "../llm/blindajeCheck";
import { Db } from "../db/client";
import { TicketsRepo } from "../db/tickets";
import { ConversationsRepo } from "../db/conversations";
import { notifyOwner } from "../tools/handoffHuman";

// Blindaje anti-invento — guard post-generación.
//
// Corre SOLO cuando el dueño activó Blindaje y el bot no llamó ya a
// handoffHuman. Verifica que la respuesta se apoye en fuentes reales (contexto
// del negocio + chunks de searchKb del turno). Si detecta un invento: reemplaza
// la respuesta por un deflection seguro y abre un ticket para el dueño.
//
// FAIL-OPEN en todo: si el chequeo o el ticket fallan, la respuesta ORIGINAL
// sale igual. Blindaje nunca deja mudo al bot.

const DEFLECTION: Record<string, string> = {
  es: "Déjame confirmarlo con el equipo y te aviso en un momento.",
  en: "Let me confirm that with the team and get right back to you.",
  pt: "Deixa eu confirmar isso com a equipe e já te aviso.",
};

function deflectionFor(language: string): string {
  const key = (language || "es").slice(0, 2).toLowerCase();
  return DEFLECTION[key] ?? DEFLECTION.es;
}

/** Concatena los `content` de los resultados de searchKb del turno. */
function kbChunksFrom(toolResults: { toolName: string; output: unknown }[]): string {
  const chunks: string[] = [];
  for (const tr of toolResults) {
    if (tr.toolName !== "searchKb") continue;
    const results = (tr.output as { results?: { content?: string }[] } | undefined)?.results;
    for (const r of results ?? []) {
      if (r?.content) chunks.push(r.content);
    }
  }
  return chunks.join("\n---\n");
}

/** Mayor score de searchKb visto en el turno (para el hook lastSearchKbScore). */
export function topKbScore(toolResults: { toolName: string; output: unknown }[]): number | null {
  let top: number | null = null;
  for (const tr of toolResults) {
    if (tr.toolName !== "searchKb") continue;
    const results = (tr.output as { results?: { score?: number }[] } | undefined)?.results;
    for (const r of results ?? []) {
      if (typeof r?.score === "number") top = top === null ? r.score : Math.max(top, r.score);
    }
  }
  return top;
}

export interface BlindajeGuardArgs {
  env: Env;
  llm: LlmOverrides;
  conversationId: string | null;
  reply: string;
  businessContext: string;
  toolResults: { toolName: string; output: unknown }[];
  language: string;
}

export interface BlindajeGuardResult {
  /** El texto a enviar (el original, o el deflection si se bloqueó). */
  text: string;
  /** true si se detectó un invento y se reemplazó la respuesta. */
  blocked: boolean;
}

export async function runBlindajeGuard(args: BlindajeGuardArgs): Promise<BlindajeGuardResult> {
  const sources = [args.businessContext, kbChunksFrom(args.toolResults)]
    .filter((s) => s && s.trim())
    .join("\n\n");

  let grounded = true;
  let unsupported: string[] = [];
  try {
    const { model } = createModel(args.env, "fast", args.llm);
    const res = await checkGrounding({
      model,
      reply: args.reply,
      sources,
      language: args.language,
    });
    grounded = res.grounded;
    unsupported = res.unsupported;
  } catch (e) {
    console.warn("[blindaje] guard fail-open:", (e as Error)?.message ?? e);
    return { text: args.reply, blocked: false };
  }

  if (grounded) return { text: args.reply, blocked: false };

  console.warn(
    `[blindaje] respuesta bloqueada — datos sin fundamento: ${unsupported.join(" | ") || "(sin detalle)"}`,
  );

  // Abre un ticket para que el dueño confirme y responda. Fail-open: si falla,
  // igual mandamos el deflection (mejor que el invento).
  try {
    const db = new Db(args.env.DB);
    const tickets = new TicketsRepo(db);
    const summary = `El bot iba a afirmar datos sin respaldo (${unsupported.join("; ") || "sin detalle"}). Blindaje lo frenó y pidió confirmar.`;
    const ticketId = await tickets.create({
      conversationId: args.conversationId,
      category: "other",
      summary: `[blindaje] ${summary}`,
      transcript: "",
    });
    if (args.conversationId) {
      await new ConversationsRepo(db).setOpenTicket(args.conversationId, ticketId);
    }
    await notifyOwner(args.env, {
      reason: "blindaje",
      summary,
      ticketId,
    });
  } catch (e) {
    console.error("[blindaje] no se pudo abrir el ticket:", (e as Error)?.message ?? e);
  }

  return { text: deflectionFor(args.language), blocked: true };
}
