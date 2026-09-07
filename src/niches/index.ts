import type { Env } from "../env";
import type { NichePack } from "./types";
import { generico } from "./generico";
import { tienda } from "./tienda";
import { barberia } from "./barberia";
import { salon } from "./salon";
import { spa } from "./spa";
import { gimnasio } from "./gimnasio";

export type { NichePack, NicheColumn } from "./types";

// Registro de packs. Agregar un nicho = importar su archivo y sumarlo aquí.
const PACKS: Record<string, NichePack> = {
  generico,
  tienda,
  barberia,
  salon,
  spa,
  gimnasio,
};

/** Resuelve el pack activo desde BOT_NICHE. Nicho ausente/desconocido → genérico. */
export function getNiche(env: Env): NichePack {
  const id = (env.BOT_NICHE ?? "").trim().toLowerCase();
  return PACKS[id] ?? generico;
}
