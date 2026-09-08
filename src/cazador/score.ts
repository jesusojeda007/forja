// Cazador de ventas — puntaje de calor de un lead por SEÑALES (sin LLM).
// Determinista, barato: corre después de cada turno. El objetivo no es precisión
// perfecta, es avisarle al dueño cuando alguien está claramente listo para comprar.

export type LeadBand = "frio" | "tibio" | "caliente" | "muy_caliente";

export function bandOf(score: number): LeadBand {
  if (score >= 75) return "muy_caliente";
  if (score >= 50) return "caliente";
  if (score >= 25) return "tibio";
  return "frio";
}

export interface ScoreInput {
  /** Texto de los mensajes del cliente (no los del bot). */
  userTexts: string[];
  /** Ya se capturó un lead para esta conversación. */
  hasLead: boolean;
  /** Ya se agendó una cita para esta conversación. */
  hasAppointment: boolean;
}

export interface ScoreResult {
  score: number;
  band: LeadBand;
  /** Por qué está caliente, en lenguaje humano (para el aviso al dueño). */
  reason: string;
}

interface Signal {
  test: (blob: string, input: ScoreInput) => boolean;
  points: number;
  label: string;
}

const SIGNALS: Signal[] = [
  { points: 25, label: "dio sus datos (lead capturado)", test: (_b, i) => i.hasLead },
  { points: 30, label: "agendó una cita", test: (_b, i) => i.hasAppointment },
  { points: 15, label: "preguntó el precio", test: (b) => /\bprecio|precios|costo|cuesta|cu[aá]nto\s+(?:vale|cuesta|sale)|\bvale\b|\$\s*\d/.test(b) },
  {
    points: 25,
    label: "dijo que quiere comprar",
    test: (b) =>
      /\b(lo|la|me lo|me la)\s+quiero\b|ya lo quiero|c[oó]mo\s+(?:pago|te pago|puedo pagar)|quiero\s+(?:comprar|contratar|apartar|reservar|agendar|el|la|una|un)\b|me lo llevo|voy a comprar|apartar\b|reservar ya/.test(b),
  },
  { points: 10, label: "preguntó por disponibilidad", test: (b) => /\bdisponible|disponibilidad|tienen\b|hay\s+(?:para|el|la|de)|\bqueda[n]?\b|en stock|hay stock/.test(b) },
  { points: 5, label: "mostró urgencia", test: (b) => /\bhoy\b|\bma[nñ]ana\b|esta semana|urgente|lo antes posible|cuanto antes/.test(b) },
];

const ENGAGEMENT_MIN_MSGS = 4;
const ENGAGEMENT_POINTS = 10;

export function scoreConversation(input: ScoreInput): ScoreResult {
  const blob = input.userTexts.join("  ").toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const sig of SIGNALS) {
    if (sig.test(blob, input)) {
      score += sig.points;
      reasons.push(sig.label);
    }
  }

  if (input.userTexts.length >= ENGAGEMENT_MIN_MSGS) {
    score += ENGAGEMENT_POINTS;
    reasons.push(`escribió ${input.userTexts.length} mensajes`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, band: bandOf(score), reason: reasons.join(", ") };
}
