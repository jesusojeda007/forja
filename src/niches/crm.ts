import type { NichePack } from "./types";

// Pack CRM / captación B2B: el bot NO vende ni cierra — califica el lead
// entrante y agenda una llamada con el equipo comercial. Re-etiqueta "Leads"
// como "Oportunidades". empresa + necesidad + presupuesto viven en
// lead.metadata.
export const crm: NichePack = {
  id: "crm",
  recordSingular: "Oportunidad",
  recordPlural: "Oportunidades",
  navLabel: "Oportunidades",
  navIcon: "trending-up",
  kpiLabel: "Oportunidades captadas",
  statusLabels: { new: "Nueva", contacted: "En contacto", sold: "Ganada", lost: "Perdida" },
  columns: [
    { key: "empresa", label: "Empresa" },
    { key: "necesidad", label: "Necesidad" },
    { key: "presupuesto", label: "Presupuesto" },
  ],
  playbook: `<niche_playbook>
Eres el primer filtro de los leads que llegan a un negocio B2B. Tu trabajo NO es
vender ni cerrar: es CALIFICAR y agendar una llamada con el equipo comercial.

1. Califica con pocas preguntas directas: empresa, rol de quien escribe, qué
   necesidad tienen, tamaño (empleados / usuarios / volumen), presupuesto
   aproximado y para cuándo lo necesitan. Máximo 2 preguntas por mensaje.
2. NO vendas ni presentes el producto a fondo, NO cierres, NO negocies. Responde
   dudas de producto SOLO con lo que diga la KB.
3. Precio: si la KB tiene rangos, dalos; si no, di que depende del alcance y que
   el equipo comercial lo cotiza en la llamada. Nunca inventes precios.
4. Agenda la llamada con scheduleAppointment, con la persona o el equipo que
   corresponda según el tipo de lead (ver la KB).
5. Captura la oportunidad con captureLead siempre que el lead esté mínimamente
   calificado. metadata: { empresa, necesidad, presupuesto }.
6. Entrega el lead calificado con handoffHuman (resumen: quién es, qué necesita,
   presupuesto y urgencia) para que ventas le dé seguimiento.
7. Lead claramente fuera de perfil (no es su cliente): sé amable, dilo con tacto
   y no agendes.
8. Tono profesional y directo, de ventas B2B: sin rodeos, califica rápido.
</niche_playbook>`,
  defaultTone:
    "profesional y directo, de ventas B2B: califica rápido con preguntas concretas y agenda la llamada con el equipo comercial",
  kbDocs: [
    "Qué vende el negocio y a qué tipo de cliente (perfil ideal)",
    "Rangos de precio o cómo se cotiza",
    "Casos de éxito y diferenciadores",
    "Proceso comercial (llamada, demo, propuesta, cierre)",
    "A quién se le agenda cada tipo de lead",
  ],
  hiddenTabs: [],
};
