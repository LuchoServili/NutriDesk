# NutriDesk — App de producción (v2.1)

Plataforma para nutricionistas: pacientes, planes con IA (Claude), evolución, chat clínico, PDF con marca propia y WhatsApp.

## Arquitectura

```
Navegador (index.html, sin frameworks)
   ├── /api/ai  ───────────►  Netlify Function (netlify/functions/ai.mjs)
   │                             └── API de Anthropic (la key vive solo acá)
   └── Supabase JS (CDN) ───►  Auth + tabla app_state (RLS por usuario)
```

**Degradación elegante:** sin configurar nada, la app funciona en modo local
(login demo `sofia@nutridesk.com` / `demo1234`, datos en localStorage, IA
simulada con plantillas). Cada integración se activa sola al configurarla.

## Puesta en producción (3 pasos)

### 1. Netlify (hosting + IA)

1. Subí la carpeta `nutridesk-app/` a un repo de GitHub (o usá Netlify Drop / `netlify deploy`).
2. En Netlify: **Add new site → Import from Git** y seleccioná el repo. No hace falta build command; publish directory: `.` (ya está en `netlify.toml`).
3. En **Site settings → Environment variables** agregá:
   - `ANTHROPIC_API_KEY` = tu key de https://platform.claude.com (Settings → API Keys).
4. Deploy. Con esto la generación de planes y el chat ya usan Claude de verdad
   (planes: Claude Opus; chat: Claude Haiku, como definía el Lean Inception).

### 2. Supabase (usuarios + datos en la nube)

1. Creá un proyecto en https://supabase.com (plan free alcanza).
2. **SQL Editor → New query**: pegá el contenido de `supabase/schema.sql` y ejecutá.
3. **Authentication → Users → Add user**: creá el usuario de la nutricionista
   (email + contraseña). Desactivá "Confirm email" si no configuraste SMTP
   (Authentication → Providers → Email).
4. **Settings → API**: copiá la *Project URL* y la *anon public key* y pegalas
   en `config.js`:
   ```js
   window.NUTRIDESK_CONFIG = {
     SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
     SUPABASE_ANON_KEY: 'eyJ...',
   };
   ```
   (Estos dos valores son públicos por diseño; la seguridad la da RLS.)
5. Re-deployá. El login pasa a ser real y los datos se sincronizan a la nube
   (cada profesional ve solo lo suyo — multi-tenancy por RLS, Ley 25.326).

### 3. Listo

- Los datos siguen guardándose también en localStorage como caché/respaldo.
- "Exportar respaldo (JSON)" en Configuración sigue disponible.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La app completa (HTML+CSS+JS, sin build) |
| `config.js` | Config pública del frontend (Supabase) |
| `netlify/functions/ai.mjs` | Función serverless que llama a Claude |
| `netlify.toml` | Config de Netlify |
| `package.json` | Dependencia `@anthropic-ai/sdk` para la función |
| `supabase/schema.sql` | Tabla `app_state` + políticas RLS |

## Costos estimados

- Netlify free: alcanza de sobra (sitio estático + functions).
- Supabase free: alcanza (una fila JSONB por profesional).
- Anthropic: pago por uso. Un plan semanal con Opus ≈ centavos; un mensaje de
  chat con Haiku ≈ fracciones de centavo. Cargá un límite de gasto en la
  consola de Anthropic para quedarte tranquila.

## Seguridad

- La API key de Anthropic nunca llega al navegador (solo vive en Netlify).
- Supabase RLS: cada usuario solo puede leer/escribir su propia fila.
- Datos personales tratados conforme Ley 25.326; el plan aprobado registra
  fecha y matrícula (Ley 17.132).
