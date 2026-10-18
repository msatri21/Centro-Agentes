import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, Trabajador, Trabajo } from '../types'
import { colaDeLineas, figura, grafica, pagina, tablero, VINO } from './figura'
import { agregarRendimiento, bloqueos, informeMarkdown, leerAider, leerDependencias, listas, temaNtfyValido } from './extras'
import type { Fila, Seccion, Tono } from './figura'

// Los tonos del kit de anatomy para la terminal: grises y negros, y el vinotinto como único acento.
const GRIS: Record<Tono, string> = { hi: '#d4d4d4', mid: '#8a8a8a', lo: '#5a5a5a', vino: VINO }

const PANE = 'centro-agentes'
const TITULO = 'Centro de agentes MST'
const STORE_KEY = 'puntajes'
const WEB_KEY = 'web'
const ABIERTA_KEY = 'web-abierta-el'
const TRABAJADORES: readonly Trabajador[] = ['ollama', 'opencode', 'hermes', 'aider', 'claude']

let seq = 0
const trabajos = atom({ plugin: 'centro-agentes', key: 'trabajos' } as const, [] as Trabajo[])
const plan = atom({ plugin: 'centro-agentes', key: 'plan' } as const, null as Plan | null)

type Celda = { n: number; suma: number; msTotal: number }
type Puntajes = Record<string, Record<string, Celda>>

type Opciones = {
  ollamaModels?: string
  hermesModels?: string
  aiderModels?: string
  presupuestoClaudeTokens?: number
  ntfyTema?: string
  opencodeModels?: string
  claudeModels?: string
  timeoutMin?: number
  proxy?: string
  certificadoCA?: string
  esperaInicialSeg?: number
  abrirAlIniciar?: boolean
  modoJefe?: boolean
}

type Modelos = Record<Trabajador, string[]>

type Salida = { texto: string; tokensIn?: number; tokensOut?: number; ventana?: number; costo?: number }

// Un "trabajador" del ranking es trabajador:modelo (o solo trabajador si usa el modelo por defecto).
const clave = (t: Trabajador, modelo?: string) => (modelo ? `${t}:${modelo}` : t)

const lista = (s: string | undefined, def: string[]) => {
  const l = (s ?? '').split(',').map(x => x.trim()).filter(Boolean)
  return l.length ? l : def
}

const protocolo = (m: Modelos) => `Actúa como JEFE del centro de agentes. Tú no haces el trabajo: planificas, repartes, verificas y entregas. Gasta lo mínimo de Claude: el trabajo lo hacen los agentes gratis.

Agentes (el centro elige solo el mejor modelo de cada uno según su historial; un agente sin probar se explora):
- opencode: agente de código que edita archivos en su directorio. Modelos gratis en la nube: ${ver(m.opencode)}.
- ollama: modelos de texto, en la nube de Ollama (gratis) y uno local de respaldo: ${ver(m.ollama)}.
- hermes: Hermes Agent (Nous Research), agente generalista con sus propias herramientas (terminal, archivos, web); usa los modelos gratis de la nube de Ollama: ${ver(m.hermes)}.
- aider: Aider, agente de código por parejas que edita archivos en su directorio; usa los modelos gratis de la nube de Ollama: ${ver(m.aider)}.
- claude: Claude headless (${ver(m.claude)}). Gasta del plan de Claude: el centro solo lo elige si los gratis rinden claramente peor.

Protocolo:
1. Haz un plan: divide la tarea en subtareas lo más independientes posible y regístralas con mcp__centro-agentes__planificar. Es lo que el usuario ve como progreso. Si una necesita el resultado de otras, ponlo en "dependencias" (p. ej. {"3": [1, 2]}); planificar y registrar_auditoria te dicen en "lanzar_ya" cuáles puedes lanzar.
2. Lanza A LA VEZ todas las subtareas que no dependan de otra con mcp__centro-agentes__delegar_varios (una entrada por subtarea, con su número en "subtarea" y una categoría corta: codigo, tests, docs, texto, analisis...). Deja trabajador y modelo vacíos salvo que la tarea lo exija (opencode para editar archivos). Si varias editan archivos, dales directorios distintos y que existan; si editan el mismo repo git, pasa aislar: true y cada agente trabaja en su copia (luego juntas con "copia.juntar"). Si el proyecto tiene tests, pasa en "verificar" el comando (p. ej. npm test) y el centro te da su resultado. Las que dependan de otras, lánzalas cuando termine aquello de lo que dependen.
3. Cada instrucción debe ser completa y autocontenida: el agente no ve esta conversación.
   Skills: si una subtarea es de un tipo para el que puede haber una skill (diseño, una plataforma, un formato de archivo, un framework, pruebas en navegador...), llama a mcp__centro-agentes__buscar_skills con unas palabras de la tarea y pasa los nombres que encajen en "skills" del encargo; el agente leerá su SKILL.md y la seguirá (las tareas con skills no van a Ollama, que no lee archivos). Usa tú también tus skills para verificar cuando ayuden (p. ej. un navegador para comprobar una web).
4. VERIFICA cada resultado de verdad y barato: lee los archivos que cambió, ejecuta los tests o el código, busca errores y alucinaciones. No confíes en lo que el agente dice que hizo.
5. Registra cada verificación con mcp__centro-agentes__registrar_auditoria (puntaje 1-10 honesto). Con 6 o más la subtarea queda hecha.
6. Si el puntaje es < 6, rehazla a partir de lo que está mal: vuelve a delegarla (sola o con otras en delegar_varios) diciendo qué falló exactamente, qué hay que corregir y, si sirve, el resultado anterior. registrar_auditoria te sugiere en "siguiente" otro modelo; úsalo. Máximo 2 reintentos por subtarea.
7. Cuando todo esté hecho, junta las piezas y entrega el resultado final con un informe corto: qué hizo cada agente, su puntaje, qué se rehízo y qué queda pendiente.

Nunca hagas tú la tarea completa salvo que todos los agentes fallen; en ese caso dilo.`

const bench = (m: Modelos) => `Modo COMPARACIÓN del centro de agentes. Envía la MISMA tarea a cada combinación trabajador/modelo con mcp__centro-agentes__delegar: ollama (${ver(m.ollama)}), opencode (${ver(m.opencode)}) y claude (${ver(m.claude)}). Si la tarea edita archivos, usa un directorio distinto para cada combinación (p. ej. bench-ollama-llama3.2, bench-claude-opus) para que no se pisen.
Luego audita los tres resultados con el mismo criterio (corrección, completitud, calidad, tiempo), registra cada uno con mcp__centro-agentes__registrar_auditoria y muestra una tabla: trabajador:modelo | puntaje | tiempo | tokens | comentario, y di cuál conviene para esta categoría.`

const ver = (l: string[]) => l.map(x => x || 'por defecto').join(', ')

const corto = (t: string, n = 60) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

const miles = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

// Una herramienta MCP devuelve texto (o bloques), no objetos: el resultado va como JSON.
const res = (x: unknown) => ({ result: JSON.stringify(x, null, 1) })

// El motor pone los argumentos de la herramienta en e; el harness de tests, en e.input.
const args = (e: object): unknown => (e as { input?: unknown }).input ?? e

const sinAnsi =(s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// claude -p --output-format json: un objeto con result, usage y modelUsage.
// claude -p --output-format stream-json: un evento por línea; el último, type "result", trae resultado y uso.
export function leerClaude(stdout: string): Salida {
  try {
    const lineas = stdout.split(/\r?\n/).filter(l => l.trim())
    const ultima = [...lineas].reverse().find(l => l.includes('"type":"result"')) ?? stdout
    const j = JSON.parse(ultima)
    const u = j.usage ?? {}
    const m = Object.values(j.modelUsage ?? {})[0] as { contextWindow?: number } | undefined
    return {
      texto: String(j.result ?? ''),
      tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
      ventana: m?.contextWindow,
      costo: j.total_cost_usd,
    }
  } catch {
    return { texto: stdout }
  }
}

// ollama run --verbose: estadísticas al final de stderr.
export function leerOllama(stdout: string, stderr: string): Salida {
  const s = sinAnsi(stderr)
  const num = (re: RegExp) => {
    const m = s.match(re)
    return m ? Number(m[1]) : undefined
  }
  return { texto: sinAnsi(stdout), tokensIn: num(/prompt eval count:\s*(\d+)/), tokensOut: num(/(?:^|\n)eval count:\s*(\d+)/) }
}

// opencode run --format json: un evento JSON por línea.
// hermes chat --format stream-json: eventos "text" mientras escribe y un "result" final con exit_code y tokens.
export function leerHermes(stdout: string): Salida & { exitCode?: number } {
  let texto = ''
  let fin: any
  for (const linea of stdout.split(/\r?\n/)) {
    if (!linea.trim()) continue
    try {
      const ev = JSON.parse(linea)
      if (ev.type === 'text') texto += ev.text ?? ''
      else if (ev.type === 'result') fin = ev
      else if (ev.type === 'error') texto += `\n[error] ${ev.message ?? ev.error ?? 'desconocido'}`
    } catch {}
  }
  const t = fin?.tokens ?? {}
  return {
    texto: String(fin?.text ?? texto).trim(),
    tokensIn: fin ? (t.input ?? 0) + (t.cache_read ?? 0) + (t.cache_write ?? 0) : undefined,
    tokensOut: fin ? (t.output ?? 0) : undefined,
    exitCode: fin?.exit_code,
  }
}

export function leerOpencode(stdout: string): Salida {
  let texto = ''
  let tokensIn = 0
  let tokensOut = 0
  let costo = 0
  for (const linea of stdout.split(/\r?\n/)) {
    if (!linea.trim()) continue
    let ev: any
    try {
      ev = JSON.parse(linea)
    } catch {
      texto += linea + '\n'
      continue
    }
    if (ev.type === 'text') texto += (ev.part?.text ?? '') + '\n'
    else if (ev.type === 'error') texto += `[error] ${ev.error?.data?.message ?? ev.error?.name ?? 'desconocido'}\n`
    else if (ev.type === 'step_finish') {
      const t = ev.part?.tokens ?? {}
      tokensIn += (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
      tokensOut += (t.output ?? 0) + (t.reasoning ?? 0)
      costo += ev.part?.cost ?? 0
    }
  }
  return { texto: texto.trim(), tokensIn, tokensOut, costo }
}

// --- Red: proxy de empresa, certificados y salida rápida cuando algo está bloqueado ---

// Lee el proxy de Windows de la salida de `reg query ...\Internet Settings`: "host:puerto" o "http=...;https=...".
export function proxyDeRegistro(salida: string): string | undefined {
  if (!/ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(salida)) return undefined
  const servidor = salida.match(/ProxyServer\s+REG_SZ\s+(\S+)/i)?.[1]
  if (!servidor) return undefined
  const https = servidor.match(/https=([^;]+)/i)?.[1] ?? servidor.match(/http=([^;]+)/i)?.[1] ?? (servidor.includes('=') ? undefined : servidor)
  if (!https) return undefined
  return /^\w+:\/\//.test(https) ? https : `http://${https}`
}

// Variables que entienden Node (claude, opencode), Go (ollama) y Python (hermes). El Ollama local nunca va por el proxy.
export function entornoDeRed(proxy?: string, ca?: string): Record<string, string> {
  const e: Record<string, string> = {}
  if (proxy) {
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) e[k] = proxy
    e.NO_PROXY = e.no_proxy = 'localhost,127.0.0.1,::1'
    e.NODE_USE_ENV_PROXY = '1'
  }
  if (ca) {
    e.NODE_EXTRA_CA_CERTS = ca
    e.REQUESTS_CA_BUNDLE = ca
  }
  return e
}

// Errores que indican que la red o el proxy bloquean, no que el modelo lo hizo mal.
const ERROR_DE_RED = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|tunneling socket|proxy authentication|\b407\b|self[- ]signed certificate|unable to (get|verify) (local )?issuer|UNABLE_TO_VERIFY|CERT_HAS_EXPIRED|certificate verify failed|network is unreachable|connection (refused|reset|timed out)|dial tcp|i\/o timeout|fetch failed|Connection error|Cannot connect to API|Unable to connect/i
export const esErrorDeRed = (texto: string) => ERROR_DE_RED.test(texto)
// Errores de cuenta (clave caducada o no válida): no se arreglan solos, hay que renovar la clave.
export const esErrorDeCuenta = (texto: string) =>
  /api key has expired|invalid api key|api key (is )?(invalid|revoked)|unauthorized|\b401\b|authentication failed|not authenticated|please log ?in/i.test(texto)

// Un host por agente para comprobar si se llega a él (cualquier código HTTP vale; 000 o 407 no).
const HOST_DE: Record<Trabajador, string> = {
  ollama: 'https://ollama.com',
  // Hermes usa los modelos de la nube de Ollama: llega a internet por el mismo sitio.
  hermes: 'https://ollama.com',
  aider: 'https://ollama.com',
  opencode: 'https://opencode.ai',
  claude: 'https://api.anthropic.com',
}
const SALUD_MS = 3 * 60_000
const salud = new Map<Trabajador, { ok: boolean; en: number }>()
let red: Record<string, string> = {}
let esperaInicialMs = 90_000

async function hayRed($: EngineInterface, t: Trabajador): Promise<boolean> {
  const previa = salud.get(t)
  if (previa && Date.now() - previa.en < SALUD_MS) return previa.ok
  const argv = ['curl.exe', '-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '6', ...(red.HTTPS_PROXY ? ['-x', red.HTTPS_PROXY] : []), HOST_DE[t]]
  const codigo = await $.process.run(argv, { timeoutMs: 10_000 }).then(r => r.stdout.trim()).catch(() => '')
  // shortcut: si curl.exe no existe (o falla al arrancar) se asume que hay red y decide el propio agente.
  const ok = codigo === '' ? true : !['000', '407'].includes(codigo)
  salud.set(t, { ok, en: Date.now() })
  return ok
}

// Hermes vive en tu carpeta de usuario (fuera de AppData, que Windows redirige para la app de Claude).
// Ruta completa: una app abierta antes de instalarlo no tiene aún su carpeta en el PATH.
async function hermesExe($: EngineInterface) {
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  return casa ? `${casa}\\.hermes\\bin\\hermes.exe` : 'hermes'
}
// Aider también vive fuera de AppData; habla con tu Ollama local (que reenvía los :cloud con tu sesión).
async function aiderExe($: EngineInterface) {
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  return casa ? `${casa}\\.aider\\bin\\aider.exe` : 'aider'
}
async function entornoHermes($: EngineInterface): Promise<Record<string, string>> {
  if (await $.env.get('HERMES_HOME').catch(() => undefined)) return {}
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  return casa ? { HERMES_HOME: `${casa}\\.hermes` } : {}
}

type Corrida = { exitCode: number | null; stdout: string; stderr: string; isStdoutTruncated: boolean; cortado?: boolean }

// Lanza el proceso y lee su salida a trozos, para que el panel muestre en vivo lo que escribe cada agente.
async function correrEnVivo(
  $: EngineInterface,
  argv: string[],
  init: { cwd?: string; stdin?: string; timeoutMs: number },
  alTrozo: (stdout: string) => void,
  alCortar: (cortar: (por: string) => void) => void = () => {},
): Promise<Corrida> {
  const env = { ...red, ...(await entornoHermes($)), OLLAMA_API_BASE: 'http://127.0.0.1:11434', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  const flujo = $.process.spawn({ argv, cwd: init.cwd, input: init.stdin, env: Object.keys(env).length ? env : undefined })
  let stdout = ''
  let stderr = ''
  let motivo = ''
  const cortar = (por: string) => {
    if (motivo) return
    motivo = por
    void flujo.return(undefined as never)
  }
  alCortar(cortar)
  const reloj = $.clock.after(init.timeoutMs, () => cortar('pasó el tiempo máximo'))
  // Si no escribe nada en un rato, suele ser la red o el proxy colgando la conexión: se corta para probar otro.
  let callado: { cancel(): void } | undefined = $.clock.after(esperaInicialMs, () => cortar(`sin respuesta en ${esperaInicialMs / 1000} s (¿red o proxy bloqueado?)`))
  try {
    for await (const { stream, text } of flujo) {
      callado?.cancel()
      callado = undefined
      if (stream === 'stdout') {
        stdout += text
        alTrozo(stdout)
        // opencode informa los errores del proveedor en su stdout JSON.
        if (text.includes('"type":"error"') && esErrorDeRed(text)) cortar('error de red')
      } else {
        stderr += text
        if (esErrorDeRed(text)) cortar('error de red')
      }
    }
  } finally {
    reloj.cancel()
    callado?.cancel()
  }
  const fin = motivo ? undefined : await flujo.result.catch(() => undefined)
  return { exitCode: motivo ? null : (fin?.code ?? null), stdout, stderr: motivo ? `${stderr}\n[cortado: ${motivo}]` : stderr, isStdoutTruncated: false, cortado: !!motivo }
}

async function ejecutar(
  $: EngineInterface,
  argv: string[],
  init: { cwd?: string; stdin?: string; timeoutMs: number },
  alTrozo: (stdout: string) => void = () => {},
  alCortar?: (cortar: (por: string) => void) => void,
): Promise<Corrida> {
  try {
    return await correrEnVivo($, argv, init, alTrozo, alCortar)
  } catch {
    // En Windows los CLIs de npm son shims .cmd: reintenta a través de cmd.
    const limpio = argv.map((a, i) => (i === 0 ? a : `"${a.replace(/"/g, "'").replace(/\r?\n/g, ' ')}"`))
    return await correrEnVivo($, ['cmd', '/d', '/s', '/c', limpio.join(' ')], init, alTrozo, alCortar)
  }
}

// Lo que se ve en la terminal de cada agente: su texto legible, no el JSON de sus eventos.
export function vistaDe(trabajador: Trabajador, stdout: string): string {
  if (trabajador === 'ollama') return sinAnsi(stdout)
  if (trabajador === 'opencode') return leerOpencode(stdout).texto
  if (trabajador === 'aider') return sinAnsi(stdout)
  if (trabajador === 'hermes')
    return stdout
      .split(/\r?\n/)
      .map(l => {
        try {
          const ev = JSON.parse(l)
          return ev.type === 'text' ? ev.text : ev.type === 'tool' || ev.tool || ev.name ? `\n› ${ev.tool ?? ev.name}\n` : ''
        } catch {
          return ''
        }
      })
      .join('')
  const partes: string[] = []
  for (const linea of stdout.split(/\r?\n/)) {
    try {
      const ev = JSON.parse(linea)
      if (ev.type === 'assistant')
        for (const b of ev.message?.content ?? []) {
          if (b.type === 'text') partes.push(b.text)
          else if (b.type === 'tool_use') partes.push(`› ${b.name}`)
        }
    } catch {}
  }
  return partes.join('\n')
}

const marcar = ($: EngineInterface, n: number | undefined, cambio: Partial<Plan['subtareas'][number]>) =>
  n === undefined
    ? Promise.resolve()
    : update($, plan, p => (p ? { ...p, subtareas: p.subtareas.map(s => (s.n === n ? { ...s, ...cambio } : s)) } : p))

// Arma todo lo que muestra el centro (panel y página web) a partir del estado.
// --- Historial entre sesiones y contador de ahorro (en el almacén permanente del plugin) ---

const HIST_KEY = 'historial'
const AHORRO_KEY = 'ahorro'
const MAX_HIST = 200
type Ahorro = { usd: number; gastoClaude: number; trabajos: number }

// Lo que habría costado con Claude Sonnet 5.5 ($2 entrada / $10 salida por millón; precios oficiales al 6-oct-2026).
// shortcut: cuenta toda la entrada a precio normal aunque parte fuera caché (más barata); sobreestima algo el ahorro.
export const costoComoClaude = (tokIn = 0, tokOut = 0) => (tokIn * 2 + tokOut * 10) / 1_000_000

async function guardarEnHistorial($: EngineInterface, t: Trabajo) {
  const h = ((await $.store.get(HIST_KEY)) ?? []) as Trabajo[]
  await $.store.set(HIST_KEY, [...h.filter(x => x.id !== t.id), { ...t, salida: undefined }].slice(-MAX_HIST))
  const a = ((await $.store.get(AHORRO_KEY)) ?? { usd: 0, gastoClaude: 0, trabajos: 0 }) as Ahorro
  const esClaude = t.trabajador.startsWith('claude:')
  await $.store.set(AHORRO_KEY, {
    usd: a.usd + (esClaude ? 0 : costoComoClaude(t.tokensIn, t.tokensOut)),
    gastoClaude: a.gastoClaude + (esClaude ? (t.costo ?? 0) : 0),
    trabajos: a.trabajos + 1,
  })
}

async function puntuarEnHistorial($: EngineInterface, id: string, puntaje: number) {
  const h = ((await $.store.get(HIST_KEY)) ?? []) as Trabajo[]
  if (h.some(x => x.id === id)) await $.store.set(HIST_KEY, h.map(x => (x.id === id ? { ...x, puntaje } : x)))
}

// En la web, las skills de un trabajo van delante de su texto con ✦.
export const conSkills = (skills: string[] | undefined, texto: string) => (skills?.length ? `✦ ${skills.join(', ')} · ${texto}` : texto)

async function armar($: EngineInterface, filasVista = 30) {
    const lista = (await read($, trabajos)) ?? []
    const p = await read($, plan)
    const ctx = (await $.session.usage()).context
    const ahora = Date.now()
    // El historial suma lo de sesiones anteriores (del almacén) a lo de esta.
    const deAntes = (((await $.store.get(HIST_KEY).catch(() => undefined)) ?? []) as Trabajo[]).filter(h => !lista.some(t => t.id === h.id))
    const total = ((await $.store.get(AHORRO_KEY).catch(() => undefined)) ?? { usd: 0, gastoClaude: 0, trabajos: 0 }) as Ahorro
    const ahorroSesion = lista.filter(t => !t.trabajador.startsWith('claude:')).reduce((a, t) => a + costoComoClaude(t.tokensIn, t.tokensOut), 0)

    const subs = p?.subtareas ?? []
    const hechas = subs.filter(s => s.estado === 'hecha').length
    const pct = subs.length ? Math.round((hechas / subs.length) * 100) : 0
    const terminados = lista.filter(t => t.ms !== undefined)
    // shortcut: estima lo que falta con el tiempo medio de los trabajos terminados; no sabe si una subtarea es más larga.
    const msMedio = terminados.length ? terminados.reduce((a, t) => a + (t.ms ?? 0), 0) / terminados.length : undefined
    const faltan = subs.length - hechas
    const tokIn = lista.reduce((a, t) => a + (t.tokensIn ?? 0), 0)
    const tokOut = lista.reduce((a, t) => a + (t.tokensOut ?? 0), 0)
    const costo = lista.reduce((a, t) => a + (t.costo ?? 0), 0)
    const seg = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`)
    const icono = { pendiente: '○', 'en curso': '●', hecha: '✓' } as const
    const tonoSub = { pendiente: 'lo', 'en curso': 'vino', hecha: 'hi' } as const
    const tonoTrab = (t: Trabajo): Tono =>
      t.estado === 'error' || (t.puntaje ?? 10) < 6 ? 'vino' : t.puntaje !== undefined ? 'hi' : 'mid'
    const corriendo = lista.filter(t => t.estado === 'corriendo')
    const room = Math.max(3, filasVista - subs.length - corriendo.length - 14)

    // Los mismos datos para la tarjeta SVG y para el texto de la terminal.
    const resumen: Fila[] = [
      ...(p
        ? [{ celdas: [`${hechas}/${subs.length} hechas (${pct}%)`, ...(faltan > 0 && msMedio !== undefined ? [`faltan ${faltan}, ≈${seg(faltan * msMedio)}`] : [])], tono: 'hi' as Tono }]
        : [{ celdas: ['Sin plan aún. Usa /centro <tarea>'], tono: 'lo' as Tono }]),
      {
        celdas: [
          'Director',
          ctx.tokens !== undefined
            ? `${miles(ctx.tokens)} / ${miles(ctx.window)} de contexto (${ctx.percent ?? 0}%)`
            : `ventana ${miles(ctx.window)}`,
          ...(ctx.tokens !== undefined ? [`quedan ${miles(Math.max(0, ctx.window - ctx.tokens))}`] : []),
        ],
        tono: 'mid',
      },
      { celdas: ['Trabajadores', `${miles(tokIn)} leídos`, `${miles(tokOut)} escritos`, ...(costo > 0 ? [`$${costo.toFixed(4)}`] : [])], tono: 'mid' },
      {
        celdas: [
          'Ahorro vs Claude Sonnet 5.5',
          `sesión $${ahorroSesion.toFixed(3)}`,
          `total $${total.usd.toFixed(2)} en ${total.trabajos} trabajos`,
          ...(total.gastoClaude > 0 ? [`gastado en Claude $${total.gastoClaude.toFixed(2)}`] : []),
        ],
        tono: 'vino',
      },
    ]
    const secciones: Seccion[] = [
      {
        titulo: 'Subtareas',
        columnas: [16, 52, 380, 560],
        filas: subs.map(s => ({
          celdas: [`${icono[s.estado]} ${s.n}`, corto(conSkills(encargos.get(s.n)?.skills, s.titulo), 40), corto(s.quien ?? '', 22), s.puntaje !== undefined ? `${s.puntaje}/10` : s.estado],
          tono: tonoSub[s.estado],
        })),
        vacio: 'sin subtareas',
      },
      {
        titulo: 'Trabajando ahora',
        columnas: [16, 250, 310],
        filas: corriendo.map(t => ({ celdas: [corto(`● ${t.trabajador}`, 29), seg(ahora - t.inicio), corto(conSkills(t.skills, t.tarea), 40)], tono: 'vino' })),
        vacio: 'nadie',
      },
      {
        titulo: 'Historial',
        columnas: [16, 250, 300, 400, 450],
        filas: [...deAntes, ...terminados].sort((a, b) => a.inicio - b.inicio).slice(-room).map(t => ({
          celdas: [
            // ◦ marca lo que viene de una sesión anterior.
            corto(`${t.estado === 'error' ? '✗' : deAntes.includes(t) ? '◦' : '✓'} ${t.trabajador}`, 29),
            seg(t.ms ?? 0),
            t.tokensIn !== undefined ? `${miles(t.tokensIn)}→${miles(t.tokensOut ?? 0)}` : '',
            t.puntaje !== undefined ? `${t.puntaje}/10` : '',
            corto(conSkills(t.skills, t.tarea), 22),
          ],
          tono: tonoTrab(t),
        })),
        vacio: 'vacío',
      },
    ]

    const bahias = TRABAJADORES.map(w => {
      const suyos = lista.filter(t => t.trabajador === w || t.trabajador.startsWith(`${w}:`))
      const activo = suyos.find(t => t.estado === 'corriendo') ?? suyos[suyos.length - 1]
      return {
        nombre: w,
        modelo: activo?.trabajador.slice(w.length + 1).split('/').pop() || undefined,
        tokens: suyos.reduce((a, t) => a + (t.tokensIn ?? 0) + (t.tokensOut ?? 0), 0),
        trabajando: suyos.some(t => t.estado === 'corriendo'),
      }
    })
    const lectura = `${subs.length ? `${hechas}/${subs.length} hechas · ` : ''}${miles(tokIn + tokOut)} tok`
    const titulo = p ? corto(p.objetivo, 48) : TITULO
    // Las cifras grandes de la cabecera de la web.
    const kpis = [
      { etiqueta: 'Progreso', valor: subs.length ? `${pct}%` : '—', nota: subs.length ? `${hechas} de ${subs.length} subtareas` : 'sin plan' },
      { etiqueta: 'Trabajando', valor: String(corriendo.length), nota: corriendo.length ? corto(corriendo.map(t => t.trabajador.split(':')[0]).join(', '), 40) : 'nadie ahora' },
      { etiqueta: 'Tokens', valor: miles(tokIn + tokOut), nota: `${miles(tokIn)} leídos · ${miles(tokOut)} escritos` },
      { etiqueta: 'Ahorro', valor: `$${ahorroSesion.toFixed(2)}`, nota: `total $${total.usd.toFixed(2)} vs Claude Sonnet` },
    ]
    return {
      p, pct, resumen, secciones, lectura, kpis,
      figuraSvg: figura({ bahias, subtareas: subs.map(s => s.estado), contexto: ctx.percent, titulo, lectura }),
      tableroSvg: tablero({
        titulo, lectura, progreso: p ? pct : undefined, resumen, secciones,
        terminales: corriendo.map(t => ({
          titulo: `${t.trabajador} · ${seg(ahora - t.inicio)}${t.skills?.length ? ` · ✦ ${t.skills.join(', ')}` : ''} · ${corto(t.tarea, 50)}`,
          lineas: colaDeLineas(t.salida || 'pensando…'),
        })),
      }),
      altFigura: `${TITULO}. ${lectura}. Trabajando: ${corriendo.map(t => t.trabajador).join(', ') || 'nadie'}.`,
      altTablero: `Detalles. ${resumen.map(f => f.celdas.join(', ')).join('. ')}.`,
    }
}

// Una ruta fija en tu carpeta de usuario: la misma para todas las sesiones y versiones del plugin, así la pestaña del navegador sirve siempre.
async function rutaWeb($: EngineInterface) {
  return `${await carpetaChat($)}/centro.html`
}
let web: { cancel(): void } | undefined

// --- Autoactualización: las sesiones cargan una copia instalada del plugin; si la carpeta del proyecto tiene una
// versión más nueva, se actualiza la copia para las sesiones que se abran después. ---

// shortcut: la carpeta del proyecto está fija; si el plugin se mueve o se comparte, pasarla a un ajuste.
const FUENTE = 'C:\\Users\\User\\Documents\\centro-agentes\\centro-agentes'

export function esMasNueva(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

async function autoactualizar($: EngineInterface) {
  // Sin la marca BOM: algunos editores de Windows la ponen y JSON.parse falla con ella.
  const version = (texto: string) => (JSON.parse(texto.replace(/^﻿/, '')) as { version?: string }).version ?? '0'
  const mia = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(version).catch(() => undefined)
  const fuente = await $.fs.read(`${FUENTE}\\.claude-plugin\\plugin.json`).then(version).catch(() => undefined)
  // Cargado directamente desde la carpeta del proyecto (desarrollo), o sin acceso a ella: nada que hacer.
  if (!mia || !fuente || !esMasNueva(fuente, mia)) return
  const ok = (r: { exitCode: number | null }) => r.exitCode === 0
  const mk = await $.process.run(['claude', 'plugin', 'marketplace', 'update', 'centro-mst'], { timeoutMs: 120_000 }).then(ok).catch(() => false)
  const up = mk && (await $.process.run(['claude', 'plugin', 'update', 'centro-agentes@centro-mst'], { timeoutMs: 120_000 }).then(ok).catch(() => false))
  $.ui.toast(up
    ? `${TITULO} actualizado de ${mia} a ${fuente}: reinicia esta sesión para usar lo nuevo.`
    : `${TITULO}: hay una versión nueva (${fuente}) pero no se pudo actualizar; ejecuta claude plugin update centro-agentes@centro-mst.`)
}

// --- Botones de la web: un servidor local recibe los clics y los anota; el centro los lee y los ejecuta ---

const PUERTO_WEB = 47321
const CANCELADO = 'cancelado desde la web'
// Cómo cortar cada trabajo en marcha, y el último encargo de cada subtarea para poder relanzarla.
const cortadores = new Map<string, (por: string) => void>()
const encargos = new Map<number, Encargo>()
let contexto: { modelos: Modelos; timeoutMs: number } | undefined
let leidoHasta = -1
let servidorLanzado = false

async function carpetaWeb($: EngineInterface) {
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  return casa ? `${casa}/.centro-agentes` : `${$.plugin.root}/web`
}

// --- Un centro por chat, guardado en disco para sobrevivir a un cierre o un fallo ---

// El id del chat (`$.session.id()`); se fija al empezar la sesión.
let SID = 'local'
// Para distinguir los chats en la web: la carpeta del proyecto y el nombre del chat
// (su título si Claude Code lo da; si no, el primer mensaje que escribes en él).
let carpetaProyecto = ''
let nombreChat = ''
export const etiquetaChat = (carpeta: string, nombre: string) => [carpeta, nombre].filter(Boolean).join(' · ') || 'chat'
// El primer mensaje de un chat como nombre: de /mst <tarea> se toma la tarea, no el protocolo que la acompaña.
export function nombreDesdeMensaje(texto: string): string {
  const tarea = texto.match(/TAREA:\n([\s\S]*)$/)?.[1] ?? texto
  return corto(tarea.replace(/\s+/g, ' ').trim(), 50)
}
async function carpetaChat($: EngineInterface) {
  return `${await carpetaWeb($)}/chats/${SID}`
}

type Guardado = { plan: Plan | null; trabajos: Trabajo[]; encargos: [number, Encargo][]; nombre?: string }
let ultimoGuardado = ''

// Guarda plan, trabajos y encargos del chat cuando cambian (se llama cada 2 s).
async function guardarEstado($: EngineInterface) {
  const estado: Guardado = { plan: (await read($, plan)) ?? null, trabajos: (await read($, trabajos)) ?? [], encargos: [...encargos], nombre: nombreChat }
  // La salida en vivo cambia a cada momento y no hace falta para recuperar el centro.
  const texto = JSON.stringify({ ...estado, trabajos: estado.trabajos.map(t => ({ ...t, salida: t.estado === 'corriendo' ? undefined : t.salida })) })
  if (texto === ultimoGuardado) return
  ultimoGuardado = texto
  await $.fs.write(`${await carpetaChat($)}/estado.json`, texto).catch(() => undefined)
}

// Lo que se recupera de un estado guardado: los trabajos que estaban en marcha quedan interrumpidos
// (sus procesos murieron con el chat) y sus subtareas vuelven a pendiente para poder relanzarlas.
export function recuperar(g: Guardado): Guardado & { interrumpidos: number } {
  const corriendo = g.trabajos.filter(t => t.estado === 'corriendo')
  const subs = new Set(corriendo.map(t => t.subtarea).filter((n): n is number => n !== undefined))
  return {
    plan: g.plan ? { ...g.plan, subtareas: g.plan.subtareas.map(s => (s.estado === 'en curso' && subs.has(s.n) ? { ...s, estado: 'pendiente' as const } : s)) } : null,
    trabajos: g.trabajos.map(t => (t.estado === 'corriendo' ? { ...t, estado: 'error' as const, salida: '[interrumpido: el chat se cerró mientras trabajaba]' } : t)),
    encargos: g.encargos,
    interrumpidos: corriendo.length,
  }
}

async function restaurarEstado($: EngineInterface) {
  const texto = await $.fs.read(`${await carpetaChat($)}/estado.json`).catch(() => '')
  if (!texto) return
  let g: Guardado
  try {
    g = JSON.parse(texto)
  } catch {
    return
  }
  if (g.nombre && !nombreChat) nombreChat = g.nombre
  // Tras una recarga del mod el estado sigue en memoria: solo se recupera si está vacío.
  if ((await read($, plan)) || ((await read($, trabajos)) ?? []).length) return
  const r = recuperar(g)
  await update($, plan, () => r.plan)
  await update($, trabajos, () => r.trabajos)
  for (const [n, e] of r.encargos) encargos.set(n, e)
  if (r.interrumpidos) $.ui.toast(`${TITULO}: recuperado. ${r.interrumpidos} trabajo(s) quedaron interrumpidos; relánzalos desde la web o con /mst.`)
}

// La clave vive en un archivo de tu carpeta de usuario: la misma para todas las sesiones y copias del plugin
// (cada copia tiene su propio almacén) y la que lee el servidor en cada petición.
async function claveWeb($: EngineInterface): Promise<string> {
  const archivo = `${await carpetaWeb($)}/clave.txt`
  const guardada = (await $.fs.read(archivo).catch(() => '')).trim()
  if (/^[a-z0-9]{16,}$/.test(guardada)) return guardada
  const nueva = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
  await $.fs.write(archivo, nueva)
  return nueva
}

async function urlWeb($: EngineInterface) {
  return `http://127.0.0.1:${PUERTO_WEB}/?t=${await claveWeb($)}&s=${SID}`
}

// Arranca el servidor para la vida de la sesión. Si otra sesión ya lo tiene, este sale enseguida y no pasa nada.
// Si el servidor se cae, se vuelve a intentar como mucho una vez por minuto.
let ultimoIntento = 0
async function lanzarServidor($: EngineInterface) {
  if (servidorLanzado || Date.now() - ultimoIntento < 60_000) return
  servidorLanzado = true
  ultimoIntento = Date.now()
  const dir = await carpetaWeb($)
  await claveWeb($)
  const argv = ['node', `${$.plugin.root}/web/servidor.js`, String(PUERTO_WEB), `${dir}/clave.txt`, `${dir}/chats`]
  void (async () => {
    try {
      for await (const _ of $.process.spawn({ argv })) {
        // Solo se espera a que termine; su salida no se usa.
      }
    } catch {}
    servidorLanzado = false
  })()
}

// Lee las órdenes nuevas de la web. Cada sesión ejecuta solo las de sus propios trabajos y subtareas.
async function atenderAcciones($: EngineInterface) {
  const texto = await $.fs.read(`${await carpetaChat($)}/acciones.jsonl`).catch(() => '')
  if (leidoHasta < 0) {
    // Al arrancar se ignoran las órdenes viejas.
    leidoHasta = texto.length
    return
  }
  const nuevas = texto.slice(leidoHasta)
  leidoHasta = texto.length
  for (const linea of nuevas.split('\n')) {
    let a: { tipo: string; id?: string; n?: number }
    try {
      a = JSON.parse(linea)
    } catch {
      continue
    }
    if (a.tipo === 'cancelar' && a.id) cortadores.get(a.id)?.(CANCELADO)
    if (a.tipo === 'relanzar' && a.n !== undefined && encargos.has(a.n) && contexto) void relanzar($, a.n)
  }
}

// Relanza una subtarea con su último encargo y pasa el resultado a Claude para que lo verifique.
async function relanzar($: EngineInterface, n: number) {
  const encargo = encargos.get(n)
  if (!encargo || !contexto) return
  $.ui.toast(`Relanzando la subtarea ${n} desde la web`)
  const r = await delegarUno($, contexto.modelos, encargo, contexto.timeoutMs)
  await $.prompt.submit({
    text: `[Centro de agentes MST] Relancé desde la web la subtarea ${n}. Verifica este resultado como de costumbre y registra su puntaje con registrar_auditoria:\n\n${JSON.stringify(r, null, 1)}`,
  })
}

// Aviso al terminar: mensaje en la app, sonido de Windows y (en la web) notificación del navegador.
let avisadoPara = ''
async function avisarSiTermino($: EngineInterface) {
  const p = await read($, plan)
  if (!p || !p.subtareas.length || p.subtareas.some(s => s.estado !== 'hecha') || avisadoPara === p.objetivo) return
  avisadoPara = p.objetivo
  $.ui.toast(`✓ Todo listo: ${p.objetivo}`)
  await escribirInforme($).catch(() => undefined)
  // Aviso al móvil (opcional): ntfy.sh reenvía el texto a quien esté suscrito a ese tema.
  if (temaNtfy)
    void $.process
      .run(['curl.exe', '-s', '--max-time', '10', ...(red.HTTPS_PROXY ? ['-x', red.HTTPS_PROXY] : []), '-H', 'Title: Centro de agentes MST', '-d', `Todo listo: ${corto(p.objetivo, 120)}`, `https://ntfy.sh/${temaNtfy}`], { timeoutMs: 15_000 })
      .catch(() => undefined)
  void $.process
    .run(['powershell', '-NoProfile', '-Command', '[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 900'], { timeoutMs: 10_000 })
    .catch(() => undefined)
}

// El informe final del chat en Markdown, junto a su página: chats/<id del chat>/informe.md.
async function escribirInforme($: EngineInterface) {
  const lista = (await read($, trabajos)) ?? []
  const ahorro = lista.filter(t => !t.trabajador.startsWith('claude:')).reduce((a, t) => a + costoComoClaude(t.tokensIn, t.tokensOut), 0)
  const ruta = `${await carpetaChat($)}/informe.md`
  await $.fs.write(ruta, informeMarkdown({ chat: etiquetaChat(carpetaProyecto, nombreChat), plan: await read($, plan), trabajos: lista, ahorro, fecha: new Date().toLocaleString('es') }))
  return ruta
}

// Cada chat escribe su propia página (chats/<id del chat>/centro.html): su plan, sus agentes y su contexto.
async function escribirWeb($: EngineInterface) {
  const a = await armar($, 60)
  const lista = (await read($, trabajos)) ?? []
  const subs = (await read($, plan))?.subtareas ?? []
  const controles = {
    clave: await claveWeb($),
    cancelables: lista.filter(t => t.estado === 'corriendo' && cortadores.has(t.id)).map(t => ({ id: t.id, titulo: `${t.trabajador} · ${corto(t.tarea, 40)}` })),
    relanzables: subs.filter(s => s.estado !== 'en curso' && encargos.has(s.n)).map(s => ({ n: s.n, titulo: corto(s.titulo, 40) })),
    listo: subs.length > 0 && subs.every(s => s.estado === 'hecha') ? (await read($, plan))!.objetivo : undefined,
  }
  const chat = etiquetaChat(carpetaProyecto, nombreChat)
  await $.fs.write(await rutaWeb($), pagina(a.figuraSvg, a.tableroSvg, `${chat} · ${a.lectura}`, 2, {
    ...controles, chat, kpis: a.kpis,
    agentes: contexto ? estadoAgentes(contexto.modelos, Date.now(), tokensClaude(lista)) : undefined,
    rendimiento: grafica(agregarRendimiento(((await $.store.get(STORE_KEY)) ?? {}) as Puntajes)),
  }))
}

// Abre la página en el navegador predeterminado: servida por el servidor local (con botones). explorer no da un código útil.
async function abrirNavegador($: EngineInterface) {
  await $.process.run(['explorer', await urlWeb($)]).catch(() => undefined)
}

// Mantiene la página al día cada 2 s mientras la vista web está encendida, y atiende los botones.
function encenderWeb($: EngineInterface) {
  if (web) return
  void lanzarServidor($)
  void escribirWeb($)
  web = $.clock.every(2000, async () => {
    await lanzarServidor($)
    await atenderAcciones($)
    await escribirWeb($)
  })
}

export type Candidato = { trabajador: Trabajador; modelo: string }
type Intento = { id: string; ok: boolean; ms: number; s: Salida; sinRed: boolean }
// El Ollama local no necesita internet: es el último recurso cuando la red está bloqueada.
const esLocal = (c: Candidato) => c.trabajador === 'ollama' && !c.modelo.endsWith('cloud')

// Cuántas veces cambia de modelo solo cuando uno falla, y cuánto tiempo se salta un modelo que falló.
const MAX_CAMBIOS = 2
const CAIDO_MS = 10 * 60_000
const DIA_MS = 24 * 60 * 60_000
const HORA_MS = 60 * 60_000
const caidos = new Map<string, number>()
// Por qué se apartó un agente entero (clave caducada, plan de pago): se enseña en la web.
const motivoAgente = new Map<Trabajador, string>()
// Tope de tokens de Claude headless por chat (0 = sin tope) y tema de ntfy.sh para avisar al móvil ('' = no avisar).
let presupuestoClaude = 0
let temaNtfy = ''
const tokensClaude = (l: Trabajo[]) => l.filter(t => t.trabajador.startsWith('claude')).reduce((a, t) => a + (t.tokensIn ?? 0) + (t.tokensOut ?? 0), 0)
const hora = (ms: number) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

// Una fila por agente para la web: disponible, o apartado y hasta cuándo.
export function estadoAgentes(modelos: Modelos, ahora: number, usadosClaude: number) {
  const vuelve = (t: Trabajador, m: string) => (caidos.get(clave(t, m)) ?? -Infinity) + CAIDO_MS
  return TRABAJADORES.map(t => {
    const hasta = Math.min(...modelos[t].map(m => vuelve(t, m)))
    if (salud.get(t)?.ok === false) return { nombre: t, ok: false, nota: 'sin red' }
    if (hasta > ahora) return { nombre: t, ok: false, nota: `${motivoAgente.get(t) ?? 'falló'} · vuelve ${hora(hasta)}` }
    if (t === 'claude' && presupuestoClaude && usadosClaude >= presupuestoClaude) return { nombre: t, ok: false, nota: 'presupuesto agotado' }
    const libres = modelos[t].filter(m => vuelve(t, m) <= ahora).length
    const extra = t === 'claude' && presupuestoClaude ? ` · ${miles(usadosClaude)}/${miles(presupuestoClaude)} tok` : ''
    return { nombre: t, ok: true, nota: `${libres}/${modelos[t].length} modelos${extra}` }
  })
}
const caidosAhora = () => new Set([...caidos].filter(([, t]) => Date.now() - t < CAIDO_MS).map(([k]) => k))

// Orden por defecto entre trabajadores: primero los gratis en la nube, Claude al final.
const todosLosCandidatos = (m: Modelos): Candidato[] =>
  (['opencode', 'ollama', 'hermes', 'aider', 'claude'] as const).flatMap(t => m[t].map(modelo => ({ trabajador: t, modelo })))

// Un modelo sin probar vale PREVIO: gana a uno que rinde mal y pierde contra uno bueno, así el centro explora solo.
const PREVIO = 6.5
// Claude headless gasta del plan de Claude: solo gana si rinde claramente mejor que los gratis.
const RECARGO_CLAUDE = 1.5
export function ordenar(tabla: Puntajes, categoria: string, candidatos: Candidato[], excluidos: Set<string>): Candidato[] {
  const fila = tabla[categoria] ?? {}
  const nota = (c: Candidato) => {
    const celda = fila[clave(c.trabajador, c.modelo)]
    return (celda && celda.n > 0 ? celda.suma / celda.n : PREVIO) - (c.trabajador === 'claude' ? RECARGO_CLAUDE : 0)
  }
  return candidatos
    .map((c, i) => ({ c, i, n: nota(c) }))
    .filter(x => !excluidos.has(clave(x.c.trabajador, x.c.modelo)))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(x => x.c)
}

// Ejecuta la tarea con un trabajador y modelo, y deja su fila en el historial.
async function intentar(
  $: EngineInterface,
  c: Candidato,
  input: { categoria: string; tarea: string; subtarea?: number; cwd?: string; skills?: string[] },
  timeoutMs: number,
): Promise<Intento> {
  const quien = clave(c.trabajador, c.modelo)
  const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`
  const t0 = Date.now()
  const trabajo: Trabajo = { id, trabajador: quien, categoria: input.categoria, tarea: corto(input.tarea), estado: 'corriendo', inicio: t0, subtarea: input.subtarea, skills: input.skills?.length ? input.skills : undefined }
  await update($, trabajos, l => [...(l ?? []), trabajo].slice(-50))
  await marcar($, input.subtarea, { estado: 'en curso', quien })
  $.ui.status(`⚙ ${quien}: ${corto(input.tarea, 30)}`)
  // Publica cada 1,5 s lo último que escribió el agente: el panel lo muestra como su terminal.
  let crudo = ''
  const latido = $.clock.every(1500, () =>
    update($, trabajos, l => (l ?? []).map(t => (t.id === id ? { ...t, salida: vistaDe(c.trabajador, crudo).slice(-1500) } : t))),
  )

  let argv: string[]
  let stdin: string | undefined
  if (c.trabajador === 'ollama') {
    // --nowordwrap: sin él ollama corta líneas con códigos de terminal en medio del texto.
    // --hidethinking: los modelos que razonan escribirían su razonamiento mezclado con la respuesta.
    argv = ['ollama', 'run', '--verbose', '--nowordwrap', '--hidethinking', c.modelo]
    stdin = input.tarea
  } else if (c.trabajador === 'opencode') {
    argv = ['opencode', 'run', '--format', 'json', ...(c.modelo ? ['-m', c.modelo] : []), input.tarea]
  } else if (c.trabajador === 'hermes') {
    // "proveedor/modelo": el proveedor es el de config.yaml (ollama-local = tu Ollama con sesión iniciada, sin clave).
    const corte = c.modelo.indexOf('/')
    const [proveedor, modelo] = corte > 0 ? [c.modelo.slice(0, corte), c.modelo.slice(corte + 1)] : ['auto', c.modelo]
    argv = [await hermesExe($), 'chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--yolo', '--provider', proveedor, '-m', modelo]
    stdin = input.tarea
  } else if (c.trabajador === 'aider') {
    // --no-git: no hace commits en tu repo; --yes-always: no se queda esperando confirmaciones.
    // Aider solo edita los archivos que recibe en la línea de comandos: se le pasan los que nombra la tarea y existen.
    const nombrados = [...new Set(input.tarea.match(/[\w./\\-]+\.[A-Za-z]\w{0,5}\b/g) ?? [])]
    const archivos = input.cwd ? (await Promise.all(nombrados.map(async a => ((await $.fs.exists(`${input.cwd}/${a}`).catch(() => false)) ? a : '')))).filter(Boolean) : []
    argv = [await aiderExe($), ...archivos, '--model', c.modelo, '--message', input.tarea,'--yes-always', '--no-git', '--no-pretty', '--no-stream', '--no-check-update', '--no-show-model-warnings', '--no-analytics', '--input-history-file', 'NUL', '--chat-history-file', 'NUL']
  } else {
    // La tarea va por stdin: como argumento, el shim .cmd de Windows la corta en el primer salto de línea.
    argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--model', c.modelo]
    stdin = input.tarea
  }

  let s: Salida
  let ok = false
  try {
    const r = await ejecutar($, argv, { cwd: input.cwd, stdin, timeoutMs }, out => (crudo = out), cortar => cortadores.set(id, cortar))
    s =
      c.trabajador === 'ollama' ? leerOllama(r.stdout, r.stderr)
      : c.trabajador === 'opencode' ? leerOpencode(r.stdout)
      : c.trabajador === 'hermes' ? leerHermes(r.stdout)
      : c.trabajador === 'aider' ? leerAider(r.stdout)
      : leerClaude(r.stdout)
    // opencode puede salir con 0 aunque el proveedor haya devuelto un error y nada de texto.
    ok = r.exitCode === 0 && !/^\[error\]/.test(s.texto.trim()) && ((c.trabajador !== 'hermes' && c.trabajador !== 'aider') || !!s.texto)
    // ollama escribe sus estadísticas en stderr y hermes su session_id: solo se enseñan si algo falló.
    const err = c.trabajador === 'ollama' || c.trabajador === 'hermes' || c.trabajador === 'aider' ? (ok ? '' : sinAnsi(r.stderr).trim()) : r.stderr
    s.texto = `${s.texto}${err ? `\n[stderr]\n${err.slice(-3000)}` : ''}`.trim()
    if (r.isStdoutTruncated) s.texto += '\n[salida truncada]'
  } catch (err) {
    s = { texto: `No se pudo ejecutar ${argv[0]}: ${String(err)}` }
  } finally {
    latido.cancel()
  }
  const ms = Date.now() - t0
  await update($, trabajos, l =>
    (l ?? []).map(t => (t.id === id ? { ...t, estado: ok ? 'listo' : 'error', ms, tokensIn: s.tokensIn, tokensOut: s.tokensOut, ventana: s.ventana, costo: s.costo, salida: s.texto.slice(-1500) } : t)),
  )
  $.ui.status(undefined)
  cortadores.delete(id)
  const hecho = ((await read($, trabajos)) ?? []).find(t => t.id === id)
  if (hecho) await guardarEnHistorial($, hecho).catch(() => undefined)
  return { id, ok, ms, s, sinRed: !ok && (esErrorDeRed(s.texto) || /\[cortado: sin respuesta/.test(s.texto)) }
}

// Dónde está el SKILL.md de una skill: las tuyas en ~/.claude/skills/<nombre>; las de un plugin ("plugin:skill")
// en la caché de plugins. Así cualquier agente que lea archivos puede seguirla.
// Las rutas usan "/": Windows las acepta y así no hay barras invertidas que escapar.
export async function rutaSkill($: EngineInterface, nombre: string): Promise<string | undefined> {
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  if (!casa || !/^[\w.:-]+$/.test(nombre)) return undefined
  const [plugin, skill] = nombre.includes(':') ? nombre.split(':', 2) : [undefined, nombre]
  if (!plugin) {
    const r = `${casa}/.claude/skills/${skill}/SKILL.md`
    return (await $.fs.exists(r).catch(() => false)) ? r : undefined
  }
  const cache = `${casa}/.claude/plugins/cache`
  for (const mk of await $.fs.list(cache).catch(() => [])) {
    if (mk.kind !== 'dir') continue
    const dir = `${cache}/${mk.name}/${plugin}`
    for (const v of await $.fs.list(dir).catch(() => [])) {
      const r = `${dir}/${v.name}/skills/${skill}/SKILL.md`
      if (v.kind === 'dir' && (await $.fs.exists(r).catch(() => false))) return r
    }
  }
  return undefined
}

export type SkillInfo = { nombre: string; descripcion: string; ruta: string }

// Nombre y descripción del encabezado (frontmatter) de un SKILL.md.
export function leerFrontmatter(texto: string): { name?: string; description?: string } {
  const bloque = texto.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const campo = (k: string) => {
    const m = bloque.match(new RegExp(`^${k}:[ \\t]*(.*)$((?:\\r?\\n[ \\t]+.*)*)`, 'm'))
    if (!m) return undefined
    // Texto de varias líneas en YAML (">-", "|"): las líneas sangradas de debajo, unidas.
    const valor = /^[>|][+-]?$/.test(m[1].trim()) ? m[2].split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(' ') : m[1]
    return valor.trim().replace(/^["']|["']$/g, '')
  }
  return { name: campo('name'), description: campo('description') }
}

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Ordena las skills por cuántas palabras de la consulta aparecen en su nombre (vale más) y descripción.
export function buscarSkills(lista: SkillInfo[], consulta: string, max = 20): SkillInfo[] {
  // Palabras de 3 letras o más; las cortas solo si llevan un número ("3d"): "de" o "en" aparecen en casi todo.
  const palabras = sinTildes(consulta).split(/[^a-z0-9]+/).filter(p => p.length > 2 || (p.length === 2 && /\d/.test(p)))
  if (!palabras.length) return lista.slice(0, max)
  const nota = (sk: SkillInfo) => {
    const nombre = sinTildes(sk.nombre)
    const todo = `${nombre} ${sinTildes(sk.descripcion)}`
    return palabras.reduce((a, p) => a + (nombre.includes(p) ? 3 : todo.includes(p) ? 1 : 0), 0)
  }
  return lista.map(sk => ({ sk, n: nota(sk) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, max).map(x => x.sk)
}

// Todas las skills instaladas: las tuyas (~/.claude/skills) y las de los plugins (la versión más reciente de cada uno).
async function listarSkills($: EngineInterface): Promise<SkillInfo[]> {
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  if (!casa) return []
  const dirs = (p: string) => $.fs.list(p).then(l => l.filter(e => e.kind === 'dir').map(e => e.name)).catch(() => [] as string[])
  const leer = async (nombre: string, ruta: string): Promise<SkillInfo | undefined> => {
    const fm = leerFrontmatter(await $.fs.read(ruta).catch(() => ''))
    return fm.description ? { nombre, descripcion: corto(fm.description, 220), ruta } : undefined
  }
  const propias = `${casa}/.claude/skills`
  const tareas: Promise<SkillInfo | undefined>[] = (await dirs(propias)).map(d => leer(d, `${propias}/${d}/SKILL.md`))
  const cache = `${casa}/.claude/plugins/cache`
  for (const mk of await dirs(cache))
    for (const plugin of await dirs(`${cache}/${mk}`)) {
      const versiones = (await dirs(`${cache}/${mk}/${plugin}`)).sort()
      const v = versiones[versiones.length - 1]
      if (!v) continue
      const base = `${cache}/${mk}/${plugin}/${v}/skills`
      for (const sk of await dirs(base)) tareas.push(leer(`${plugin}:${sk}`, `${base}/${sk}/SKILL.md`))
    }
  return (await Promise.all(tareas)).filter((x): x is SkillInfo => !!x)
}

async function instruccionSkills($: EngineInterface, skills: string[]): Promise<string> {
  const lineas = await Promise.all(skills.map(async n => {
    const ruta = await rutaSkill($, n)
    return `- ${n}${ruta ? `: lee ${ruta}` : ''}`
  }))
  return `\n\nUsa estas skills: antes de empezar, lee el SKILL.md de cada una y sigue sus instrucciones.\n${lineas.join('\n')}`
}

type Encargo = {
  trabajador?: Trabajador | 'auto'; modelo?: string; categoria: string; tarea: string; subtarea?: number; cwd?: string; skills?: string[]
  /** Trabajar en una copia aislada (git worktree) del repo de cwd, en su propia rama */
  aislar?: boolean
  /** Comando que comprueba el resultado (p. ej. npm test), ejecutado en la carpeta donde trabajó el agente */
  verificar?: string
}

const git = ($: EngineInterface, cwd: string, a: string[]) => $.process.run(['git', '-C', cwd, ...a], { timeoutMs: 60_000 })

// Una copia del repo de `cwd` para un agente: worktree en ~/.centro-agentes/copias/<chat>/ con su rama mst/<nombre>.
// shortcut: parte del último commit; lo que tengas sin commitear en tu carpeta no está en la copia.
async function crearCopia($: EngineInterface, cwd: string, nombre: string) {
  const raiz = await git($, cwd, ['rev-parse', '--show-toplevel']).catch(() => undefined)
  if (!raiz || raiz.exitCode !== 0) return { error: 'cwd no es un repositorio git: el agente trabaja en la carpeta tal cual' }
  const repo = raiz.stdout.trim()
  const carpeta = `${await carpetaWeb($)}/copias/${SID}/${nombre}`
  const rama = `mst/${nombre}`
  const r = await git($, repo, ['worktree', 'add', '-b', rama, carpeta, 'HEAD'])
  return r.exitCode === 0 ? { repo, carpeta, rama } : { error: `git worktree falló: ${corto(r.stderr.trim(), 200)}` }
}

// Guarda en su rama lo que hizo el agente en la copia, para que el jefe lo junte con un merge.
async function cerrarCopia($: EngineInterface, c: { repo: string; carpeta: string; rama: string }, mensaje: string) {
  await git($, c.carpeta, ['add', '-A'])
  const commit = await git($, c.carpeta, ['commit', '-q', '-m', mensaje])
  const stat = await git($, c.carpeta, ['diff', '--stat', 'HEAD~1', 'HEAD'])
  return {
    carpeta: c.carpeta,
    rama: c.rama,
    cambios: commit.exitCode === 0 ? stat.stdout.trim().slice(-2000) : 'sin cambios (o no se pudo hacer commit)',
    juntar: `git -C "${c.repo}" merge ${c.rama} && git -C "${c.repo}" worktree remove "${c.carpeta}"`,
  }
}

// Ejecuta el comando de verificación del jefe (tests, build...) donde trabajó el agente.
async function verificarEn($: EngineInterface, cwd: string | undefined, comando: string) {
  const r = await $.process.run(['cmd', '/d', '/s', '/c', comando], { cwd, timeoutMs: 5 * 60_000 }).catch(err => ({ exitCode: null, stdout: '', stderr: String(err) }))
  return { comando, ok: r.exitCode === 0, codigo: r.exitCode, salida: sinAnsi(`${r.stdout}\n${r.stderr}`).trim().slice(-2500) }
}
// Modelos con un trabajo en marcha: un encargo nuevo prefiere otro libre, para repartir el trabajo.
const ocupados = new Map<string, number>()

// Elige el mejor modelo para el encargo, lo ejecuta y, si falla, cambia solo al siguiente.
async function delegarUno($: EngineInterface, modelos: Modelos, input: Encargo, timeoutMs: number) {
  const categoria = String(input.categoria ?? '').toLowerCase().trim() || 'general'
  if (input.subtarea !== undefined) {
    const faltan = bloqueos((await read($, plan))?.subtareas ?? [], input.subtarea)
    if (faltan.length) return { subtarea: input.subtarea, error: `La subtarea ${input.subtarea} espera a ${faltan.join(', ')}: lánzala cuando estén hechas.` }
  }
  // Se recuerda el encargo de cada subtarea para poder relanzarlo desde la web.
  if (input.subtarea !== undefined) encargos.set(input.subtarea, { ...input })
  const pedido = input.trabajador && input.trabajador !== 'auto' ? input.trabajador : undefined
  if (pedido && !modelos[pedido]) return { error: `Trabajador desconocido: ${pedido}` }
  // Una tarea con skills necesita un agente que lea archivos: Ollama solo es un modelo, sin herramientas.
  const conSkills = (input.skills ?? []).filter(Boolean)
  let todos = todosLosCandidatos(modelos).filter(c => !conSkills.length || (c.trabajador !== 'ollama' && c.trabajador !== 'aider'))
  // Con copia aislada o verificación se esperan cambios en archivos, y Ollama solo devuelve texto.
  if (input.aislar || input.verificar?.trim()) todos = todos.filter(c => c.trabajador !== 'ollama')
  if (conSkills.length) input = { ...input, tarea: input.tarea + (await instruccionSkills($, conSkills)) }
  // Algunos modelos (Hermes sobre todo) contestan en inglés si no se les dice.
  input = { ...input, tarea: `${input.tarea}\n\nResponde siempre en español.` }
  // Con el presupuesto de Claude gastado en este chat, Claude headless deja de ser candidato.
  if (presupuestoClaude && tokensClaude((await read($, trabajos)) ?? []) >= presupuestoClaude) {
    if (pedido === 'claude') $.ui.toast(`Presupuesto de Claude agotado (${miles(presupuestoClaude)} tokens): el centro sigue con los agentes gratis.`)
    todos = todos.filter(c => c.trabajador !== 'claude')
  }
  const candidatos = todos.filter(c => !pedido || c.trabajador === pedido)
  const modeloPedido = input.modelo?.trim()
  // Lista cerrada: el modelo acaba en la línea de comandos.
  if (modeloPedido && !candidatos.some(c => c.modelo === modeloPedido))
    return { error: `Modelo no permitido: ${modeloPedido}. Usa uno de: ${candidatos.map(c => clave(c.trabajador, c.modelo)).join(', ')}` }

  // Antes de elegir, salta los agentes a los que no se llega (proxy, firewall, sin internet).
  const conRed = new Map(await Promise.all(TRABAJADORES.map(async t => [t, await hayRed($, t)] as const)))
  const alcanzable = (c: Candidato) => esLocal(c) || conRed.get(c.trabajador) !== false
  const tabla = ((await $.store.get(STORE_KEY)) ?? {}) as Puntajes
  const libre = (c: Candidato) => !ocupados.get(clave(c.trabajador, c.modelo))
  const preparar = (l: Candidato[]) => {
    const o = ordenar(tabla, categoria, l, caidosAhora()).filter(alcanzable)
    return [...o.filter(libre), ...o.filter(c => !libre(c))]
  }
  // Primero el agente pedido; si no puede, se pasa a otro que sí funcione.
  let cola = [...preparar(candidatos), ...(pedido ? preparar(todos.filter(c => c.trabajador !== pedido)) : [])]
  if (modeloPedido) cola = [...cola.filter(c => c.modelo === modeloPedido), ...cola.filter(c => c.modelo !== modeloPedido)]

  // Copia aislada: varios agentes pueden editar el mismo repo a la vez sin pisarse.
  const copia = input.aislar && input.cwd ? await crearCopia($, input.cwd, `s${input.subtarea ?? 'x'}-${Date.now().toString(36)}`) : undefined
  if (copia && 'carpeta' in copia) input = { ...input, cwd: copia.carpeta }

  // Si un modelo falla (sin sesión, sin cuota, caído), se pasa solo al siguiente de la cola.
  const cambios: string[] = []
  let r: Intento | undefined
  let elegido = cola[0]
  for (const c of cola) {
    if (cambios.length > MAX_CAMBIOS) break
    const k = clave(c.trabajador, c.modelo)
    if (caidosAhora().has(k)) continue
    if (!esLocal(c) && salud.get(c.trabajador)?.ok === false) continue
    elegido = c
    ocupados.set(k, (ocupados.get(k) ?? 0) + 1)
    try {
      r = await intentar($, c, { ...input, categoria }, timeoutMs)
    } finally {
      ocupados.set(k, (ocupados.get(k) ?? 1) - 1)
    }
    if (r.ok) break
    // Cancelado a mano desde la web: no se prueba otro modelo.
    if (r.s.texto.includes(`[cortado: ${CANCELADO}]`)) break
    // Sin red, fallarán todos los modelos en la nube de ese agente: se aparta el agente entero un rato.
    if (r.sinRed && !esLocal(c)) salud.set(c.trabajador, { ok: false, en: Date.now() })
    // Clave caducada o no válida: todos los modelos de ese agente fallarán igual; se aparta una hora y se avisa.
    if (esErrorDeCuenta(r.s.texto)) {
      for (const m of modelos[c.trabajador]) caidos.set(clave(c.trabajador, m), Date.now() + HORA_MS - CAIDO_MS)
      motivoAgente.set(c.trabajador, 'clave caducada')
      $.ui.toast(`${c.trabajador}: su clave no vale (caducada o no válida). Renuévala; mientras, el centro usa los demás agentes.`)
    }
    // Un modelo que pide plan de pago no se arregla en minutos: se aparta un día entero.
    const dePago = /free plan|upgrade|pro is \$/i.test(r.s.texto)
    caidos.set(k, dePago ? Date.now() + DIA_MS - CAIDO_MS : Date.now())
    if (!esErrorDeCuenta(r.s.texto)) motivoAgente.set(c.trabajador, dePago ? 'plan de pago' : 'falló')
    // Sin sesión en Ollama fallarán todos sus :cloud: se apartan juntos para llegar antes al modelo local.
    if (c.trabajador === 'ollama' && /signed in/i.test(r.s.texto))
      for (const m of modelos.ollama.filter(x => x.endsWith('cloud'))) caidos.set(clave('ollama', m), Date.now())
    cambios.push(`${k} falló: ${corto(r.s.texto.replace(/\s+/g, ' '), 120)}`)
  }
  if (!r) return { error: 'Todos los modelos posibles fallaron hace poco. Prueba otro trabajador o espera unos minutos.' }
  if (!r.ok) await marcar($, input.subtarea, { estado: 'pendiente' })
  const quienFue = clave(elegido.trabajador, elegido.modelo)
  const aislado = copia && 'carpeta' in copia ? await cerrarCopia($, copia, `mst: subtarea ${input.subtarea ?? '-'} (${quienFue})`) : copia
  const verificacion = r.ok && input.verificar?.trim() ? await verificarEn($, input.cwd, input.verificar.trim()) : undefined

  return {
    id: r.id,
    subtarea: input.subtarea,
    trabajador: quienFue,
    exito: r.ok,
    segundos: Math.round(r.ms / 1000),
    tokens: { entrada: r.s.tokensIn, salida: r.s.tokensOut },
    ...(cambios.length ? { cambios } : {}),
    ...(aislado ? { copia: aislado } : {}),
    ...(verificacion ? { verificacion } : {}),
    salida: r.s.texto.slice(0, 60_000) || '(sin salida)',
    aviso: verificacion
      ? `Verificación ${verificacion.ok ? 'superada' : 'FALLIDA'} con "${verificacion.comando}". Revisa y llama a registrar_auditoria con este id.`
      : 'Resultado sin verificar. Audítalo y llama a registrar_auditoria con este id.',
  }
}

export const register: Register = (on, options) => {
  const opt = (options ?? {}) as Opciones
  const modelos: Modelos = {
    // Los :cloud que entran en el plan Free de Ollama (probados con sesión iniciada); llama3.2:3b es local y queda de respaldo.
    ollama: lista(opt.ollamaModels, ['gpt-oss:120b-cloud', 'beam:cloud', 'gemma4:31b-cloud', 'nemotron-3-super:cloud', 'gpt-oss:20b-cloud', 'llama3.2:3b']),
    // El modelo por defecto de OpenCode de este equipo (gemini) no tiene cuota: usa uno gratuito.
    opencode: lista(opt.opencodeModels, ['opencode/glm-5.3-flash-free', 'opencode/beam-free', 'opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle', 'opencode/mimo-v2.6-flash-free', 'opencode/longcat-2.5-preview-free', 'opencode/space-bunny-free']),
    // proveedor/modelo de Hermes; ollama-local está en ~/.hermes/config.yaml y apunta a tu Ollama (gratis, sin clave).
    hermes: lista(opt.hermesModels, ['ollama-local/gpt-oss:120b-cloud', 'ollama-local/beam:cloud', 'ollama-local/gemma4:31b-cloud', 'ollama-local/gpt-oss:20b-cloud']),
    // Aider llama a Ollama con el prefijo ollama_chat/ (el de chat, que respeta el formato de edición).
    aider: lista(opt.aiderModels, ['ollama_chat/gpt-oss:120b-cloud', 'ollama_chat/beam:cloud', 'ollama_chat/gemma4:31b-cloud']),
    claude: lista(opt.claudeModels, ['haiku', 'sonnet', 'opus']),
  }
  const timeoutMs = Math.min(10, Math.max(1, Number(opt.timeoutMin ?? 8))) * 60_000
  contexto = { modelos, timeoutMs }
  presupuestoClaude = Math.max(0, Number(opt.presupuestoClaudeTokens ?? 0)) || 0
  const tema = String(opt.ntfyTema ?? '').trim()
  temaNtfy = temaNtfyValido(tema) ? tema : ''
  esperaInicialMs = Math.min(600, Math.max(15, Number(opt.esperaInicialSeg ?? 90))) * 1000

  on('session.start', async ($, e, next) => {
    // Cada chat tiene su centro: su id nombra su carpeta. Se recupera lo guardado y se sigue guardando cada 2 s.
    SID = ((await $.session.id().catch(() => 'local')) || 'local').replace(/[^\w-]/g, '')
    carpetaProyecto = e.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
    await restaurarEstado($).catch(() => undefined)
    $.clock.every(2000, () => guardarEstado($))
    // Proxy: el de los ajustes, si no el que ya trae el entorno, si no el de Windows (el que usa el navegador).
    const proxyEntorno = (await $.env.get('HTTPS_PROXY').catch(() => undefined)) ?? (await $.env.get('https_proxy').catch(() => undefined))
    const proxyWindows = opt.proxy || proxyEntorno
      ? undefined
      : proxyDeRegistro(
          await $.process
            .run(['reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { timeoutMs: 5000 })
            .then(r => r.stdout)
            .catch(() => ''),
        )
    red = entornoDeRed(opt.proxy?.trim() || proxyEntorno || proxyWindows, opt.certificadoCA?.trim() || undefined)
    salud.clear()
    // Se espera a que termine: en segundo plano, una sesión corta se cerraría antes de acabar de actualizar.
    // Solo tarda cuando hay versión nueva; si no, son dos lecturas de archivo.
    await autoactualizar($).catch(() => undefined)
    await $.command.register({ name: 'mst', description: 'Centro de agentes MST: abre el panel y la web; con una tarea, Claude la reparte entre los agentes y la verifica' })
    await $.command.register({ name: 'centro', description: 'Reparte una tarea entre Ollama/OpenCode/Claude (y sus modelos) y Claude la audita' })
    await $.command.register({ name: 'centro-bench', description: 'Manda la misma tarea a cada trabajador/modelo y compara' })
    await $.command.register({ name: 'centro-panel', description: 'Abre el panel del centro de agentes' })
    await $.command.register({ name: 'centro-web', description: 'Abre el centro de agentes en el navegador (se actualiza solo)' })
    await $.command.register({ name: 'mst-informe', description: 'Escribe el informe final de este chat (Markdown) y lo abre' })
    await $.command.register({ name: 'centro-reset', description: 'Borra los puntajes guardados' })
    // Al empezar cualquier sesión: el panel a la vista y la página web al día; el navegador se abre solo una vez al día.
    if (opt.abrirAlIniciar !== false) {
      void $.ui.open({ id: PANE, title: TITULO })
      await $.store.set(WEB_KEY, true)
      const hoy = new Date().toDateString()
      if ((await $.store.get(ABIERTA_KEY)) !== hoy) {
        await $.store.set(ABIERTA_KEY, hoy)
        await escribirWeb($)
        void lanzarServidor($)
        // Se da tiempo a que el servidor empiece a escuchar.
        $.clock.after(1500, () => void abrirNavegador($))
      }
    }
    // Tras una recarga del mod, o si se abrió al iniciar, la vista web sigue encendida.
    if (await $.store.get(WEB_KEY)) encenderWeb($)

    await $.tool.register({
      name: 'planificar',
      description: 'Registra el objetivo y la lista de subtareas del trabajo actual (reemplaza el plan anterior). El usuario ve en el panel cuáles faltan y cuáles están hechas.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          objetivo: { type: 'string', description: 'Resultado final en una frase' },
          subtareas: { type: 'array', items: { type: 'string' }, description: 'Títulos cortos, en orden' },
          dependencias: { type: 'object', description: 'Opcional. Qué subtareas espera cada una, p. ej. {"3": [1, 2]}: la 3 no se puede lanzar hasta que la 1 y la 2 estén hechas' },
        },
        required: ['objetivo', 'subtareas'],
      },
    })
    await $.tool.register({
      name: 'delegar',
      description:
        'Delega una tarea a un trabajador externo (ollama, opencode o claude headless) con el modelo elegido y devuelve su salida, el tiempo y los tokens que consumió. El resultado NO está verificado: debes auditarlo.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          trabajador: { type: 'string', enum: [...TRABAJADORES, 'auto'], description: 'Vacío o auto: el centro elige el mejor según el ranking' },
          modelo: { type: 'string', description: `Modelo del trabajador. Permitidos — ollama: ${ver(modelos.ollama)}; opencode: ${ver(modelos.opencode)}; claude: ${ver(modelos.claude)}. Vacío = el centro elige el mejor de la lista y cambia solo si falla.` },
          categoria: { type: 'string', description: 'Categoría corta de la tarea' },
          tarea: { type: 'string', description: 'Instrucción completa y autocontenida para el trabajador' },
          subtarea: { type: 'number', description: 'Número de la subtarea del plan (de planificar) que cubre este trabajo' },
          cwd: { type: 'string', description: 'Directorio de trabajo (opcional)' },
          aislar: { type: 'boolean', description: 'Si cwd es un repo git: el agente trabaja en su propia copia (git worktree, rama mst/...) y no pisa a los demás. Junta luego con el comando de "copia.juntar"' },
          verificar: { type: 'string', description: 'Comando que comprueba el resultado (p. ej. npm test); el centro lo ejecuta donde trabajó el agente y te da su salida' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Skills que el agente debe seguir (p. ej. design-md, vercel:nextjs). Usa buscar_skills para encontrarlas.' },
        },
        required: ['categoria', 'tarea'],
      },
    })
    await $.tool.register({
      name: 'delegar_varios',
      description:
        'Lanza VARIAS subtareas a la vez, cada una a un agente distinto (el centro elige el mejor modelo libre y cambia solo si falla). Devuelve todos los resultados cuando terminan. Úsalo para las subtareas que no dependen unas de otras.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          tareas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tarea: { type: 'string', description: 'Instrucción completa y autocontenida' },
                categoria: { type: 'string' },
                subtarea: { type: 'number' },
                trabajador: { type: 'string', enum: [...TRABAJADORES, 'auto'] },
                modelo: { type: 'string' },
                cwd: { type: 'string', description: 'Directorio existente; distinto por tarea si editan archivos' },
                aislar: { type: 'boolean', description: 'Si cwd es un repo git: el agente trabaja en su propia copia (git worktree, rama mst/...) y no pisa a los demás. Junta luego con el comando de "copia.juntar"' },
                verificar: { type: 'string', description: 'Comando que comprueba el resultado (p. ej. npm test); el centro lo ejecuta donde trabajó el agente y te da su salida' },
                skills: { type: 'array', items: { type: 'string' }, description: 'Skills que el agente debe seguir (p. ej. design-md, vercel:nextjs). Usa buscar_skills para encontrarlas.' },
              },
              required: ['tarea', 'categoria'],
            },
          },
        },
        required: ['tareas'],
      },
    })
    await $.tool.register({
      name: 'buscar_skills',
      description: 'Busca entre las skills instaladas (las del usuario y las de sus plugins) las que sirven para una tarea. Devuelve nombre, descripción y ruta del SKILL.md. Pasa los nombres elegidos en "skills" al delegar.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { consulta: { type: 'string', description: 'Palabras clave de la tarea, EN INGLÉS (las descripciones de las skills están en inglés), p. ej. "landing page design ui", "deploy vercel", "browser test web"' } } },
    })
    await $.tool.register({
      name: 'registrar_auditoria',
      description: 'Guarda el puntaje (1-10) de tu auditoría a un trabajo delegado, para que el centro aprenda qué trabajador sirve para cada categoría. Con 6 o más, su subtarea queda hecha.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id que devolvió delegar' },
          puntaje: { type: 'number', minimum: 1, maximum: 10 },
          nota: { type: 'string' },
        },
        required: ['id', 'puntaje'],
      },
    })
    await $.tool.register({
      name: 'ranking',
      description: 'Devuelve el puntaje promedio y tiempo promedio de cada trabajador por categoría.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { categoria: { type: 'string' } } },
    })

    return next(e)
  })

  // El nombre del chat: su título si Claude Code lo trae al empezar o reanudar.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.session_title) nombreChat = e.session_title
    return next(e)
    // Si algo falla aquí, el chat arranca igual.
  }).catch(async (_$, e, next) => next(e))

  // Si el chat aún no tiene nombre, toma el de su primer mensaje.
  on('prompt.submit', async ($, e, next) => {
    if (!nombreChat && typeof e.text === 'string' && e.text.trim() && !e.text.startsWith('[Centro de agentes MST]')) nombreChat = nombreDesdeMensaje(e.text)
    return next(e)
    // Si algo falla aquí, tu mensaje sale igual.
  }).catch(async (_$, e, next) => next(e))

  // Modo jefe en todas las sesiones: el protocolo del centro va en las instrucciones de Claude.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (opt.modoJefe === false) return r
    const texto = `# ${TITULO}
Este equipo tiene un centro de agentes (herramientas mcp__centro-agentes__*). Úsalo así:
- Preguntas cortas, explicaciones, conversación o cambios de una o dos líneas: respóndelos tú directamente, sin el centro.
- Trabajo real con varias partes (escribir o cambiar código, tests, documentos, análisis, investigar): sigue este protocolo.

${protocolo(modelos)}`
    return { ...r, sections: [...r.sections, { id: 'centro-agentes:jefe', text: texto, scope: 'session' as const }] }
  })

  // /mst: lo primero en cualquier chat. Abre el panel y la web; con texto, además empieza el trabajo como jefe.
  on('command.run', { command: 'mst' }, async ($, e) => {
    void $.ui.open({ id: PANE, title: TITULO })
    await $.store.set(WEB_KEY, true)
    await escribirWeb($)
    encenderWeb($)
    // Se da tiempo a que el servidor local empiece a escuchar.
    $.clock.after(1500, () => void abrirNavegador($))
    if (!e.args.trim()) return { text: `${TITULO} abierto: panel y web (${await urlWeb($)}). Escribe /mst <tarea> para ponerlo a trabajar.` }
    await update($, plan, () => null)
    await $.prompt.submit({ text: `${protocolo(modelos)}\n\nTAREA:\n${e.args}` })
    return { text: `${TITULO} abierto y tarea enviada al jefe.` }
  })

  on('command.run', { command: 'centro' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Uso: /centro <tarea>' }
    await update($, plan, () => null)
    void $.ui.open({ id: PANE, title: TITULO })
    await $.prompt.submit({ text: `${protocolo(modelos)}\n\nTAREA:\n${e.args}` })
    return { text: 'Tarea enviada al director.' }
  })

  on('command.run', { command: 'centro-bench' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Uso: /centro-bench <tarea>' }
    await update($, plan, () => null)
    void $.ui.open({ id: PANE, title: TITULO })
    await $.prompt.submit({ text: `${bench(modelos)}\n\nTAREA:\n${e.args}` })
    return { text: 'Comparación iniciada.' }
  })

  on('command.run', { command: 'centro-web' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      web?.cancel()
      web = undefined
      await $.store.delete(WEB_KEY)
      return { text: 'Vista web apagada.' }
    }
    await $.store.set(WEB_KEY, true)
    await escribirWeb($)
    encenderWeb($)
    $.clock.after(1500, () => void abrirNavegador($))
    return { text: `Centro abierto en el navegador: ${await urlWeb($)} (se actualiza cada 2 s, con botones para cancelar y relanzar; /centro-web off para pararlo).` }
  })

  on('command.run', { command: 'centro-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: TITULO })
    return { text: 'Panel abierto.' }
  })

  on('command.run', { command: 'mst-informe' }, async $ => {
    const ruta = await escribirInforme($)
    // explorer abre el .md con el programa que tengas para Markdown; necesita la ruta con barras de Windows.
    await $.process.run(['explorer', ruta.replace(/\//g, '\\')]).catch(() => undefined)
    return { text: `Informe guardado en ${ruta}` }
  })

  on('command.run', { command: 'centro-reset' }, async $ => {
    await $.store.delete(STORE_KEY)
    return { text: 'Puntajes borrados.' }
  })

  on('tool.call', { tool: 'mcp__centro-agentes__planificar' }, async ($, e) => {
    try {
      const { objetivo, subtareas, dependencias } = args(e) as { objetivo: string; subtareas: string[] | string; dependencias?: unknown }
      // Algunos clientes mandan el array como texto JSON.
      const titulos: unknown[] = typeof subtareas === 'string' ? JSON.parse(subtareas) : (subtareas ?? [])
      const dep = leerDependencias(dependencias, titulos.length)
      const nuevo: Plan = {
        objetivo: corto(String(objetivo), 120),
        subtareas: titulos.map((titulo, i) => ({ n: i + 1, titulo: corto(String(titulo), 80), estado: 'pendiente', ...(dep.has(i + 1) ? { espera: dep.get(i + 1) } : {}) })),
      }
      await update($, plan, () => nuevo)
      void $.ui.open({ id: PANE, title: TITULO })
      return res({
        guardado: true,
        subtareas: nuevo.subtareas.map(s => ({ n: s.n, titulo: s.titulo, ...(s.espera ? { espera: s.espera } : {}) })),
        lanzar_ya: listas(nuevo.subtareas).map(s => s.n),
      })
    } catch (err) {
      return res({ error: `planificar falló: ${String(err)}` })
    }
  }).catch(async (_$, _e, next) => res({ error: `planificar falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__delegar' }, async ($, e) =>
    res(await delegarUno($, modelos, args(e) as Encargo, timeoutMs)),
  ).catch(async (_$, _e, next) => res({ error: `delegar falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__delegar_varios' }, async ($, e) => {
    const { tareas } = args(e) as { tareas: Encargo[] | string }
    // Algunos clientes mandan el array como texto JSON.
    const lista: Encargo[] = typeof tareas === 'string' ? JSON.parse(tareas) : (tareas ?? [])
    if (!lista.length) return res({ error: 'Pasa al menos una tarea en "tareas".' })
    // Todas a la vez: cada una elige el mejor modelo libre, así trabajan agentes distintos en paralelo.
    const resultados = await Promise.all(lista.map(t => delegarUno($, modelos, t, timeoutMs)))
    return res({ resultados, aviso: 'Resultados sin verificar. Audita cada uno y llama a registrar_auditoria con su id.' })
  }).catch(async (_$, _e, next) => res({ error: `delegar_varios falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__registrar_auditoria' }, async ($, e) => {
    const { id, puntaje, nota } = args(e) as { id: string; puntaje: number; nota?: string }
    const lista = (await read($, trabajos)) ?? []
    const t = lista.find(x => x.id === id)
    if (!t) return res({ error: `No existe el trabajo ${id}` })
    const p = Math.max(1, Math.min(10, Math.round(puntaje)))

    const tabla = ((await $.store.get(STORE_KEY)) ?? {}) as Puntajes
    const fila = (tabla[t.categoria] ??= {})
    const c = (fila[t.trabajador] ??= { n: 0, suma: 0, msTotal: 0 })
    c.n += 1
    c.suma += p
    c.msTotal += t.ms ?? 0
    await $.store.set(STORE_KEY, tabla)

    await update($, trabajos, l => (l ?? []).map(x => (x.id === id ? { ...x, puntaje: p } : x)))
    await puntuarEnHistorial($, id, p)
    await marcar($, t.subtarea, { estado: p >= 6 ? 'hecha' : 'pendiente', quien: t.trabajador, puntaje: p })
    await avisarSiTermino($)
    if (p < 6) $.ui.toast(`${t.trabajador} sacó ${p}/10 en ${t.categoria}${nota ? `: ${corto(nota, 40)}` : ''}`)
    const subs = (await read($, plan))?.subtareas ?? []
    const progreso = {
      hechas: subs.filter(s => s.estado === 'hecha').length, total: subs.length, faltan: subs.filter(s => s.estado !== 'hecha').map(s => s.n),
      // Las pendientes cuyas dependencias ya están hechas: lánzalas ahora.
      lanzar_ya: listas(subs).map(s => s.n),
    }
    // Con nota baja, propone el siguiente modelo mejor clasificado para esa categoría (sin repetir el que falló).
    const siguiente = p < 6
      ? ordenar(tabla, t.categoria, todosLosCandidatos(modelos), new Set([...caidosAhora(), t.trabajador]))[0]
      : undefined
    return res({
      guardado: true, categoria: t.categoria, trabajador: t.trabajador, puntaje: p, progreso,
      ...(siguiente ? { siguiente, aviso: `Rinde poco: vuelve a delegar con trabajador "${siguiente.trabajador}" y modelo "${siguiente.modelo}" (o déjalos vacíos y el centro elige).` } : {}),
    })
  }).catch(async (_$, _e, next) => res({ error: `registrar_auditoria falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__buscar_skills' }, async ($, e) => {
    const { consulta } = args(e) as { consulta?: string }
    const lista = await listarSkills($)
    const halladas = buscarSkills(lista, consulta ?? '')
    return res(halladas.length ? { total: lista.length, skills: halladas } : { total: lista.length, skills: [], aviso: 'Ninguna encaja; prueba otras palabras o sigue sin skill.' })
  }).catch(async (_$, _e, next) => res({ error: `buscar_skills falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__ranking' }, async ($, e) => {
    const { categoria } = args(e) as { categoria?: string }
    const tabla = ((await $.store.get(STORE_KEY)) ?? {}) as Puntajes
    const filas = Object.entries(tabla)
      .filter(([cat]) => !categoria || cat === categoria.toLowerCase().trim())
      .map(([cat, fila]) => ({
        categoria: cat,
        trabajadores: Object.entries(fila)
          .map(([w, c]) => ({
            trabajador: w,
            promedio: Math.round((c!.suma / c!.n) * 10) / 10,
            segundosProm: Math.round(c!.msTotal / c!.n / 1000),
            muestras: c!.n,
          }))
          .sort((a, b) => b.promedio - a.promedio),
      }))
    return res(filas.length ? filas : { sinDatos: true })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const { p, pct, resumen, secciones, figuraSvg, tableroSvg, altFigura, altTablero } = await armar($, e.viewport?.rows ?? 30)
    const ancho = Math.max(30, (e.viewport?.columns ?? 80) - 4)
    const barra = (n: number, largo = 20) => '█'.repeat(Math.round((n / 100) * largo)).padEnd(largo, '░')
    // La terminal no dibuja SVG: allí queda solo el texto de abajo.
    const Svg = 'Svg' in els ? els.Svg : undefined

    return (
      <Box flexDirection="column">
        {Svg && <Svg source={figuraSvg} alt={altFigura} isInteractive />}
        {Svg && <Svg source={tableroSvg} alt={altTablero} isInteractive />}
        {!Svg && (
          <Box flexDirection="column">
            {p && <Text bold color={GRIS.hi}>{corto(p.objetivo, ancho)}</Text>}
            {p && <Text><Text color={VINO}>{barra(pct)}</Text></Text>}
            {resumen.map(f => <Text color={GRIS[f.tono]}>{f.celdas.join('  ·  ')}</Text>)}
            {secciones.map(s => (
              <Box flexDirection="column">
                <Text bold color={GRIS.mid}>{s.titulo.toUpperCase()}</Text>
                {s.filas.length === 0 && s.vacio && <Text color={GRIS.lo}>  {s.vacio}</Text>}
                {s.filas.map(f => <Text color={GRIS[f.tono]}>{f.celdas.filter(Boolean).join('  ')}</Text>)}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
