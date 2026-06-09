// NutriDesk â€” Edge Function de IA (Supabase / Deno)
// Deploy: Supabase Dashboard â†’ Edge Functions â†’ Deploy a new function â†’ nombre "ai" â†’ pegar este cÃ³digo.
// Secret:  Edge Functions â†’ Secrets â†’ ANTHROPIC_API_KEY = tu key de Anthropic.
import Anthropic from 'npm:@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' });

const DAYS = ['Lunes', 'Martes', 'MiÃ©rcoles', 'Jueves', 'Viernes', 'SÃ¡bado', 'Domingo'];
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena'];

const mealSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Nombre corto del plato' },
    desc: { type: 'string', description: 'Ingredientes y porciones, ej: "Pechuga 180g + mix verdes"' },
    kcal: { type: 'integer', description: 'CalorÃ­as estimadas de la comida' },
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });

// deno-lint-ignore no-explicit-any
function patientContext(p: any): string {
  return [
    `Paciente: ${p.name}, ${p.age} aÃ±os, sexo ${p.sex === 'M' ? 'masculino' : 'femenino'}.`,
    `Peso: ${p.weight} kg, talla: ${p.height} cm, IMC: ${p.imc}.`,
    `Objetivo: ${p.obj}.`,
    `PatologÃ­as: ${(p.patho || []).join(', ') || 'ninguna'}.`,
    `Restricciones alimentarias: ${(p.restr || []).join(', ') || 'ninguna'}.`,
    p.meds ? `MedicaciÃ³n: ${p.meds}.` : '',
    p.activity ? `Actividad fÃ­sica: ${p.activity}.` : '',
    p.schedule ? `Horarios habituales: ${p.schedule}.` : '',
    p.prefs ? `Preferencias: ${p.prefs}.` : '',
    p.evolution ? `EvoluciÃ³n de peso: ${p.evolution}.` : '',
  ].filter(Boolean).join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'MÃ©todo no permitido' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'IA no configurada' }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON invÃ¡lido' }, 400);
  }

  try {
    if (body.type === 'plan') {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system:
          'Sos un asistente de nutricionistas matriculados en Argentina. GenerÃ¡s planes ' +
          'alimentarios semanales con comidas tÃ­picas argentinas accesibles, respetando ' +
          'estrictamente patologÃ­as y restricciones del paciente. Las calorÃ­as deben ser ' +
          'coherentes con el objetivo. VariÃ¡ los platos entre dÃ­as. El plan serÃ¡ revisado y ' +
          'aprobado por la profesional antes de entregarse al paciente.',
        messages: [{
          role: 'user',
          content:
            `GenerÃ¡ el plan semanal (Lunes a Domingo, 4 comidas por dÃ­a) para este paciente:\n\n` +
            patientContext(body.patient) +
            (body.notes ? `\n\nIndicaciones de la nutricionista: ${body.notes}` : ''),
        }],
        output_config: { format: { type: 'json_schema', schema: planSchema } },
      });
      const text = response.content.find((b) => b.type === 'text')?.text ?? '';
      return json({ plan: JSON.parse(text) });
    }

    if (body.type === 'chat') {
      // deno-lint-ignore no-explicit-any
      const history = (body.messages || []).slice(-12).map((m: any) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: String(m.text || '').slice(0, 4000),
      }));
      if (!history.length || history[0].role !== 'user') {
        return json({ error: 'ConversaciÃ³n invÃ¡lida' }, 400);
      }
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system:
          'Sos el asistente clÃ­nico de NutriDesk para nutricionistas matriculadas en Argentina. ' +
          'RespondÃ©s consultas profesionales sobre el paciente en contexto: requerimientos, manejo ' +
          'nutricional de patologÃ­as, restricciones, estrategias segÃºn objetivo. SÃ© concreto y breve ' +
          '(mÃ¡ximo ~150 palabras), usÃ¡ terminologÃ­a profesional y cerrÃ¡ decisiones clÃ­nicas con el ' +
          'criterio de la profesional. No des diagnÃ³sticos ni indiques/ajustes medicaciÃ³n.\n\n' +
          'Contexto del paciente:\n' + patientContext(body.patient),
        messages: history,
      });
      const text = response.content.find((b) => b.type === 'text')?.text ?? '';
      return json({ reply: text });
    }

    return json({ error: 'Tipo de pedido desconocido' }, 400);
  } catch (err) {
    console.error('AI function error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: 'Error del servicio de IA', detail: msg.slice(0, 300) }, 502);
  }
});
