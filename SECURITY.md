# Reporte de Seguridad — NutriDesk

Fecha: 10/06/2026 · Alcance: app desplegada (Netlify + Supabase + Edge Function de IA).
Tipo: pruebas activas contra la propia infraestructura + revisión de código.

## Resumen ejecutivo

**¿Pueden filtrarse los datos de los pacientes?** No por accesos anónimos: la base
de datos rechaza toda lectura/escritura sin sesión válida (RLS verificado). Cada
nutricionista solo puede ver sus propios datos.

**¿Pueden robar las credenciales de acceso?** Las contraseñas las gestiona Supabase
Auth (hasheadas, nunca viajan en claro ni se guardan en la app). La clave secreta de
IA (Anthropic) **no** está en el navegador, vive solo en el servidor.

Riesgo residual principal: **rotar las claves que se compartieron por chat** durante
el armado (ver acción #1). El resto son mejoras de robustez, ya aplicadas o recomendadas.

---

## Pruebas realizadas y resultados

| # | Prueba | Resultado |
|---|---|---|
| 1 | Leer tabla `app_state` sin login (solo anon key) | ✅ Devuelve vacío — RLS bloquea |
| 2 | Insertar fila de otro usuario sin login | ✅ `401` — RLS bloquea |
| 3 | Llamar a la función de IA sin credenciales | ✅ `401` Missing auth header |
| 4 | Llamar a la función con JWT falso | ✅ `401` Invalid JWT |
| 5 | API key de Anthropic en el frontend | ✅ No aparece (`sk-ant` ausente en el bundle) |
| 6 | HTTPS / HSTS | ✅ Activo (`max-age=1 año; preload`) |
| 7 | Headers de seguridad (CSP, X-Frame, etc.) | ⚠️ Faltaban → **corregido** (`_headers`) |
| 8 | Abuso de la función IA con anon key pública | ⚠️ Posible → **corregido** (exige usuario logueado) |

---

## Hallazgos y estado

### 🔴 ALTA — Credenciales compartidas por chat (ACCIÓN DEL CLIENTE)
Durante el setup se pegaron en el chat: la API key de Anthropic, la `secret key`
de Supabase y la contraseña inicial. Quedaron registradas en el historial.
**Acción:** rotarlas (instrucciones abajo). Hasta hacerlo, alguien con ese historial
podría usarlas.

### 🟠 MEDIA — Abuso de la función de IA con la anon key (CORREGIDO)
La anon key es pública (va en `config.js`, es así por diseño). Antes, cualquiera con
esa key podía llamar a la función de IA y **gastar tus créditos de Anthropic** sin
loguearse. **Corregido:** la función ahora valida que la request venga de un **usuario
realmente logueado** (verifica el token de sesión contra Supabase) y rechaza la anon
key sola con `401`. Además limita el tamaño del pedido (anti-abuso de tokens).
*Defensa en profundidad:* mantené un **límite de gasto** en la consola de Anthropic.

### 🟠 MEDIA — Faltaban headers de seguridad (CORREGIDO)
El sitio no enviaba CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy ni
Permissions-Policy. **Corregido** con el archivo `_headers`:
- **Content-Security-Policy**: limita de dónde se cargan scripts/recursos (mitiga XSS).
- **X-Frame-Options: DENY** + `frame-ancestors 'none'`: evita clickjacking (que tu app
  se incruste en un iframe malicioso).
- **X-Content-Type-Options: nosniff**, **Referrer-Policy**, **Permissions-Policy**:
  endurecimiento general.

### 🟢 BAJA / informativo
- **anon key visible en `config.js`**: es correcto y esperado — es una clave pública;
  la seguridad real la da RLS, no el secreto de esta key.
- **Datos en localStorage**: la app cachea datos en el navegador. En una compu
  compartida, otra persona con acceso al equipo podría verlos. Usá "Cerrar sesión" y
  no uses la app en equipos públicos. (Conforme a un MVP; aceptable.)
- **CSP con `'unsafe-inline'`**: la app es un único archivo con estilos y handlers
  inline, así que el CSP permite inline. Reduce parte del beneficio anti-XSS pero sigue
  bloqueando la carga de dominios externos no autorizados. Mejora futura: externalizar
  scripts y quitar `unsafe-inline`.

---

## Cómo está protegido cada activo

- **Datos clínicos de pacientes** → Postgres de Supabase con **Row Level Security**:
  política `auth.uid() = user_id` en SELECT/INSERT/UPDATE/DELETE. Un usuario no puede
  leer ni tocar filas de otro, ni siquiera conociendo la anon key. Verificado.
- **Contraseñas** → Supabase Auth (hash bcrypt/scrypt del lado servidor). La app nunca
  las almacena ni las ve; el login devuelve un token de sesión temporal.
- **Clave de IA (Anthropic)** → solo como *secret* del servidor (Edge Function / Netlify
  env var). Nunca se envía al navegador. Verificado ausente del bundle.
- **Transporte** → todo por HTTPS con HSTS (fuerza HTTPS por 1 año).

---

## Acciones pendientes del cliente (en orden)

1. **🔴 Rotar las claves expuestas en el chat:**
   - Anthropic: platform.claude.com → API Keys → crear nueva, borrar la vieja →
     actualizar el secret `ANTHROPIC_API_KEY` en Supabase (Edge Functions → Secrets).
   - Supabase: Settings → API → rotar la `secret`/`service_role` key.
   - Cambiar la **contraseña** del usuario de la nutricionista (Authentication → Users).
2. **🟠 Redeploy** del sitio (Netlify) y de la función `swift-api` (Supabase) para que
   tomen los cambios de seguridad ya commiteados. *(El redeploy de Netlify es automático
   si está conectado a GitHub; la función de Supabase hay que volver a Deploy con el
   código nuevo de `supabase/functions/ai/index.ts`.)*
3. **🟢 Límite de gasto** en Anthropic (ya tenés saldo acotado; dejalo así).
4. **🟢 Email confirmation** en Supabase Auth si vas a dar de alta más usuarios.

---

## Qué NO cubre este MVP (honesto)

- No hay registro de auditoría (quién vio qué y cuándo).
- No hay 2FA en el login.
- No hay backup automático configurado (usá "Exportar respaldo JSON" periódicamente, o
  activá backups en Supabase).
- El cumplimiento formal de la Ley 25.326 (datos personales/salud) requiere además
  políticas de tratamiento y consentimiento — esto es técnico, no legal.

Para un MVP con una sola profesional, el nivel de protección es razonable. Antes de
escalar a varios usuarios o datos sensibles a gran escala, conviene sumar auditoría,
2FA y una revisión legal de protección de datos.
