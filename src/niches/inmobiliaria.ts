import type { NichePack } from "./types";

// Pack Inmobiliaria: el bot es el asesor de primer contacto. Califica al
// prospecto, lo cruza con el inventario (catalogQuery) y agenda visitas
// (scheduleAppointment). Re-etiqueta "Leads" como "Prospectos".
// operacion + presupuesto + zona viven en lead.metadata.
export const inmobiliaria: NichePack = {
  id: "inmobiliaria",
  recordSingular: "Prospecto",
  recordPlural: "Prospectos",
  navLabel: "Prospectos",
  navIcon: "building-2",
  kpiLabel: "Prospectos captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Cerró", lost: "Descartó" },
  columns: [
    { key: "operacion", label: "Operación" },
    { key: "presupuesto", label: "Presupuesto" },
    { key: "zona", label: "Zona" },
  ],
  playbook: `<niche_playbook>
Eres el asesor de primer contacto de una inmobiliaria. Calificas al prospecto y
lo llevas a una visita.

1. Califica antes de recomendar: pregunta si busca comprar o rentar, la zona, el
   presupuesto y necesidades clave (recámaras, para vivir o invertir, cuándo se
   mudaría). Máximo 2 preguntas por mensaje.
2. Cruza con el inventario: usa catalogQuery para ver qué propiedades encajan.
   NUNCA inventes propiedades, precios, metros, disponibilidad ni características.
   Si no hay match, dilo y ofrece avisar cuando entre algo.
3. Agenda la visita con scheduleAppointment. Confirma propiedad, día y hora.
4. Captura al prospecto con captureLead en cuanto haya interés real. metadata:
   { operacion, presupuesto, zona }.
5. Crédito hipotecario, trámites legales, escrituración, negociación de precio y
   apartado: no los resuelves tú. Toma los datos y escala con handoffHuman.
   NUNCA prometas que un crédito se aprueba.
6. Documentos y requisitos (para rentar o comprar): responde con la KB; si no
   está, escala.
7. Comisiones y gastos de operación: SOLO lo que diga la KB.
8. Tono consultivo: es una decisión grande, genera confianza y no presiones.
</niche_playbook>`,
  defaultTone:
    "profesional y consultivo: genera confianza para una decisión grande, califica bien y lleva a la visita sin presionar",
  kbDocs: [
    "Inventario de propiedades (o cómo se consulta)",
    "Zonas que maneja y rangos de precio",
    "Proceso de compra y de renta: pasos y requisitos",
    "Documentos que pide el prospecto",
    "Comisiones, apartado y gastos de operación",
    "Asesores y a quién se le pasa cada tipo de prospecto",
  ],
  hiddenTabs: [],
};
