// NutriDesk — Función serverless de IA (Netlify Functions v2)
// La ANTHROPIC_API_KEY vive solo acá (variable de entorno en Netlify), nunca en el navegador.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena'];

const mealSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Nombre corto del plato' },
    desc: { type: 'string', description: 'Ingredientes y porciones, ej: "Pechuga 180g + mix verdes"' },
    kcal: { type: 'integer', description: 'Calorías estimadas de la comida' },
  },
  required: ['name', 'desc', 'kcal'],
  additionalProperties: false,
};

const daySchema = {
  type: 'object',
  properties: Object.fromEntries(MEALS.map((m) => [m, mealSchema])),
  required: MEALS,
  additionalProperties: false,
};

const planSchema = {
  type: 'object',
  properties: Object.fromEntries(DAYS.map((d) => [d, daySchema])),
  required: DAYS,
  additionalProperties: false,
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

function patientContext(p) {
  return [
    `Paciente: ${p.name}, ${p.age} años, sexo ${p.sex === 'M' ? 'masculino' : 'femenino'}.`,
    `Peso: ${p.weight} kg, talla: ${p.height} cm, IMC: ${p.imc}.`,
    `Objetivo: ${p.obj}.`,
    `Patologías: ${(p.patho || []).join(', ') || 'ninguna'}.`,
    `Restricciones alimentarias: ${(p.restr || []).join(', ') || 'ninguna'}.`,
    p.meds ? `Medicación: ${p.meds}.` : '',
    p.activity ? `Actividad física: ${p.activity}.` : '',
    p.schedule ? `Horarios habituales: ${p.schedule}.` : '',
    p.prefs ? `Preferencias: ${p.prefs}.` : '',
    p.evolution ? `Evolución de peso: ${p.evolution}.` : '',
  ].filter(Boolean).join('\n');
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'IA no configurada' }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  try {
    if (body.type === 'plan') {
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8192,
        system:
          'Sos un asistente de nutricionistas matriculados en Argentina. Generás planes ' +
          'alimentarios semanales con comidas típicas argentinas accesibles, respetando ' +
          'estrictamente patologías y restricciones del paciente. Las calorías deben ser ' +
          'coherentes con el objetivo. Variá los platos entre días. El plan será revisado y ' +
          'aprobado por la profesional antes de entregarse al paciente.',
        messages: [{
          role: 'user',
          content:
            `Generá el plan semanal (Lunes a Domingo, 4 comidas por día) para este paciente:\n\n` +
            patientContext(body.patient) +
            (body.notes ? `\n\nIndicaciones de la nutricionista: ${body.notes}` : ''),
        }],
        output_config: { format: { type: 'json_schema', schema: planSchema } },
      });
      const text = response.content.find((b) => b.type === 'text')?.text;
      return json({ plan: JSON.parse(text) });
    }

    if (body.type === 'chat') {
      const history = (body.messages || []).slice(-12).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.text || '').slice(0, 4000),
      }));
      if (!history.length || history[0].role !== 'user') {
        return json({ error: 'Conversación inválida' }, 400);
      }
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system:
          'Sos el asistente clínico de NutriDesk para nutricionistas matriculadas en Argentina. ' +
          'Respondés consultas profesionales sobre el paciente en contexto: requerimientos, manejo ' +
          'nutricional de patologías, restricciones, estrategias según objetivo. Sé concreto y breve ' +
          '(máximo ~150 palabras), usá terminología profesional y cerrá decisiones clínicas con el ' +
          'criterio de la profesional. No des diagnósticos ni indiques/ajustes medicación.\n\n' +
          'Contexto del paciente:\n' + patientContext(body.patient),
        messages: history,
      });
      const text = response.content.find((b) => b.type === 'text')?.text || '';
      return json({ reply: text });
    }

    return json({ error: 'Tipo de pedido desconocido' }, 400);
  } catch (err) {
    console.error('AI function error:', err);
    return json({ error: 'Error del servicio de IA', detail: String(err?.message || err).slice(0, 300) }, 502);
  }
};

export const config = { path: '/api/ai' };
