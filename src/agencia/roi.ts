/**
 * Calculadora de ROI (Modo Agencia · pieza C). Traduce la actividad del bot en
 * el período a un número de plata, para que la agencia (o el dueño) justifique
 * la mensualidad. Reusa gatherMetrics de reportes/run.ts — nada nuevo que medir.
 *
 * Supuesto de "horas ahorradas": cada respuesta del bot ≈ 2 min de atención
 * humana (mismo criterio que el reporte). Los valores ($/hora, mensualidad,
 * valor de una cita recuperada, moneda) los ajusta la agencia en Config.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { gatherMetrics } from "../reportes/run";

const D = 24 * 60 * 60 * 1000;
const DEFAULT_HOURLY_RATE = 8;
const DEFAULT_CURRENCY = "USD";

export interface Roi {
  periodDays: number;
  chats: number;
  leads: number;
  hoursSaved: number;
  laborSaved: number; // hoursSaved * hourlyRate
  noShowsRecovered: number;
  noShowMoney: number; // noShowsRecovered * noShowValue
  moneySaved: number; // laborSaved + noShowMoney
  currency: string;
  hourlyRate: number;
  monthlyFee: number | null;
  roiMultiple: number | null; // (moneySaved normalizado a 30d) / monthlyFee
  topChannel: string | null;
  topTopics: string[];
}

/** Lee un número positivo de settings; si no es válido, devuelve el default. */
function num(raw: string | null, def: number): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export async function computeRoi(
  env: Env,
  opts: { now?: number; days?: number } = {},
): Promise<Roi> {
  const now = opts.now ?? Date.now();
  const periodDays = opts.days && opts.days > 0 ? opts.days : 30;
  const sinceMs = now - periodDays * D;

  const settings = new SettingsRepo(new Db(env.DB));
  const [m, rateRaw, currencyRaw, feeRaw, noShowRaw] = await Promise.all([
    gatherMetrics(env, sinceMs, now),
    settings.get(SETTING_KEYS.roiHourlyRate),
    settings.get(SETTING_KEYS.roiCurrency),
    settings.get(SETTING_KEYS.roiMonthlyFee),
    settings.get(SETTING_KEYS.roiNoShowValue),
  ]);

  const hourlyRate = num(rateRaw, DEFAULT_HOURLY_RATE);
  const currency = (currencyRaw ?? "").trim() || DEFAULT_CURRENCY;
  const noShowValue = num(noShowRaw, 0);
  const feeParsed = Number.parseFloat((feeRaw ?? "").trim());
  const monthlyFee = Number.isFinite(feeParsed) && feeParsed > 0 ? feeParsed : null;

  const hoursSaved = m.savedHours;
  const laborSaved = round2(hoursSaved * hourlyRate);
  const noShowMoney = round2(m.noShowsRecovered * noShowValue);
  const moneySaved = round2(laborSaved + noShowMoney);

  const monthlyEquivalent = moneySaved * (30 / periodDays);
  const roiMultiple = monthlyFee ? round2(monthlyEquivalent / monthlyFee) : null;

  return {
    periodDays,
    chats: m.conversations,
    leads: m.newLeads,
    hoursSaved,
    laborSaved,
    noShowsRecovered: m.noShowsRecovered,
    noShowMoney,
    moneySaved,
    currency,
    hourlyRate,
    monthlyFee,
    roiMultiple,
    topChannel: m.topChannel,
    topTopics: m.topTopics,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
