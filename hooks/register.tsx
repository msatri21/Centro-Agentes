import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, Trabajador, Trabajo } from '../types'
import type { Tarea } from './tareas'
import { colaDeLineas, figura, tablero, VINO } from './figura'
import { paginaCentro, paginaTodosGrafo } from './vista'
import { textoAvisoPonytail } from './ponytailAviso'
import { abiertas, ESPERA_RESPUESTA_MS, PROTOCOLO_AGENTE } from './consultas'
import { consultar, preferir, recomendar, registrar } from './cerebro'
import type { Cerebro } from './cerebro'
import { CON_MAPA, clasificarTarea, conCarpeta, skillsAutomaticas } from './skillsAuto'
import { agregarRendimiento, bloqueos, estadoSubtareaNuevo, informeMarkdown, leerAider, leerDependencias, listas, temaNtfyValido } from './extras'
import type { Fila, Seccion, Tono } from './figura'
import { Cerrojos, archivosCambiados, clave, costoApi, costoComoClaude, debeBuscarActualizacion, fueraDeAlcance, esErrorDeCuenta, esErrorDeRed, leerClaude, leerCodex, leerHermes, leerOllama, leerOpencode, ordenar, sinAnsi, vistaDe } from './nucleo'
import type { Candidato, Puntajes, Salida } from './nucleo'
import { filasModelos, detectarNecesidades, entradaDe, filtrarPorCapacidad, textoCatalogo } from './catalogo.ts'
import type { Capacidad, Catalogo } from './catalogo'
import { AMARILLO_MS_POR_DEFECTO, FALLOS_SEGUIDOS_ESCALA, agenteVivo, descripcionCorta, INACTIVIDAD_MIN_POR_DEFECTO, MAX_PARALELO, REINTENTOS_ARRANQUE, Registro, Semaforo, contarCambios, duracionCorta, esErrorDeArranque, esMasiva, filasResumenPanelSesion, filasVivas, inactivo, lineaAviso, pistaPanel, resumenEstado, tareaLimpia, textoAvisoGrupo, textoBarra, textoEstado, tituloCorto, type RegistroGuardado, type TrabajoVivo } from './asincrono.ts'
export { costoApi, costoComoClaude, esErrorDeCuenta, esErrorDeRed, leerClaude, leerCodex, leerHermes, leerOllama, leerOpencode, ordenar, vistaDe } from './nucleo'
export type { Candidato } from './nucleo'

// Los tonos del kit de anatomy para la terminal: grises y negros, y el vinotinto como único acento.
const GRIS: Record<Tono, string> = { hi: '#d4d4d4', mid: '#8a8a8a', lo: '#5a5a5a', vino: VINO }

const PANE = 'centro-agentes'
const TITULO = 'Centro de agentes MST'
const STORE_KEY = 'puntajes'
const WEB_KEY = 'web'
const ABIERTA_KEY = 'web-abierta-el'
const TRABAJADORES: readonly Trabajador[] = ['ollama', 'opencode', 'hermes', 'aider', 'codex', 'claude']

let seq = 0
const registro = new Registro()
const escaladasMasivas = new Set<string>()
const trabajos = atom({ plugin: 'centro-agentes', key: 'trabajos' } as const, [] as Trabajo[])
const plan = atom({ plugin: 'centro-agentes', key: 'plan' } as const, null as Plan | null)
// Los planes anteriores del chat (el grafo los dibuja atenuados); un plan nuevo con el mismo objetivo que uno anterior lo reactiva.
const planes = atom({ plugin: 'centro-agentes', key: 'planes' } as const, [] as Plan[])
// Qué secciones del panel están plegadas; por defecto ninguna (abiertas).
const plegadas = atom({ plugin: 'centro-agentes', key: 'plegadas' } as const, {} as Record<string, boolean>)
let vivosPrevios = 0
// La persona cerró el panel a mano: no se reabre sola al arrancar un agente (solo /mst y /centro-panel lo abren).
let panelCerradoAMano = false


type Opciones = {
  ollamaModels?: string
  hermesModels?: string
  aiderModels?: string
  codexModels?: string
  presupuestoClaudeTokens?: number
  ntfyTema?: string
  opencodeModels?: string
  claudeModels?: string
  timeoutMin?: number
  inactividadMin?: number
  proxy?: string
  certificadoCA?: string
  esperaInicialSeg?: number
  ponytailAutomatico?: boolean
  lanzadorDesacoplado?: boolean
  catalogoEnLinea?: boolean
  abrirAlIniciar?: boolean
  modoJefe?: boolean
}

type Modelos = Record<Trabajador, string[]>



const lista = (s: string | undefined, def: string[]) => {
  const l = (s ?? '').split(',').map(x => x.trim()).filter(Boolean)
  return l.length ? l : def
}

// Lo primero que hace el jefe en /mst: el enlace, el cerebro y las preguntas. Después, el protocolo de siempre.
const ANTES = (url?: string) => `Antes de empezar, en este orden:
A. ${url ? `ENLACE: tu PRIMER mensaje es solo este enlace del centro de agentes de este chat (el usuario lo abre y lo ve todo en vivo): ${url}` : 'ENLACE: tu primer mensaje es el enlace del centro de agentes de este chat (el campo "web" que devuelve mcp__centro-agentes__cerebro).'}
B. CEREBRO: llama a mcp__centro-agentes__cerebro con las palabras clave de la tarea. Te dice qué agente y modelo lo hicieron mejor en casos parecidos de CUALQUIER chat; tenlo en cuenta al preguntar y al repartir (el centro ya prefiere a ese agente si dejas trabajador y modelo vacíos).
C. PREGUNTAS: pregúntale al usuario hasta que te quede claro qué quiere: objetivo, alcance, estilo o tecnología, restricciones y cómo sabrá que está terminado. Usa la herramienta AskUserQuestion si la tienes (2-4 preguntas por ronda, con tu opción recomendada primero); si no, pregunta en el chat. No preguntes lo que la tarea ya dice. Haz las rondas que hagan falta (normalmente 1 o 2). Cuando te quede claro, resume en 2-3 líneas lo que entendiste y pasa al protocolo.`

const protocolo = (m: Modelos, url?: string) => `Actúa como JEFE del centro de agentes. Tú no haces el trabajo: planificas, repartes, verificas y entregas. Gasta lo mínimo de Claude: el trabajo lo hacen los agentes gratis.

Agentes (el centro elige solo el mejor modelo de cada uno según su historial; un agente sin probar se explora):
- opencode: agente de código que edita archivos en su directorio. Usa los modelos gratis de la nube de Ollama: ${ver(m.opencode)}.
- ollama: modelos de texto, en la nube de Ollama (gratis) y uno local de respaldo: ${ver(m.ollama)}.
- hermes: Hermes Agent (Nous Research), agente generalista con sus propias herramientas (terminal, archivos, web); usa los modelos gratis de la nube de Ollama: ${ver(m.hermes)}.
- aider: Aider, agente de código por parejas que edita archivos en su directorio; usa los modelos gratis de la nube de Ollama: ${ver(m.aider)}.
- codex: Codex (OpenAI), agente de código que edita archivos y ejecuta comandos en su carpeta; usa tu cuenta de ChatGPT (cupo gratis limitado) o, de respaldo, los modelos gratis de Ollama: ${ver(m.codex)}.
- claude: Claude headless (${ver(m.claude)}). Gasta del plan de Claude: el centro solo lo elige si los gratis rinden claramente peor.

${ANTES(url)}

Protocolo:
El centro tiene un catálogo de modelos con sus capacidades; consúltalo con modelos. Si la tarea necesita ver imágenes, se detecta sola o pasa necesita: ['imagen']. Si no hay modelo capaz, no se lanza: no pruebes otro a ciegas, díselo al usuario. Si el usuario propone un modelo («prueba con tal modelo»), comprueba con modelos que existe, úsalo con modelo en delegar y puntúalo al auditar. Si recibes un mensaje que empieza por «[Centro de agentes MST] El usuario propone probar el modelo», haz lo mismo en la próxima tarea que encaje.
El plan se guarda en mst-tareas.json de la carpeta del proyecto (git lo ignora) y se crea con el primer planificar: planifica un BORRADOR al tener objetivo y subtareas de primer vistazo y púlelo al repartir con planificar { agregar } y { ajustar }. Usa manuales para lo que no se delegas (instalar, respaldar). tareas_estado muestra el estado; planificar { tarea: 'T2' } retoma una tarea. Los agentes no editan mst-tareas.json: anotan trabajo nuevo al final bajo «Propuestas:» y tú decides si agregarlo como hermana o planificarlo como tarea nueva. Reabrir una tarea solucionada es decisión tuya: si cumplía lo pedido crea una nueva; si no, usa planificar { reabrir: ["T2.3"] } para devolver a pendiente la subtarea que falló.
1. Haz un plan: divide la tarea en subtareas lo más independientes posible y regístralas con mcp__centro-agentes__planificar. Es lo que el usuario ve como progreso. Si una necesita el resultado de otras, ponlo en "dependencias" (p. ej. {"3": [1, 2]}); planificar y registrar_auditoria te dicen en "lanzar_ya" cuáles puedes lanzar.
2. Lanza las subtareas con mcp__centro-agentes__delegar_varios (una entrada por subtarea, con su número en "subtarea" y una categoría corta: codigo, tests, docs, texto, analisis...). Devuelve ids al instante y el trabajo sigue en segundo plano; el centro avisa UNA vez cuando termina el grupo entero. No esperes resultados ni sondees en bucle: mientras puedes hablar con el usuario o hacer otra cosa; usa estado solo si hace falta. Deja trabajador y modelo vacíos salvo que la tarea lo exija (opencode para editar archivos). Si varias editan archivos, dales directorios distintos y que existan; si editan el mismo repo git, pasa aislar: true y cada agente trabaja en su copia (luego juntas con "copia.juntar"). Si prefieres que varios trabajen en la misma carpeta y rama, no pases aislar: di en "archivos" qué puede tocar cada uno; los que tocan cosas distintas trabajan a la vez y los que chocan se turnan (sin "archivos" se turnan todos). El resultado avisa en "fuera_de_alcance" si alguno tocó algo que no era suyo. Si el proyecto tiene tests, pasa en "verificar" el comando (p. ej. npm test) y el centro te da su resultado. Las que dependan de otras puedes mandarlas en el mismo lote: quedan en espera y arrancan solas cuando terminan bien sus previas.
3. Cada instrucción debe ser completa y autocontenida: el agente no ve esta conversación.
   Skills: si una subtarea es de un tipo para el que puede haber una skill (diseño, una plataforma, un formato de archivo, un framework, pruebas en navegador...), llama a mcp__centro-agentes__buscar_skills con unas palabras de la tarea y pasa los nombres que encajen en "skills" del encargo; el agente leerá su SKILL.md y la seguirá (las tareas con skills no van a Ollama, que no lee archivos). Usa tú también tus skills para verificar cuando ayuden (p. ej. un navegador para comprobar una web).
4. Cuando llegue el aviso único de que terminó el grupo, verifica cada resultado de verdad y barato: lee los archivos que cambió, ejecuta los tests o el código, busca errores y alucinaciones. No confíes en lo que el agente dice que hizo.
5. Registra cada verificación con mcp__centro-agentes__registrar_auditoria (puntaje 1-10 honesto), usando el id de trabajo o el id de encargo eN. Con 6 o más la subtarea queda solucionada.
6. Si el puntaje es < 6, rehazla a partir de lo que está mal: vuelve a delegarla (sola o con otras en delegar_varios) diciendo qué falló exactamente, qué hay que corregir y, si sirve, el resultado anterior. registrar_auditoria te sugiere en "siguiente" otro modelo; úsalo. Máximo 2 reintentos por subtarea.
7. Las subtareas que hagas tú (juntar ramas, revisar el conjunto) ciérralas con mcp__centro-agentes__cerrar_subtarea. Cuando todo esté hecho, junta las piezas y entrega el resultado final con un informe corto: qué hizo cada agente, su puntaje, qué se rehízo y qué queda pendiente.

Nunca hagas tú la tarea completa salvo que todos los agentes fallen; en ese caso dilo.`

const bench = (m: Modelos) => `Modo COMPARACIÓN del centro de agentes. Envía la MISMA tarea a cada combinación trabajador/modelo con mcp__centro-agentes__delegar: ollama (${ver(m.ollama)}), opencode (${ver(m.opencode)}) y claude (${ver(m.claude)}). Si la tarea edita archivos, usa un directorio distinto para cada combinación (p. ej. bench-ollama-llama3.2, bench-claude-opus) para que no se pisen.
Luego audita los tres resultados con el mismo criterio (corrección, completitud, calidad, tiempo), registra cada uno con mcp__centro-agentes__registrar_auditoria y muestra una tabla: trabajador:modelo | puntaje | tiempo | tokens | comentario, y di cuál conviene para esta categoría.`

const ver = (l: string[]) => l.map(x => x || 'por defecto').join(', ')

const corto = (t: string, n = 60) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
export const filasPanelVivo = (trabajos: TrabajoVivo[], ahora: number) => filasVivas(trabajos, ahora).map(v => ({
  agente: v.agente,
  modelo: v.modelo,
  tarea: tituloCorto(v.tarea ?? '', 8),
  tiempo: duracionCorta(v.trabajandoMs),
  color: v.amarillo ? '#ffb86c' : GRIS.hi,
}))

// agente · modelo corto, sin el proveedor: 'opencode:opencode/deepseek-v4.1-flash-free' -> 'opencode · deepseek-v4.1-flash-free'.
export const quienCorto = (q?: string) => {
  if (!q) return ''
  const [agente, ...resto] = q.split(':')
  const modelo = resto.join(':').split('/').pop()
  return modelo ? `${agente} · ${modelo}` : agente
}

// Una sección está plegada solo si el atom lo dice: por defecto, todas abiertas.
export const estaPlegada = (plegadas: Record<string, boolean>, clave: string) => plegadas[clave] === true
// La cabecera pulsable: el glifo (▾ abierta, ▸ plegada) va en su botón y el título aparte.
export const cabeceraPlegable = (plegadas: Record<string, boolean>, clave: string, titulo: string) =>
  ({ glifo: estaPlegada(plegadas, clave) ? '▸' : '▾', titulo })

// La versión del plugin para la cabecera del panel: se lee una vez por sesión.
let versionPanel: string | undefined
let versionPanelLeida = false
async function versionDelPlugin($: EngineInterface) {
  if (!versionPanelLeida) {
    versionPanelLeida = true
    // Sin la marca BOM: algunos editores de Windows la ponen y JSON.parse falla con ella.
    versionPanel = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)
      .then(t => (JSON.parse(t.replace(/^﻿/, '')) as { version?: string }).version)
      .catch(() => undefined)
  }
  return versionPanel
}

// Una línea legible del historial del panel: ✓ opencode · deepseek-v4.1-flash · 1m02s · 8/10 — pulido del panel
export const lineaHistorial = (t: Pick<Trabajo, 'trabajador' | 'ms' | 'puntaje' | 'estado'>, tarea?: string) => {
  const [agente, ...resto] = t.trabajador.split(':')
  const modelo = resto.join(':').split('/').pop()
  const ms = t.ms ?? 0
  const duracion = ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
    : `${Math.round(ms / 1000)}s`
  const linea = [`${t.estado === 'error' ? '✗' : '✓'} ${agente}`, modelo, duracion, t.puntaje !== undefined ? `${t.puntaje}/10` : '']
    .filter(Boolean)
    .join(' · ')
  return tarea ? `${linea} — ${tituloCorto(tarea, 5)}` : linea
}

const miles = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

// Una herramienta MCP devuelve texto (o bloques), no objetos: el resultado va como JSON.
const res = (x: unknown) => ({ result: JSON.stringify(x, null, 1) })

async function avisarGrupo($: EngineInterface, grupo: string) {
  const encargos = registro.delGrupo(grupo)
  const text = textoAvisoGrupo(grupo, encargos)
  void $.prompt.submit({ text }).catch(() => undefined)
}

// El motor pone los argumentos de la herramienta en e; el harness de tests, en e.input.
const args = (e: object): unknown => (e as { input?: unknown }).input ?? e

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


// Un host por agente para comprobar si se llega a él (cualquier código HTTP vale; 000 o 407 no).
const HOST_DE: Record<Trabajador, string> = {
  ollama: 'https://ollama.com',
  // Hermes usa los modelos de la nube de Ollama: llega a internet por el mismo sitio.
  hermes: 'https://ollama.com',
  aider: 'https://ollama.com',
  // Con la cuenta de ChatGPT sale a chatgpt.com; sus modelos de Ollama van por tu Ollama local.
  codex: 'https://chatgpt.com',
  // OpenCode usa la nube de Ollama a través de tu Ollama local.
  opencode: 'https://ollama.com',
  claude: 'https://api.anthropic.com',
}
const SALUD_MS = 3 * 60_000
const salud = new Map<Trabajador, { ok: boolean; en: number }>()
let red: Record<string, string> = {}
let esperaInicialMs = 90_000
let limiteInactividadMs = INACTIVIDAD_MIN_POR_DEFECTO * 60_000
// Los agentes corren bajo mcp/lanzador.mjs y dejan su salida en disco (ajuste lanzadorDesacoplado); sin el ajuste, el camino de siempre.
let lanzadorDesacoplado = false
const escaladasVigilante = new Set<string>()
// Las skills de ponytail que el centro añade solo, según la clase de tarea (ajuste ponytailAutomatico).
let skillsAuto = true

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
// Según cómo se instaló, vive en ~\.hermes o en AppData\Local\hermes: se usa la que exista.
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

// Codex lee su servidor MCP de la línea de comandos (-c), así que no hace falta tocar su configuración: el centro le da su propio
// servidor de preguntar y pedir_permiso, le reenvía la identidad del trabajo y le amplía el tiempo de espera (60 s por defecto).
function mcpCodex($: EngineInterface): string[] {
  const guion = `${$.plugin.root}/mcp/centro-mcp.mjs`.split(String.fromCharCode(92)).join('/')
  return [
    '-c', 'mcp_servers.centro.command="node"',
    '-c', `mcp_servers.centro.args=["${guion}"]`,
    '-c', 'mcp_servers.centro.env_vars=["CENTRO_TRABAJADOR","CENTRO_CHAT_DIR","CENTRO_TRABAJO","CENTRO_ESPERA_MS"]',
    '-c', 'mcp_servers.centro.tool_timeout_sec=1200',
  ]
}

// ¿Hay una pregunta o un permiso de este trabajo esperando al usuario? Mientras lo hay, no se corta al agente por tardar ni por callar.
async function esperaUsuario($: EngineInterface, trabajoId?: string) {
  if (!trabajoId) return false
  try {
    const dir = await carpetaChat($)
    const [consultas, respuestas] = await Promise.all([$.fs.read(`${dir}/consultas.jsonl`), $.fs.read(`${dir}/respuestas.jsonl`).catch(() => '')])
    return abiertas(consultas, respuestas).some(c => c.trabajo === trabajoId)
  } catch {
    return false
  }
}

// Las preguntas y los permisos abiertos de los agentes que siguen trabajando, listos para mostrarlos en la web.
async function pendientesDe($: EngineInterface, lista: Trabajo[]) {
  try {
    const dir = await carpetaChat($)
    const leer = (nombre: string) => $.fs.read(`${dir}/${nombre}`).catch(() => '')
    const [consultas, respuestas, permisos] = await Promise.all([leer('consultas.jsonl'), leer('respuestas.jsonl'), leer('permisos.json')])
    const vivos = new Map(lista.filter(t => t.estado === 'corriendo').map(t => [t.id, t]))
    return abiertas(consultas, respuestas, permisos)
      .filter(c => vivos.has(c.trabajo))
      .map(c => ({ id: c.trabajo, consulta: c.id, agente: vivos.get(c.trabajo)!.trabajador.split(':')[0], tipo: c.tipo, texto: c.texto, detalle: c.detalle, categoria: c.categoria, opciones: c.opciones, en: c.en }))
  } catch {
    return []
  }
}

export async function vigilar($: EngineInterface, ahora = Date.now()) {
  const lista = (await read($, trabajos)) ?? []
  const pendientes = await pendientesDe($, lista)
  const esperando = new Set(pendientes.map(p => p.id))
  for (const t of lista) {
    if (t.estado !== 'corriendo') continue
    if (inactivo(t, ahora, limiteInactividadMs) && !esperando.has(t.id)) {
      const clave = `${t.id}:inactivo`
      if (!escaladasVigilante.has(clave)) {
        escaladasVigilante.add(clave)
        const min = Math.floor((ahora - (t.ultimaActividad ?? t.inicio)) / 60_000)
        void $.prompt.submit({ text: `[Centro de agentes MST] ESCALADA (inactivo): ${t.trabajador} (trabajo ${t.id}${t.subtarea === undefined ? '' : `, subtarea ${t.subtarea}`}) lleva ${min} min sin dar señales. Puedes esperar o relanzar la subtarea con delegar usando otro modelo; el usuario también puede cancelarlo desde la web.` }).catch(() => undefined)
      }
    }
  }
  for (const p of pendientes) {
    if (p.tipo !== 'permiso') continue
    const clave = `${p.id}:permiso:${p.consulta}`
    if (escaladasVigilante.has(clave)) continue
    escaladasVigilante.add(clave)
    void $.prompt.submit({ text: `[Centro de agentes MST] ESCALADA (permiso): ${p.agente} pide permiso (${p.categoria}): "${p.texto}". La decisión es del USUARIO en la web: no la apruebes ni actúes tú; sigue con otra cosa.` }).catch(() => undefined)
  }
}

type Corrida = { exitCode: number | null; stdout: string; stderr: string; isStdoutTruncated: boolean; cortado?: boolean; fin?: number }

// Cada cuánto se mira el log del agente en disco.
const SONDEO_MS = 500
// Tras pedir la cancelación, cuánto se espera al fin.json antes de darlo por perdido.
const ESPERA_CANCELAR_MS = 5000

// Ejecuta al agente a través de mcp/lanzador.mjs: él deja la salida (<id>.log) y el final (<id>.fin.json) en disco y
// sigue vivo aunque este plugin se recargue; aquí solo se lee de ahí. Devuelve undefined si no pudo preparar el
// lanzamiento (el agente no llegó a arrancar), para que se use el camino de siempre.
async function correrDesacoplado(
  $: EngineInterface,
  argv: string[],
  init: { cwd?: string; stdin?: string; timeoutMs: number; trabajoId: string },
  env: Record<string, string>,
  alTrozo: (stdout: string) => void,
  alCortar: (cortar: (por: string) => void) => void,
): Promise<Corrida | undefined> {
  const id = init.trabajoId
  const carpeta = `${await carpetaChat($)}/trabajos`
  const ruta = (ext: string) => `${carpeta}/${id}${ext}`
  try {
    let raiz = ''
    try { raiz = $.plugin.root } catch {}
    await $.fs.write(ruta('.argv.json'), JSON.stringify(argv))
    if (init.stdin !== undefined) await $.fs.write(ruta('.in'), init.stdin)
    // El primer proceso solo relanza al lanzador fuera de nuestro árbol de procesos y sale al instante.
    const lanzar = $.process.spawn({ argv: ['node', `${raiz}/mcp/lanzador.mjs`, carpeta, id, '--desacoplado'], cwd: init.cwd, env: Object.keys(env).length ? env : undefined })
    for await (const _ of lanzar) {}
    // Si node no pudo con el lanzador, el agente no arrancó: se vuelve al camino de siempre en vez de esperar un fin que no llegará.
    if ((await lanzar.result).code !== 0) return undefined
  } catch {
    return undefined
  }
  return esperarArchivos($, { carpeta, id, timeoutMs: init.timeoutMs, trabajoId: id }, alTrozo, alCortar)
}

// Lee de disco lo que deja el lanzador (<id>.log en vivo y <id>.fin.json al terminar) hasta que el agente acaba.
// Sirve igual para el agente recién lanzado que para uno reencontrado tras recargar el plugin.
async function esperarArchivos(
  $: EngineInterface,
  init: { carpeta: string; id: string; timeoutMs: number; trabajoId: string },
  alTrozo: (stdout: string) => void,
  alCortar: (cortar: (por: string) => void) => void,
): Promise<Corrida> {
  const id = init.id
  const ruta = (ext: string) => `${init.carpeta}/${id}${ext}`
  let stdout = ''
  let stderr = ''
  let motivo = ''
  let leido = 0
  let terminado = false
  let corteEn = 0
  const cortar = (por: string) => {
    if (motivo) return
    motivo = por
    corteEn = Date.now()
    void $.fs.write(ruta('.cancelar'), por).catch(() => undefined)
  }
  alCortar(cortar)
  let reloj: { cancel(): void } = { cancel() {} }
  const armarReloj = () => {
    reloj = $.clock.after(init.timeoutMs, async () => {
      if (terminado || motivo) return
      if (await esperaUsuario($, init.trabajoId)) armarReloj()
      else if (!terminado) cortar('pasó el tiempo máximo')
    })
  }
  armarReloj()
  let callado: { cancel(): void } | undefined
  const armarCallado = () => {
    callado = $.clock.after(esperaInicialMs, async () => {
      if (terminado || motivo) return
      if (await esperaUsuario($, init.trabajoId)) armarCallado()
      else if (!terminado) cortar(`sin respuesta en ${esperaInicialMs / 1000} s (¿red o proxy bloqueado?)`)
    })
  }
  armarCallado()
  // Lee del log lo que llegó desde la última vez; solo cuentan las líneas completas.
  const leerNuevo = async () => {
    const texto = await $.fs.read(ruta('.log')).catch(() => '')
    const trozo = texto.slice(leido)
    const corte = trozo.lastIndexOf('\n')
    if (corte < 0) return
    leido += corte + 1
    let hayStdout = false
    for (const linea of trozo.slice(0, corte).split('\n')) {
      let parte: { s?: string; t?: string }
      try { parte = JSON.parse(linea) } catch { continue }
      const t = String(parte.t ?? '')
      callado?.cancel()
      callado = undefined
      if (parte.s === 'stdout') {
        stdout += t
        hayStdout = true
        // opencode informa los errores del proveedor en su stdout JSON.
        if (t.includes('"type":"error"') && esErrorDeRed(t)) cortar('error de red')
      } else {
        stderr += t
        if (esErrorDeRed(t)) cortar('error de red')
      }
    }
    if (hayStdout) alTrozo(stdout)
  }
  let fin: { code?: number | null; cancelado?: boolean; error?: string; fin?: number } | undefined
  try {
    while (true) {
      await leerNuevo()
      const f = await $.fs.read(ruta('.fin.json')).catch(() => '')
      if (f) {
        try { fin = JSON.parse(f) } catch {}
        if (fin) { await leerNuevo(); break }
      }
      // Pidió cortar pero el lanzador no contesta (murió): se da por perdido en vez de esperar para siempre.
      if (motivo && Date.now() - corteEn > ESPERA_CANCELAR_MS) break
      await new Promise<void>(resolver => setTimeout(resolver, SONDEO_MS))
    }
  } finally {
    terminado = true
    reloj.cancel()
    callado?.cancel()
  }
  if (!motivo && fin?.cancelado) motivo = CANCELADO
  const sinCodigo = !!motivo || !!fin?.error || !fin
  return {
    exitCode: sinCodigo ? null : (fin?.code ?? null),
    stdout,
    stderr: motivo ? `${stderr}\n[cortado: ${motivo}]` : fin?.error ? `${stderr}\n${fin.error}` : stderr,
    isStdoutTruncated: false,
    cortado: !!motivo,
    fin: fin?.fin,
  }
}

// Lanza el proceso y lee su salida a trozos, para que el panel muestre en vivo lo que escribe cada agente.
async function correrEnVivo(
  $: EngineInterface,
  argv: string[],
  init: { cwd?: string; stdin?: string; timeoutMs: number; trabajoId?: string },
  alTrozo: (stdout: string) => void,
  alCortar: (cortar: (por: string) => void) => void = () => {},
): Promise<Corrida> {
  // PWD: OpenCode toma su carpeta de ahí y no del cwd del proceso.
  // CENTRO_*: así el agente sabe a qué chat y a qué trabajo pertenece (sus herramientas preguntar y pedir_permiso escriben ahí).
  const identidad = init.trabajoId ? { CENTRO_TRABAJADOR: '1', CENTRO_CHAT_DIR: await carpetaChat($), CENTRO_TRABAJO: init.trabajoId, CENTRO_ESPERA_MS: String(ESPERA_RESPUESTA_MS) } : {}
  const env = { ...red, ...(await entornoHermes($)), OLLAMA_API_BASE: 'http://127.0.0.1:11434', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(init.cwd ? { PWD: init.cwd } : {}), ...identidad }
  if (lanzadorDesacoplado && init.trabajoId) {
    const c = await correrDesacoplado($, argv, { ...init, trabajoId: init.trabajoId }, env, alTrozo, alCortar)
    if (c) return c
  }
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
  // Si el agente espera una respuesta del usuario, el reloj no corre: se vuelve a armar en vez de cortarlo.
  let terminado = false
  let reloj: { cancel(): void } = { cancel() {} }
  const armarReloj = () => {
    reloj = $.clock.after(init.timeoutMs, async () => {
      if (terminado || motivo) return
      if (await esperaUsuario($, init.trabajoId)) armarReloj()
      else if (!terminado) cortar('pasó el tiempo máximo')
    })
  }
  armarReloj()
  // Si no escribe nada en un rato, suele ser la red o el proxy colgando la conexión: se corta para probar otro.
  let callado: { cancel(): void } | undefined
  const armarCallado = () => {
    callado = $.clock.after(esperaInicialMs, async () => {
      if (terminado || motivo) return
      if (await esperaUsuario($, init.trabajoId)) armarCallado()
      else if (!terminado) cortar(`sin respuesta en ${esperaInicialMs / 1000} s (¿red o proxy bloqueado?)`)
    })
  }
  armarCallado()
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
    terminado = true
    reloj.cancel()
    callado?.cancel()
  }
  const fin = motivo ? undefined : await flujo.result.catch(() => undefined)
  return { exitCode: motivo ? null : (fin?.code ?? null), stdout, stderr: motivo ? `${stderr}\n[cortado: ${motivo}]` : stderr, isStdoutTruncated: false, cortado: !!motivo }
}

async function ejecutar(
  $: EngineInterface,
  argv: string[],
  init: { cwd?: string; stdin?: string; timeoutMs: number; trabajoId?: string },
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


async function marcar($: EngineInterface, n: number | undefined, cambio: Partial<Plan['subtareas'][number]>) {
  if (n === undefined) return undefined
  const p = await read($, plan)
  await update($, plan, actual => (actual ? { ...actual, subtareas: actual.subtareas.map(s => (s.n === n ? { ...s, ...cambio } : s)) } : actual))
  if (!p?.tarea || !p.raiz) return undefined
  const r = await tareasArchivo($, 'aplicar', p.raiz, { tipo: 'estado', id: `${p.tarea}.${n}`, estado: cambio.estado })
  return r.ok ? undefined : r.mensaje ?? 'No se pudo guardar el estado de la subtarea en el archivo'
}

async function reservarSubtarea($: EngineInterface, n: number) {
  const p = await read($, plan)
  if (!p?.tarea || !p.raiz) return {}
  const r = await tareasArchivo($, 'aplicar', p.raiz, { tipo: 'estado', id: `${p.tarea}.${n}`, estado: 'en_proceso', solo_si: 'pendiente' })
  if (!r.ok && r.codigo === 'conflicto') return { error: `La subtarea ${n} ya está en proceso (otro encargo u otro chat); no se lanza otra vez` }
  if (!r.ok && r.codigo === 'bloqueada') return { error: `La subtarea ${n} espera a sus dependencias: lánzala cuando estén hechas.` }
  if (!r.ok && r.codigo === 'manual') return { error: `La subtarea ${n} es manual y no se delega` }
  await update($, plan, actual => (actual ? { ...actual, subtareas: actual.subtareas.map(s => s.n === n ? { ...s, estado: 'en_proceso' } : s) } : actual))
  return r.ok ? {} : { aviso_archivo: r.mensaje ?? 'No se pudo reservar la subtarea en el archivo' }
}

// Arma todo lo que muestra el centro (panel y página web) a partir del estado.
// --- Historial entre sesiones y contador de ahorro (en el almacén permanente del plugin) ---

const HIST_KEY = 'historial'
const AHORRO_KEY = 'ahorro'
const MAX_HIST = 200
type Ahorro = { usd: number; gastoClaude: number; trabajos: number; api?: number; sinPrecio?: number }

// 'ollama:gpt-oss:120b-cloud' -> agente 'ollama', modelo 'gpt-oss:120b-cloud' (el modelo puede llevar sus propios ':').
export const agenteYModelo = (trabajador: string) => {
  const i = trabajador.indexOf(':')
  return i < 0 ? { agente: trabajador, modelo: '' } : { agente: trabajador.slice(0, i), modelo: trabajador.slice(i + 1) }
}

function precioDeTrabajo(t: Trabajo) {
  if (t.trabajador.startsWith('claude:')) return undefined
  const { agente, modelo } = agenteYModelo(t.trabajador)
  return entradaDe(catalogoMemoria, agente as any, modelo)?.precio
}

async function guardarEnHistorial($: EngineInterface, t: Trabajo) {
  const h = ((await $.store.get(HIST_KEY)) ?? []) as Trabajo[]
  await $.store.set(HIST_KEY, [...h.filter(x => x.id !== t.id), { ...t, salida: undefined }].slice(-MAX_HIST))
  const a = ((await $.store.get(AHORRO_KEY)) ?? { usd: 0, gastoClaude: 0, trabajos: 0 }) as Ahorro
  const esClaude = t.trabajador.startsWith('claude:')
  await $.store.set(AHORRO_KEY, {
    usd: a.usd + (esClaude ? 0 : costoComoClaude(t.tokensIn, t.tokensOut, t.tokensCache)),
    gastoClaude: a.gastoClaude + (esClaude ? (t.costo ?? 0) : 0),
    trabajos: a.trabajos + 1,
    api: (a.api ?? 0) + (esClaude ? (t.costo ?? 0) : costoApi(t, precioDeTrabajo(t)) ?? 0),
    sinPrecio: (a.sinPrecio ?? 0) + (!esClaude && !precioDeTrabajo(t) ? 1 : 0),
  })
}

async function puntuarEnHistorial($: EngineInterface, id: string, puntaje: number) {
  const h = ((await $.store.get(HIST_KEY)) ?? []) as Trabajo[]
  if (h.some(x => x.id === id)) await $.store.set(HIST_KEY, h.map(x => (x.id === id ? { ...x, puntaje } : x)))
}

// En la web, las skills de un trabajo van delante de su texto con ✦.
export const conSkills = (skills: string[] | undefined, texto: string) => (skills?.length ? `✦ ${skills.join(', ')} · ${texto}` : texto)

async function armar($: EngineInterface, filasVista = 30) {
    await leerCatalogoPlugin($)
    const lista = (await read($, trabajos)) ?? []
    const p = await read($, plan)
    const ctx = (await $.session.usage()).context
    const ahora = Date.now()
    // El historial suma lo de sesiones anteriores (del almacén) a lo de esta.
    const deAntes = (((await $.store.get(HIST_KEY).catch(() => undefined)) ?? []) as Trabajo[]).filter(h => !lista.some(t => t.id === h.id))
    const total = ((await $.store.get(AHORRO_KEY).catch(() => undefined)) ?? { usd: 0, gastoClaude: 0, trabajos: 0 }) as Ahorro
    const ahorroSesion = lista.filter(t => !t.trabajador.startsWith('claude:')).reduce((a, t) => a + costoComoClaude(t.tokensIn, t.tokensOut, t.tokensCache), 0)
    const porModelo = [...deAntes, ...lista].reduce((grupos, t) => {
      const trabajador = t.trabajador
      const previo = grupos.get(trabajador) ?? { trabajador, agente: trabajador.split(':')[0], modelo: trabajador.includes(':') ? trabajador.slice(trabajador.indexOf(':') + 1) : '', trabajos: 0, entradaNueva: 0, cache: 0, salida: 0, _api: 0, _tieneApi: false, costoSonnet: 0, ahorro: 0 }
      const esClaude = trabajador.startsWith('claude:')
      const precio = precioDeTrabajo(t)
      const api = esClaude ? (t.costo ?? 0) : costoApi(t, precio)
      const sonnet = costoComoClaude(t.tokensIn, t.tokensOut, t.tokensCache)
      previo.trabajos++
      previo.entradaNueva += Math.max(0, (t.tokensIn ?? 0) - Math.min(t.tokensIn ?? 0, t.tokensCache ?? 0))
      previo.cache += Math.min(t.tokensIn ?? 0, t.tokensCache ?? 0)
      previo.salida += t.tokensOut ?? 0
      previo._api += api ?? 0
      previo._tieneApi ||= api !== undefined
      previo.costoSonnet += sonnet
      previo.ahorro += api === undefined ? 0 : sonnet - api
      if (precio) previo.precio = precio
      grupos.set(trabajador, previo)
      return grupos
    }, new Map<string, any>())
    const filasCosto = [...porModelo.values()].map(({ _api, _tieneApi, ...fila }) => ({ ...fila, ...(_tieneApi ? { costoApi: _api } : {}) }))
    const apiSesion = lista.reduce((s, t) => {
      const precio = precioDeTrabajo(t)
      return s + (t.trabajador.startsWith('claude:') ? (t.costo ?? 0) : costoApi(t, precio) ?? 0)
    }, 0)
    const sinPrecioSesion = lista.filter(t => {
      if (t.trabajador.startsWith('claude:')) return false
      return !precioDeTrabajo(t)
    }).length
    const costos = { sonnetSesion: ahorroSesion, apiSesion, sinPrecioSesion, apiTotal: total.api ?? 0, sonnetTotal: total.usd, gastoClaude: total.gastoClaude, porModelo: filasCosto }

    const subs = p?.subtareas ?? []
    const hechas = subs.filter(s => s.estado === 'solucionado').length
    const pct = subs.length ? Math.round((hechas / subs.length) * 100) : 0
    const terminados = lista.filter(t => t.ms !== undefined)
    // shortcut: estima lo que falta con el tiempo medio de los trabajos terminados; no sabe si una subtarea es más larga.
    const msMedio = terminados.length ? terminados.reduce((a, t) => a + (t.ms ?? 0), 0) / terminados.length : undefined
    const faltan = subs.length - hechas
    const tokIn = lista.reduce((a, t) => a + (t.tokensIn ?? 0), 0)
    const tokOut = lista.reduce((a, t) => a + (t.tokensOut ?? 0), 0)
    const costo = lista.reduce((a, t) => a + (t.costo ?? 0), 0)
    const seg = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`)
    const icono = { pendiente: '○', en_proceso: '●', realizado: '●', solucionado: '✓' } as const
    const tonoSub = { pendiente: 'lo', en_proceso: 'vino', realizado: 'vino', solucionado: 'hi' } as const
    const tonoTrab = (t: Trabajo): Tono =>
      t.estado === 'error' || (t.puntaje ?? 10) < 6 ? 'vino' : t.puntaje !== undefined ? 'hi' : 'mid'
    const corriendo = lista.filter(t => t.estado === 'corriendo')
    const room = Math.max(3, filasVista - subs.length - corriendo.length - 14)

    // Los mismos datos para la tarjeta SVG y para el texto de la terminal.
    const resumen: Fila[] = [
      ...(p
        ? [{ celdas: ['Progreso', `${hechas}/${subs.length} hechas (${pct}%)`, ...(faltan > 0 && msMedio !== undefined ? [`faltan ${faltan}, ≈${seg(faltan * msMedio)}`] : [])], tono: 'hi' as Tono }]
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
    // El panel solo habla de esta sesión y con pocas palabras; la web conserva `resumen` y el detalle histórico en `costos`.
    const delaSesion = lista.filter(t => !t.trabajador.startsWith('claude:'))
    const cacheSesion = delaSesion.reduce((a, t) => a + Math.min(t.tokensIn ?? 0, t.tokensCache ?? 0), 0)
    const delClaude = lista.filter(t => t.trabajador.startsWith('claude:'))
    const resumenPanel: Fila[] = [
      ...resumen.slice(0, 2),
      ...filasResumenPanelSesion({
        trabajos: lista.length,
        entradaNueva: delaSesion.reduce((a, t) => a + (t.tokensIn ?? 0), 0) - cacheSesion,
        cache: cacheSesion,
        salida: delaSesion.reduce((a, t) => a + (t.tokensOut ?? 0), 0),
        sonnetSesion: costos.sonnetSesion,
        apiSesion: costos.apiSesion,
        sinPrecioSesion: costos.sinPrecioSesion,
        ...(delClaude.length ? { claudeGastado: delClaude.reduce((a, t) => a + (t.costo ?? 0), 0) } : {}),
      }),
    ]
    const secciones: Seccion[] = [
      {
        titulo: 'Subtareas',
        columnas: [16, 52, 380, 560],
        filas: subs.map(s => ({
          celdas: [`${icono[s.estado]} ${s.n}`, conSkills(encargos.get(s.n)?.skills, s.titulo), corto(s.quien ?? '', 22), s.puntaje !== undefined ? `${s.puntaje}/10` : s.estado === 'realizado' ? 'en_proceso' : s.estado],
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
    // El panel pinta una línea por fila (sin columnas): subtareas y las últimas 4 del historial, con el texto entero.
    const seccionesPanel: Seccion[] = [
      {
        titulo: 'Subtareas',
        columnas: [],
        // Cada subtarea ocupa dos filas: la línea con su estado y, debajo en gris, el detalle que el título descarta.
        filas: subs.flatMap(s => {
          const estado = s.estado === 'realizado' ? 'en_proceso' : s.estado
          const linea = `${icono[s.estado]} ${s.n}  ${tituloCorto(s.titulo)} · ${estado}${s.puntaje !== undefined ? ` · ${s.puntaje}/10` : ''}`
          const detalle = descripcionCorta(s.titulo)
          return [
            { celdas: [linea], tono: tonoSub[s.estado] },
            ...(detalle ? [{ celdas: [`   ${detalle}`], tono: 'lo' as Tono }] : []),
          ]
        }),
        vacio: 'sin subtareas',
      },
      {
        titulo: 'Historial',
        columnas: [],
        // Dos filas por entrada: la línea del historial y, debajo en gris, la tarea en pocas palabras.
        filas: [...deAntes, ...terminados].sort((a, b) => a.inicio - b.inicio).slice(-4).flatMap(t => {
          const tarea = tareaLimpia(t.tarea)
          return [
            { celdas: [lineaHistorial(t)], tono: tonoTrab(t) },
            ...(tarea ? [{ celdas: [`   ${tarea}`], tono: 'lo' as Tono }] : []),
          ]
        }),
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
      p, pct, resumen, resumenPanel, secciones, seccionesPanel, lectura, kpis, costos,
      figuraSvg: figura({ bahias, subtareas: subs.map(s => s.estado), contexto: ctx.percent, titulo, lectura }),
      figuraPanelSvg: figura({ bahias, subtareas: subs.map(s => s.estado), contexto: ctx.percent, titulo, lectura }, { marco: false }),
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
let barraEstado: { cancel(): void } | undefined

// --- Autoactualización: las sesiones cargan una copia instalada del plugin; si el repositorio publicado (el marketplace
// centro-mst) tiene una versión más nueva, se actualiza la copia para las sesiones que se abran después. ---

const MARKETPLACE = 'centro-mst'
const ULTIMA_BUSQUEDA_KEY = 'ultimaBusquedaActualizacion'

export function esMasNueva(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

// Agentes trabajando ahora en CUALQUIER chat de esta máquina: actualizar el plugin recarga las sesiones y no hay que hacerlo con ellos en marcha.
export async function agentesVivos($: EngineInterface): Promise<number> {
  const raiz = `${await carpetaWeb($)}/chats`
  let vivos = 0
  for (const chat of await $.fs.list(raiz).catch(() => [])) {
    if (chat.kind !== 'dir') continue
    const carpeta = `${raiz}/${chat.name}/trabajos`
    const nombres = (await $.fs.list(carpeta).catch(() => [])).map(e => e.name)
    for (const n of nombres.filter(x => x.endsWith('.pid.json'))) {
      const id = n.slice(0, -'.pid.json'.length)
      const pid = await $.fs.read(`${carpeta}/${n}`).then(s => JSON.parse(s) as { inicio?: number }).catch(() => undefined)
      if (agenteVivo(pid, nombres.includes(`${id}.fin.json`), Date.now())) vivos++
    }
  }
  return vivos
}

let reintentoActualizacion = false

async function autoactualizar($: EngineInterface) {
  // Sin la marca BOM: algunos editores de Windows la ponen y JSON.parse falla con ella.
  const version = (texto: string) => (JSON.parse(texto.replace(/^﻿/, '')) as { version?: string }).version ?? '0'
  const mia = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(version).catch(() => undefined)
  // Cargado directamente desde la carpeta del proyecto (desarrollo), o buscado hace poco: nada que hacer.
  const ultima = await $.store.get(ULTIMA_BUSQUEDA_KEY).catch(() => undefined)
  if (!mia || !debeBuscarActualizacion($.plugin.root, typeof ultima === 'number' ? ultima : undefined, Date.now())) return
  // Con agentes trabajando en algún chat no se toca nada: se vuelve a mirar en 5 min, sin gastar la búsqueda de las 6 horas.
  if (await agentesVivos($)) {
    if (!reintentoActualizacion) {
      reintentoActualizacion = true
      $.clock.after(5 * 60_000, () => { reintentoActualizacion = false; void autoactualizar($).catch(() => undefined) })
    }
    return
  }
  await $.store.set(ULTIMA_BUSQUEDA_KEY, Date.now())
  const ok = (r: { exitCode: number | null }) => r.exitCode === 0
  // Sin internet o sin acceso al repositorio: se sigue con lo que hay, sin avisar.
  if (!(await $.process.run(['claude', 'plugin', 'marketplace', 'update', MARKETPLACE], { timeoutMs: 120_000 }).then(ok).catch(() => false))) return
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  if (!casa) return
  // La versión publicada es la que trae la copia del marketplace que se acaba de refrescar.
  const fuente = await $.fs.read(`${casa}/.claude/plugins/marketplaces/${MARKETPLACE}/.claude-plugin/plugin.json`).then(version).catch(() => undefined)
  if (!fuente || !esMasNueva(fuente, mia)) return
  const up = await $.process.run(['claude', 'plugin', 'update', `centro-agentes@${MARKETPLACE}`], { timeoutMs: 120_000 }).then(ok).catch(() => false)
  $.ui.toast(up
    ? `${TITULO} actualizado de ${mia} a ${fuente}: reinicia esta sesión para usar lo nuevo.`
    : `${TITULO}: hay una versión nueva (${fuente}) pero no se pudo actualizar; ejecuta claude plugin update centro-agentes@centro-mst.`)
}

// Nunca rechaza: se llama sin esperar desde temporizadores y cierres, y el estado puede no estar ya (fin de sesión).
async function actualizarBarra($: EngineInterface) {
  try {
    const lista = ((await read($, trabajos)) ?? []) as Trabajo[]
    const vivos = lista.filter(t => t.estado === 'corriendo').map((t): TrabajoVivo => ({
      id: t.id,
      trabajador: t.trabajador,
      estado: t.estado,
      inicio: t.inicio,
      ultimaActividad: t.ultimaActividad,
      subtarea: t.subtarea,
      tarea: t.tarea,
    }))
    const encargosLista = registro.todos()
    const texto = pistaPanel(textoBarra(vivos, encargosLista, Date.now(), AMARILLO_MS_POR_DEFECTO), panelCerradoAMano)
    if (texto) $.ui.status(texto)
    else $.ui.status(undefined)
  } catch {}
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

let catalogoMemoria: Catalogo | undefined
let catalogoLeidoEn = 0
let catalogoLeyendo: Promise<Catalogo | undefined> | undefined
// Solo para pruebas: olvida el catálogo leído para que cada una lea el suyo del disco simulado.
export function reiniciarCatalogoParaPruebas(): void {
  catalogoMemoria = undefined
  catalogoLeidoEn = 0
  catalogoLeyendo = undefined
}
export async function leerCatalogoPlugin($: EngineInterface): Promise<Catalogo | undefined> {
  // Las tareas en paralelo comparten la misma lectura: si una vuelve antes que otra, cambia el reparto de modelos.
  if (catalogoLeyendo) return catalogoLeyendo
  if (Date.now() - catalogoLeidoEn < 60_000) return catalogoMemoria
  catalogoLeidoEn = Date.now()
  catalogoLeyendo = (async () => {
    try {
      const c = JSON.parse(await $.fs.read(`${await carpetaWeb($)}/catalogo.json`))
      catalogoMemoria = c?.version === 2 ? c : undefined
    } catch { catalogoMemoria = undefined }
    finally { catalogoLeyendo = undefined }
    return catalogoMemoria
  })()
  return catalogoLeyendo
}

export async function refrescarCatalogo($: EngineInterface, modelos: Modelos, enLinea: boolean): Promise<void> {
  try {
    let raiz = ''
    try { raiz = $.plugin.root } catch {}
    const flujo = $.process.spawn({ argv: ['node', `${raiz}/mcp/catalogo.mjs`, 'actualizar', ...(!enLinea ? ['--sin-linea'] : [])], input: JSON.stringify(modelos) })
    for await (const _parte of flujo) {}
    await flujo.result
  } catch {}
  catalogoLeidoEn = 0
  catalogoLeyendo = undefined
  await leerCatalogoPlugin($).catch(() => undefined)
}

// --- El cerebro global: lo aprendido en todos los chats (~/.centro-agentes/cerebro.json) ---
async function leerCerebro($: EngineInterface): Promise<Cerebro> {
  try {
    const g = JSON.parse(await $.fs.read(`${await carpetaWeb($)}/cerebro.json`))
    return Array.isArray(g?.experiencias) ? g : { experiencias: [] }
  } catch {
    return { experiencias: [] }
  }
}
// Cada vez que el jefe puntúa un trabajo, el cerebro apunta qué se hizo, quién lo hizo y qué nota sacó.
async function anotarCerebro($: EngineInterface, t: Trabajo, nota: number, leccion?: string) {
  const [agente, ...modelo] = t.trabajador.split(':')
  const c = registrar(await leerCerebro($), { en: Date.now(), area: t.categoria, tarea: t.tarea, agente: agente!, modelo: modelo.join(':'), nota, ms: t.ms, tokens: (t.tokensIn ?? 0) + (t.tokensOut ?? 0), chat: etiquetaChat(carpetaProyecto, nombreChat), leccion })
  await $.fs.write(`${await carpetaWeb($)}/cerebro.json`, JSON.stringify(c)).catch(() => undefined)
}

// --- Un centro por chat, guardado en disco para sobrevivir a un cierre o un fallo ---

// El id del chat (`$.session.id()`); se fija al empezar la sesión.
let SID = 'local'
// Para distinguir los chats en la web: la carpeta del proyecto y el nombre del chat
// (su título si Claude Code lo da; si no, el primer mensaje que escribes en él).
let carpetaProyecto = ''
// Ruta completa del proyecto: donde trabajan los agentes cuando el encargo viene de la web.
let rutaProyecto = ''
async function tareasArchivo($: EngineInterface, orden: 'aplicar' | 'resumen' | 'leer', raiz: string, op?: unknown): Promise<any> {
  const nombre = raiz.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  try {
    // El harness rechaza el encadenamiento opcional sobre $.plugin durante la carga del hook.
    let pluginRoot = ''
    try { pluginRoot = $.plugin.root } catch {}
    const argv = ['node', `${pluginRoot}/mcp/tareas.mjs`, orden, raiz, '--proyecto', nombre]
    const flujo = $.process.spawn({ argv, cwd: raiz, input: op ? JSON.stringify(op) : undefined })
    let stdout = ''
    for await (const parte of flujo) if (parte.stream === 'stdout') stdout += parte.text
    const fin = await flujo.result
    const linea = stdout.trim().split(/\r?\n/).at(-1)
    if (fin?.code !== 0) return { ok: false, codigo: 'script', mensaje: `El script terminó con código ${fin?.code ?? 'desconocido'}` }
    try { return JSON.parse(linea ?? '') } catch { return { ok: false, codigo: 'script', mensaje: 'El script no devolvió JSON válido' } }
  } catch (e) {
    return { ok: false, codigo: 'script', mensaje: String(e) }
  }
}
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

type Guardado = { plan: Plan | null; planes?: Plan[]; trabajos: Trabajo[]; encargos: [number, Encargo][]; nombre?: string; registro?: RegistroGuardado }
let ultimoGuardado = ''

// Guarda plan, trabajos y encargos del chat cuando cambian (se llama cada 2 s).
async function guardarEstado($: EngineInterface) {
  const estado: Guardado = { plan: (await read($, plan)) ?? null, planes: (await read($, planes)) ?? [], trabajos: (await read($, trabajos)) ?? [], encargos: [...encargos], nombre: nombreChat, registro: registro.exportar() }
  // La salida en vivo cambia a cada momento y no hace falta para recuperar el centro.
  const texto = JSON.stringify({ ...estado, trabajos: estado.trabajos.map(t => ({ ...t, salida: t.estado === 'corriendo' ? undefined : t.salida })) })
  if (texto === ultimoGuardado) return
  ultimoGuardado = texto
  await $.fs.write(`${await carpetaChat($)}/estado.json`, texto).catch(() => undefined)
}

// Lo que se recupera de un estado guardado: los trabajos que estaban en marcha quedan interrumpidos
// (sus procesos murieron con el chat) y sus subtareas vuelven a pendiente para poder relanzarlas.
export function recuperar(g: Guardado): Guardado & { interrumpidos: number } {
  // Un trabajo con lanzador sigue en disco aunque el plugin se recargue: se reengancha en vez de darlo por interrumpido.
  const corriendo = g.trabajos.filter(t => t.estado === 'corriendo' && !t.lanzador)
  const subs = new Set(corriendo.map(t => t.subtarea).filter((n): n is number => n !== undefined))
  return {
    plan: g.plan ? { ...g.plan, subtareas: g.plan.subtareas.map(s => { const estado = estadoSubtareaNuevo(s.estado); return estado === 'en_proceso' && subs.has(s.n) ? { ...s, estado: 'pendiente' as const } : { ...s, estado } }) } : null,
    trabajos: g.trabajos.map(t => (t.estado === 'corriendo' && !t.lanzador ? { ...t, estado: 'error' as const, salida: '[interrumpido: el chat se cerró mientras trabajaba]' } : t)),
    planes: (g.planes ?? []).map(p => ({ ...p, subtareas: p.subtareas.map(s => ({ ...s, estado: estadoSubtareaNuevo(s.estado) })) })),
    encargos: g.encargos,
    interrumpidos: corriendo.length,
  }
}

export function estadosInterrumpidos(g: Guardado): { id: string; estado: 'pendiente' }[] {
  if (!g.plan?.tarea) return []
  return [...new Set(g.trabajos.filter(t => t.estado === 'corriendo' && !t.lanzador && t.subtarea !== undefined).map(t => t.subtarea!))]
    .map(n => ({ id: `${g.plan!.tarea}.${n}`, estado: 'pendiente' as const }))
}

const reenganchados = new Set<string>()

// Tras recargar el plugin, los agentes que seguían bajo su lanzador se reencuentran por sus archivos en disco.
async function reengancharPendientes($: EngineInterface) {
  const lista = ((await read($, trabajos)) ?? []).filter(t => t.estado === 'corriendo' && t.lanzador && !cortadores.has(t.id) && !reenganchados.has(t.id))
  for (const t of lista) {
    reenganchados.add(t.id)
    void reenganchar($, t).catch(() => undefined)
  }
}

// Sigue a un agente que arrancó el plugin anterior: espera su fin, cierra el trabajo y su encargo y avisa al jefe UNA vez.
// No cambia de modelo ni cierra la copia aislada ni corre 'verificar': eso lo decide el jefe con lo que le cuenta el aviso.
async function reenganchar($: EngineInterface, t: Trabajo) {
  const { carpeta, id, cwd } = t.lanzador!
  const limite = Math.max(60_000, (contexto?.timeoutMs ?? 8 * 60_000) - (Date.now() - t.inicio))
  const c = await esperarArchivos($, { carpeta, id, timeoutMs: limite, trabajoId: t.id }, () => {
    update($, trabajos, l => (l ?? []).map(x => (x.id === t.id ? { ...x, ultimaActividad: Date.now() } : x))).catch(() => {})
  }, cortar => cortadores.set(t.id, cortar))
  cortadores.delete(t.id)
  const agente = t.trabajador.split(':')[0] as Trabajador
  const { s, ok } = interpretarSalida(agente, c)
  // La duración real es fin del lanzador menos el inicio, no "ahora - inicio": el reencuentro puede ser horas después.
  const ms = c.fin ? c.fin - t.inicio : Date.now() - t.inicio
  await update($, trabajos, l => (l ?? []).map(x => (x.id === t.id ? { ...x, estado: ok ? 'listo' : 'error', ms, tokensIn: s.tokensIn, tokensCache: s.tokensCache, tokensOut: s.tokensOut, ventana: s.ventana, costo: s.costo, salida: s.texto.slice(-1500) } : x)))
  const hecho = ((await read($, trabajos)) ?? []).find(x => x.id === t.id)
  if (hecho) await guardarEnHistorial($, hecho).catch(() => undefined)
  if (t.subtarea !== undefined) {
    registro.registrarFin(t.subtarea, ok)
    if (!ok) await marcar($, t.subtarea, { estado: 'pendiente' }).catch(() => undefined)
  }
  const resultado = {
    id: t.id, ...(t.subtarea === undefined ? {} : { subtarea: t.subtarea }), trabajador: t.trabajador, exito: ok, segundos: Math.round(ms / 1000),
    tokens: { entrada: s.tokensIn ?? 0, salida: s.tokensOut ?? 0, ...(s.tokensCache === undefined ? {} : { cache: s.tokensCache }) }, salida: s.texto.slice(-3000), reenganchado: true,
    aviso: `Resultado recuperado tras recargar el plugin: el centro no cerró la copia aislada ni corrió 'verificar'${cwd ? `; el agente trabajó en ${cwd}: revisa sus cambios con git y júntalos tú si están bien` : ''}. No se probó otro modelo; si falló, decide tú si relanzar.`,
    ...(cwd ? { carpeta: cwd } : {}),
  }
  const encargo = t.encargo ? registro.obtener(t.encargo) : undefined
  if (encargo && (encargo.estado === 'corriendo' || encargo.estado === 'en_cola')) {
    registro.marcar(encargo.id, ok ? 'terminado' : 'fallido', { trabajoId: t.id, resultado }, Date.now())
    void actualizarBarra($)
    if (registro.avisarGrupo(encargo.grupo) && hayQueAuditar(encargo.grupo)) await avisarGrupo($, encargo.grupo)
    return
  }
  void actualizarBarra($)
  void $.prompt.submit({ text: `[Centro de agentes MST] Tras recargar el plugin, ${t.trabajador} ${ok ? 'terminó' : 'falló'} (trabajo ${t.id}). ${resultado.aviso}\nSalida: ${resultado.salida.slice(-600)}` }).catch(() => undefined)
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
  // Los encargos asíncronos (eN, gN) viven en memoria: se recuperan aunque el estado de la sesión siga ahí.
  if (!registro.todos().length) registro.importar(g.registro)
  void actualizarBarra($)
  // Tras una recarga del mod el estado sigue en memoria: solo se recupera si está vacío.
  if ((await read($, plan)) || ((await read($, trabajos)) ?? []).length) {
    await reengancharPendientes($)
    return
  }
  const r = recuperar(g)
  await update($, plan, () => r.plan)
  await update($, planes, () => r.planes ?? [])
  await update($, trabajos, () => r.trabajos)
  for (const [n, e] of r.encargos) encargos.set(n, e)
  if (r.plan?.raiz) {
    for (const op of estadosInterrumpidos(g)) {
      const guardado = await tareasArchivo($, 'aplicar', r.plan.raiz, { tipo: 'estado', ...op })
      if (!guardado.ok) $.ui.toast(`${TITULO}: no se pudo restaurar la subtarea ${op.id} en mst-tareas.json: ${guardado.mensaje ?? guardado.codigo}`)
    }
  }
  if (r.interrumpidos) $.ui.toast(`${TITULO}: recuperado. ${r.interrumpidos} trabajo(s) quedaron interrumpidos; relánzalos desde la web o con /mst.`)
  await reengancharPendientes($)
  void actualizarBarra($)
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
  // Relevo: si el servidor que escucha es de una versión más vieja (o anterior a /version), se cierra y arranca este.
  const mia = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(t => (JSON.parse(t.replace(/^﻿/, '')) as { version?: string }).version ?? '0').catch(() => '0')
  const suya = await $.process.run(['curl.exe', '-s', '--max-time', '2', `http://127.0.0.1:${PUERTO_WEB}/version`], { timeoutMs: 5000 }).then(r => r.stdout.trim()).catch(() => '')
  if (suya && esMasNueva(mia, /^[\d.]+$/.test(suya) ? suya : '0'))
    await $.process
      .run(['powershell', '-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*servidor.js*${PUERTO_WEB}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { timeoutMs: 15_000 })
      .catch(() => undefined)
  // La vista común de todos los chats es una página fija que el servidor lee junto a la carpeta de chats.
  await $.fs.write(`${dir}/todos.html`, paginaTodosGrafo(mia)).catch(() => undefined)
  const argv = ['node', `${$.plugin.root}/web/servidor.js`, String(PUERTO_WEB), `${dir}/clave.txt`, `${dir}/chats`, mia]
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
// Exportada para las pruebas.
export async function atenderAcciones($: EngineInterface) {
  const texto = await $.fs.read(`${await carpetaChat($)}/acciones.jsonl`).catch(() => '')
  if (leidoHasta < 0) {
    // Al arrancar se ignoran las órdenes viejas.
    leidoHasta = texto.length
    return
  }
  const nuevas = texto.slice(leidoHasta)
  leidoHasta = texto.length
  for (const linea of nuevas.split('\n')) {
    let a: { tipo: string; id?: string; n?: number; agente?: Trabajador; texto?: string; modelo?: string }
    try {
      a = JSON.parse(linea)
    } catch {
      continue
    }
    if (a.tipo === 'cancelar' && a.id) cortadores.get(a.id)?.(CANCELADO)
    if (a.tipo === 'relanzar' && a.n !== undefined && encargos.has(a.n) && contexto) void relanzar($, a.n)
    if (a.tipo === 'encargar' && a.agente && a.texto && TRABAJADORES.includes(a.agente) && contexto) void encargarDesdeWeb($, a.agente, a.texto, a.n, a.modelo)
    // Un mensaje para el jefe: entra en esta sesión de Claude como un mensaje más (espera a que la sesión esté libre).
    if (a.tipo === 'jefe' && a.texto) void $.prompt.submit({ text: `[Mensaje del usuario desde el tablero] ${a.texto}` }).catch(() => undefined)
    // Una propuesta de modelo desde la web: se la pasa al jefe para que la pruebe cuando encaje.
    // El patrón se comprueba siempre; si ya hay contexto, además el modelo debe estar en la lista del agente.
    if (a.tipo === 'proponer' && a.agente && a.modelo && TRABAJADORES.includes(a.agente) && /^[\w.:\/@+-]{1,120}$/.test(a.modelo) && (!contexto || (contexto.modelos[a.agente] ?? []).includes(a.modelo))) {
      $.ui.toast(`Propuesta enviada al jefe: ${a.agente}:${a.modelo}`)
      void $.prompt.submit({ text: `[Centro de agentes MST] El usuario propone probar el modelo ${a.modelo} (agente ${a.agente}) en la próxima tarea que le encaje. Compruébalo con la herramienta modelos, úsalo con delegar (campo modelo) cuando corresponda y puntúalo al auditar para que el cerebro aprenda.` }).catch(() => undefined)
    }
  }
}

// Una instrucción escrita en el tablero para una terminal concreta, opcionalmente ligada a una subtarea del plan.
async function encargarDesdeWeb($: EngineInterface, agente: Trabajador, texto: string, n?: number, modelo?: string) {
  if (!contexto) return
  const sub = n !== undefined ? ((await read($, plan))?.subtareas ?? []).find(s => s.n === n) : undefined
  const tarea = sub ? `${texto}\n\nContexto: esto es parte de la subtarea ${sub.n} del plan: "${sub.titulo}".` : texto
  $.ui.toast(`Encargo desde el tablero para ${agente}${sub ? ` (subtarea ${sub.n})` : ''}`)
  const r = await delegarUno($, contexto.modelos, { trabajador: agente, modelo, categoria: 'manual', tarea, subtarea: sub?.n, cwd: rutaProyecto || undefined }, contexto.timeoutMs)
  void $.prompt.submit({
    text: `[Centro de agentes MST] El usuario le encargó a ${agente} desde el tablero${sub ? ` la subtarea ${sub.n}` : ''}: "${corto(texto, 200)}". Verifica este resultado y registra su puntaje con registrar_auditoria:\n\n${JSON.stringify(r, null, 1)}`,
  }).catch(() => undefined)
}

// Relanza una subtarea con su último encargo y pasa el resultado a Claude para que lo verifique.
async function relanzar($: EngineInterface, n: number) {
  const encargo = encargos.get(n)
  if (!encargo || !contexto) return
  $.ui.toast(`Relanzando la subtarea ${n} desde la web`)
  const r = await delegarUno($, contexto.modelos, encargo, contexto.timeoutMs)
  void $.prompt.submit({
    text: `[Centro de agentes MST] Relancé desde la web la subtarea ${n}. Verifica este resultado como de costumbre y registra su puntaje con registrar_auditoria:\n\n${JSON.stringify(r, null, 1)}`,
  }).catch(() => undefined)
}

// Aviso al terminar: mensaje en la app, sonido de Windows y (en la web) notificación del navegador.
let avisadoPara = ''
async function avisarSiTermino($: EngineInterface) {
  const p = await read($, plan)
  if (!p || !p.subtareas.length || p.subtareas.some(s => s.estado !== 'solucionado') || avisadoPara === p.objetivo) return
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
    relanzables: subs.filter(s => s.estado !== 'en_proceso' && s.estado !== 'realizado' && encargos.has(s.n)).map(s => ({ n: s.n, titulo: corto(s.titulo, 40) })),
    listo: subs.length > 0 && subs.every(s => s.estado === 'solucionado') ? (await read($, plan))!.objetivo : undefined,
  }
  const chat = etiquetaChat(carpetaProyecto, nombreChat)
  // Lado a lado, cada figura recibe un ancho proporcional a su relación de aspecto: así las dos miden lo mismo de alto.
  const alto = (svg: string) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)?.[1] ?? 380)
  const ahorro = lista.filter(t => !t.trabajador.startsWith('claude:')).reduce((s, t) => s + costoComoClaude(t.tokensIn, t.tokensOut), 0)
  const tablaPuntajes = ((await $.store.get(STORE_KEY)) ?? {}) as Puntajes
  // La caché de leerCatalogoPlugin (60 s) evita leer el archivo en cada refresco de 2 s.
  const catalogo = await leerCatalogoPlugin($)
  await $.fs.write(await rutaWeb($), paginaCentro({
    clave: controles.clave,
    chat,
    jefe: 'Claude',
    plan: (await read($, plan)) ?? null,
    planes: (await read($, planes)) ?? [],
    trabajos: lista,
    agentes: contexto ? estadoAgentes(contexto.modelos, Date.now(), tokensClaude(lista)) : [],
    modelos: contexto?.modelos ?? {},
    rendimiento: agregarRendimiento(tablaPuntajes),
    ahorro,
    cancelables: controles.cancelables,
    relanzables: controles.relanzables,
    pendientes: await pendientesDe($, lista),
    costos: a.costos,
    // Sin catálogo la página muestra "Aún no hay catálogo" en lugar de la sección de modelos.
    catalogo: {
      ...(catalogo?.generado ? { generado: catalogo.generado } : {}),
      filas: filasModelos(catalogo, tablaPuntajes),
      fallos: (catalogo?.fuentes ?? []).filter(f => !f.ok).map(f => `${f.nombre}: ${f.nota ?? 'sin respuesta'}`),
    },
    version: await versionDelPlugin($),
    extra: a.figuraSvg + a.tableroSvg,
    columnasExtra: `${(640 / alto(a.figuraSvg)).toFixed(3)}fr ${(640 / alto(a.tableroSvg)).toFixed(3)}fr`,
  }))
}
const versionCache = new Map<string, string>()
async function versionDelPlugin($: EngineInterface) {
  const dir = $.plugin.root
  if (!versionCache.has(dir)) versionCache.set(dir, await $.fs.read(`${dir}/.claude-plugin/plugin.json`).then(t => (JSON.parse(t.replace(/^\uFEFF/, '')) as { version?: string }).version ?? '?').catch(() => '?'))
  return versionCache.get(dir)!
}
// Abre la página en el navegador predeterminado: servida por el servidor local (con botones). explorer no da un código útil.
async function abrirNavegador($: EngineInterface) {
  await $.process.run(['explorer', await urlWeb($)]).catch(() => undefined)
}

// Mantiene la página al día cada 2 s mientras la vista web está encendida, y atiende los botones.
function encenderWeb($: EngineInterface) {
  if (web) return
  void lanzarServidor($).catch(() => undefined)
  void escribirWeb($).catch(() => undefined)
  // Un fallo de una vuelta (archivo bloqueado, sesión cerrándose) no debe tumbar las siguientes.
  web = $.clock.every(2000, async () => {
    await lanzarServidor($).catch(() => undefined)
    await atenderAcciones($).catch(() => undefined)
    await escribirWeb($).catch(() => undefined)
  })
}

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
  (['opencode', 'ollama', 'hermes', 'aider', 'codex', 'claude'] as const).flatMap(t => m[t].map(modelo => ({ trabajador: t, modelo })))


// Lo que dijo el agente (texto y tokens) y si salió bien, a partir de lo que dejó su proceso.
function interpretarSalida(agente: Trabajador, r: Corrida): { s: Salida; ok: boolean } {
  const s =
    agente === 'ollama' ? leerOllama(r.stdout, r.stderr)
    : agente === 'opencode' ? leerOpencode(r.stdout)
    : agente === 'hermes' ? leerHermes(r.stdout)
    : agente === 'aider' ? leerAider(r.stdout)
    : agente === 'codex' ? leerCodex(r.stdout)
    : leerClaude(r.stdout)
  // opencode puede salir con 0 aunque el proveedor haya devuelto un error y nada de texto.
  const ok = r.exitCode === 0 && !/^\[error\]/.test(s.texto.trim()) && (!['hermes', 'aider', 'codex'].includes(agente) || !!s.texto)
  // ollama escribe sus estadísticas en stderr y hermes su session_id: solo se enseñan si algo falló.
  const err = ['ollama', 'hermes', 'aider', 'codex'].includes(agente) ? (ok ? '' : sinAnsi(r.stderr).trim()) : r.stderr
  s.texto = `${s.texto}${err ? `\n[stderr]\n${err.slice(-3000)}` : ''}`.trim()
  if (r.isStdoutTruncated) s.texto += '\n[salida truncada]'
  return { s, ok }
}

// Ejecuta la tarea con un trabajador y modelo, y deja su fila en el historial.
async function intentar(
  $: EngineInterface,
  c: Candidato,
  input: { categoria: string; tarea: string; subtarea?: number; cwd?: string; skills?: string[]; clasificacion?: Trabajo['clasificacion']; encargoId?: string },
  timeoutMs: number,
): Promise<Intento> {
  const quien = clave(c.trabajador, c.modelo)
  const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`
  const t0 = Date.now()
  const trabajo: Trabajo = { id, trabajador: quien, categoria: input.categoria, tarea: corto(input.tarea), instruccion: input.tarea.slice(0, 1500), estado: 'corriendo', inicio: t0, subtarea: input.subtarea, skills: input.skills?.length ? input.skills : undefined, clasificacion: input.clasificacion, ultimaActividad: t0, plan: (await read($, plan))?.objetivo, ...(input.encargoId ? { encargo: input.encargoId } : {}), ...(lanzadorDesacoplado ? { lanzador: { carpeta: `${await carpetaChat($)}/trabajos`, id, ...(input.cwd ? { cwd: input.cwd } : {}) } } : {}) }
  await update($, trabajos, l => [...(l ?? []), trabajo].slice(-50))
  await update($, plan, p => p ? { ...p, subtareas: p.subtareas.map(s => s.n === input.subtarea ? { ...s, estado: 'en_proceso', quien } : s) } : p)
  void actualizarBarra($)
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
    // --standalone: con el servicio compartido de OpenCode, la carpeta de una copia aislada queda abierta y no se puede borrar.
    // La tarea va por stdin: como argumento, el shim .cmd de Windows la corta en el primer salto de línea y el agente trabaja sin instrucciones.
    argv = ['opencode', 'run', '--standalone', '--format', 'json', ...(c.modelo ? ['-m', c.modelo] : [])]
    // Con las herramientas preguntar y pedir_permiso (las trae el servidor MCP del centro), el agente sabe cuándo usarlas.
    stdin = `${input.tarea}

${PROTOCOLO_AGENTE}`
  } else if (c.trabajador === 'hermes') {
    // "proveedor/modelo": el proveedor es el de config.yaml (ollama-local = tu Ollama con sesión iniciada, sin clave).
    const corte = c.modelo.indexOf('/')
    const [proveedor, modelo] = corte > 0 ? [c.modelo.slice(0, corte), c.modelo.slice(corte + 1)] : ['auto', c.modelo]
    argv = [await hermesExe($), 'chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--yolo', '--provider', proveedor, '-m', modelo]
    // Las herramientas preguntar y pedir_permiso las trae la entrada centro-agente de mcp_servers en su config.yaml (ver el README).
    stdin = `${input.tarea}

${PROTOCOLO_AGENTE}`
  } else if (c.trabajador === 'aider') {
    // --no-git: no hace commits en tu repo; --yes-always: no se queda esperando confirmaciones.
    // Aider solo edita los archivos que recibe en la línea de comandos: se le pasan los que nombra la tarea y existen.
    const nombrados = [...new Set(input.tarea.match(/[\w./\\-]+\.[A-Za-z]\w{0,5}\b/g) ?? [])]
    const archivos = input.cwd ? (await Promise.all(nombrados.map(async a => ((await $.fs.exists(`${input.cwd}/${a}`).catch(() => false)) ? a : '')))).filter(Boolean) : []
    argv = [await aiderExe($), ...archivos, '--model', c.modelo, '--message', input.tarea,'--yes-always', '--no-git', '--no-pretty', '--no-stream', '--no-check-update', '--no-show-model-warnings', '--no-analytics', '--input-history-file', 'NUL', '--chat-history-file', 'NUL']
  } else if (c.trabajador === 'codex') {
    // --json: un evento por línea. danger-full-access: en Windows su sandbox le impide escribir y ejecutar;
    // trabaja en su carpeta (o en su copia aislada), como los demás agentes. La tarea va por stdin.
    const local = c.modelo.startsWith('ollama/') ? ['--oss', '--local-provider', 'ollama', '-m', c.modelo.slice('ollama/'.length)] : c.modelo && c.modelo !== 'chatgpt' ? ['-m', c.modelo] : []
    argv = ['codex', 'exec', '--json', '--sandbox', 'danger-full-access', '--skip-git-repo-check', ...mcpCodex($), ...local]
    stdin = `${input.tarea}

${PROTOCOLO_AGENTE}`
  } else {
    // La tarea va por stdin: como argumento, el shim .cmd de Windows la corta en el primer salto de línea.
    // acceptEdits: sin él, claude -p no puede escribir archivos y el encargo se pierde (tests y comandos los corre el centro con "verificar").
    argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', c.modelo]
    stdin = input.tarea
  }

  let s: Salida
  let ok = false
  try {
    // La marca de actividad se escribe como mucho una vez por segundo: la salida llega a trozos y no hace falta más precisión.
    let marcado = t0
    const r = await ejecutar($, argv, { cwd: input.cwd, stdin, timeoutMs, trabajoId: id }, out => {
      crudo = out
      const ahora = Date.now()
      if (ahora - marcado < 1000) return
      marcado = ahora
      update($, trabajos, l => (l ?? []).map(t => (t.id === id ? { ...t, ultimaActividad: ahora } : t))).catch(() => {})
    }, cortar => cortadores.set(id, cortar))
    const leido = interpretarSalida(c.trabajador, r)
    s = leido.s
    ok = leido.ok
  } catch (err) {
    s = { texto: `No se pudo ejecutar ${argv[0]}: ${String(err)}` }
  } finally {
    latido.cancel()
  }
  const ms = Date.now() - t0
  await update($, trabajos, l =>
    (l ?? []).map(t => (t.id === id ? { ...t, estado: ok ? 'listo' : 'error', ms, tokensIn: s.tokensIn, tokensCache: s.tokensCache, tokensOut: s.tokensOut, ventana: s.ventana, costo: s.costo, salida: s.texto.slice(-1500) } : t)),
  )
  void actualizarBarra($)
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

// Con la skill ponytail, el encargo lleva también el mapa del código de su carpeta de trabajo: qué funciones y clases hay ya, para reutilizarlas
// en vez de escribir otras. Lo genera un script de ponytail (local, sin red ni modelo) que vive en ~/.centro-agentes/ponytail; si no está, el encargo sale sin mapa.
async function mapaDelCodigo($: EngineInterface, cwd: string): Promise<string> {
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  if (!casa) return ''
  const guion = `${casa}/.centro-agentes/ponytail/ponytail-map.js`
  if (!(await $.fs.exists(guion).catch(() => false))) return ''
  const r = await $.process.run(['node', guion], { cwd, timeoutMs: 5000 }).catch(() => undefined)
  const mapa = r && r.exitCode === 0 ? r.stdout.trim() : ''
  return mapa ? '\n\n' + mapa : ''
}

// El aviso de que falta ponytail, una sola vez: lo que se descargaría y dónde. El plugin no descarga nada (lo hace mcp/instalar-ponytail.mjs si el usuario acepta).
const AVISO_PONYTAIL_KEY = 'ponytailAvisado'
async function avisoPonytail($: EngineInterface): Promise<string> {
  if (!skillsAuto || (await $.store.get(AVISO_PONYTAIL_KEY).catch(() => undefined))) return ''
  const casa = await $.env.get('USERPROFILE').catch(() => undefined)
  if (!casa) return ''
  const faltan: string[] = []
  for (const n of ['ponytail', 'ponytail-review', 'ponytail-audit']) if (!(await rutaSkill($, n))) faltan.push(n)
  if (!(await $.fs.exists(`${casa}/.centro-agentes/ponytail/ponytail-map.js`).catch(() => false))) faltan.push('mapa')
  if (!faltan.length) return ''
  await $.store.set(AVISO_PONYTAIL_KEY, true)
  return '\n\n' + textoAvisoPonytail(faltan, `${$.plugin.root}/mcp/instalar-ponytail.mjs`)
}

type Encargo = {
  trabajador?: Trabajador | 'auto'; modelo?: string; categoria: string; tarea: string; subtarea?: number; cwd?: string; skills?: string[]; necesita?: Capacidad[]
  /** No añadir solas las skills de ponytail a este encargo (el centro las pone según la clase de tarea) */
  sin_skills_automaticas?: boolean
  /** Trabajar en una copia aislada (git worktree) del repo de cwd, en su propia rama */
  aislar?: boolean
  /** Comando que comprueba el resultado (p. ej. npm test), ejecutado en la carpeta donde trabajó el agente */
  verificar?: string
  /** Carpeta compartida (sin aislar): archivos o carpetas que este agente puede tocar; sin esto se reserva todo el repo */
  archivos?: string[]
  alLanzar?: () => void
  /** Id del encargo asíncrono (eN) al que sirve este trabajo, para reencontrarlo tras una recarga */
  encargoId?: string
}

const git = ($: EngineInterface, cwd: string, a: string[]) => $.process.run(['git', '-C', cwd, ...a], { timeoutMs: 60_000 })

// Una copia del repo de `cwd` para un agente: worktree en ~/.centro-agentes/copias/<chat>/ con su rama mst/<nombre>.
// shortcut: parte del último commit; lo que tengas sin commitear en tu carpeta no está en la copia.
async function crearCopia($: EngineInterface, cwd: string, nombre: string) {
  const raiz = await git($, cwd, ['rev-parse', '--show-toplevel']).catch(() => undefined)
  if (!raiz || raiz.exitCode !== 0) return { error: 'cwd no es un repositorio git: el agente trabaja en la carpeta tal cual' }
  const repo = raiz.stdout.trim()
  const base = (await git($, repo, ['rev-parse', 'HEAD'])).stdout.trim()
  const carpeta = `${await carpetaWeb($)}/copias/${SID}/${nombre}`
  const rama = `mst/${nombre}`
  const r = await git($, repo, ['worktree', 'add', '-b', rama, carpeta, 'HEAD'])
  return r.exitCode === 0 ? { repo, carpeta, rama, base } : { error: `git worktree falló: ${corto(r.stderr.trim(), 200)}` }
}

async function borrarCopia($: EngineInterface, c: { repo: string; carpeta: string; rama: string }) {
  await git($, c.repo, ['worktree', 'remove', '--force', c.carpeta]).catch(() => undefined)
  await git($, c.repo, ['branch', '-D', c.rama]).catch(() => undefined)
}

// Guarda en su rama lo que hizo el agente en la copia, para que el jefe lo junte con un merge.
async function cerrarCopia($: EngineInterface, c: { repo: string; carpeta: string; rama: string; base: string }, mensaje: string) {
  await git($, c.carpeta, ['add', '-A'])
  // Si el agente ya hizo su propio commit, este falla y no pasa nada: se mira HEAD contra la base.
  await git($, c.carpeta, ['commit', '-q', '-m', mensaje])
  const head = (await git($, c.carpeta, ['rev-parse', 'HEAD'])).stdout.trim()
  const pendiente = (await git($, c.carpeta, ['status', '--porcelain'])).stdout.trim()
  // Sin commits nuevos ni cambios sin guardar no hay nada que juntar: la copia y su rama se borran para no dejar basura.
  if (head === c.base && !pendiente) {
    await borrarCopia($, c)
    return { rama: c.rama, cambios: 'el agente no cambió ningún archivo; la copia se borró' }
  }
  const stat = await git($, c.carpeta, ['diff', '--stat', c.base, 'HEAD'])
  const nameStatus = await git($, c.carpeta, ['diff', '--name-status', c.base, 'HEAD'])
  const cambios = contarCambios(nameStatus.stdout)
  const masiva = esMasiva(cambios)
  return {
    carpeta: c.carpeta,
    rama: c.rama,
    ...cambios,
    ...(masiva.masiva ? { escalar: ['masiva'], aviso_masiva: masiva.motivo } : {}),
    cambios: stat.stdout.trim().slice(-2000),
    juntar: `git -C "${c.repo}" merge ${c.rama} && git -C "${c.repo}" worktree remove "${c.carpeta}"`,
  }
}

// Ejecuta el comando de verificación del jefe (tests, build...) donde trabajó el agente.
async function verificarEn($: EngineInterface, cwd: string | undefined, comando: string) {
  if (cwd && !(await $.fs.exists(cwd).catch(() => true))) return { comando, ok: false, salida: `La carpeta de trabajo no existe: ${cwd}` }
  // Va en un .cmd: como argumento, las comillas del comando le llegan rotas a cmd. El .cmd se borra solo y conserva el código de salida.
  const archivo = `${await carpetaChat($)}/verificar-${Date.now().toString(36)}${(seq++).toString(36)}.cmd`
  await $.fs.write(archivo, `@echo off\r\nchcp 65001 >nul\r\n${comando}\r\nset "codigo=%errorlevel%"\r\n(goto) 2>nul & del "%~f0" & exit /b %codigo%\r\n`)
  const r = await $.process.run(['cmd', '/d', '/c', archivo.replace(/\//g, '\\')], { cwd, timeoutMs: 5 * 60_000 }).catch(err => ({ exitCode: null, stdout: '', stderr: String(err) }))
  return { comando, ok: r.exitCode === 0, codigo: r.exitCode, salida: sinAnsi(`${r.stdout}\n${r.stderr}`).trim().slice(-2500) }
}
// Modelos con un trabajo en marcha: un encargo nuevo prefiere otro libre, para repartir el trabajo.
const ocupados = new Map<string, number>()
const semaforoAgentes = new Semaforo(MAX_PARALELO)

// Elige el mejor modelo para el encargo, lo ejecuta y, si falla, cambia solo al siguiente.
async function delegarSinCerrojo($: EngineInterface, modelos: Modelos, input: Encargo, timeoutMs: number, sinBloqueo = false) {
  const categoria = String(input.categoria ?? '').toLowerCase().trim() || 'general'
  const necesidades = input.necesita !== undefined ? input.necesita : detectarNecesidades(input.tarea, categoria)
  if (input.subtarea !== undefined && !sinBloqueo) {
    const faltan = bloqueos((await read($, plan))?.subtareas ?? [], input.subtarea)
    if (faltan.length) return { subtarea: input.subtarea, error: `La subtarea ${input.subtarea} espera a ${faltan.join(', ')}: lánzala cuando estén hechas.` }
  }
  // Se recuerda el encargo de cada subtarea para poder relanzarlo desde la web.
  if (input.subtarea !== undefined) encargos.set(input.subtarea, { ...input })
  const pedido = input.trabajador && input.trabajador !== 'auto' ? input.trabajador : undefined
  if (pedido && !modelos[pedido]) return { error: `Trabajador desconocido: ${pedido}` }
  // Una tarea con skills necesita un agente que lea archivos: Ollama solo es un modelo, sin herramientas.
  const conSkills = (input.skills ?? []).filter(Boolean)
  // Skills automáticas: el centro decide por la clase de tarea (escribir código, auditar un cambio, auditar un repo o texto) y no depende de que
  // Claude se acuerde. Solo las instaladas; y solo a los agentes que leen skills (Ollama y Aider quedan como están).
  let clasificada = skillsAuto ? clasificarTarea({ categoria, tarea: input.tarea, archivos: input.archivos, aislar: input.aislar, verificar: input.verificar }) : undefined
  // Una petición vaga que pide cambios en una carpeta con código también es código (el mapa del código no sale vacío).
  if (clasificada && clasificada.clase === 'texto' && clasificada.pideCambios && input.cwd) clasificada = conCarpeta(clasificada, (await mapaDelCodigo($, input.cwd)) !== '')
  const claseTarea = clasificada?.clase ?? 'texto'
  // El interruptor del encargo apaga lo que se añade al agente, no el recordatorio de con qué auditar el resultado.
  const clase = input.sin_skills_automaticas ? 'texto' : claseTarea
  const automaticas: string[] = []
  for (const n of skillsAutomaticas(clase)) if (!conSkills.includes(n) && (await rutaSkill($, n))) automaticas.push(n)
  let todos = todosLosCandidatos(modelos).filter(c => !conSkills.length || (c.trabajador !== 'ollama' && c.trabajador !== 'aider'))
  const catalogo = await leerCatalogoPlugin($)
  const filtrado = filtrarPorCapacidad(todos, catalogo, necesidades)
  const pedidoModelo = input.modelo?.trim()
  const forzado = pedidoModelo ? todos.find(c => c.modelo === pedidoModelo && (!input.trabajador || input.trabajador === 'auto' || c.trabajador === input.trabajador)) : undefined
  if (necesidades.length && forzado) todos = [forzado, ...todos.filter(c => c !== forzado)]
  else if (necesidades.length) {
    todos = filtrado.aptos
    if (!todos.length) {
      const nombres = necesidades.join(', ')
      return { subtarea: input.subtarea, error: `Ningún modelo conocido tiene la capacidad ${nombres}. Se descartaron ${filtrado.excluidos.filter(x => x.motivo === 'no_la_tiene').length} porque no la tienen y ${filtrado.excluidos.filter(x => x.motivo === 'desconocido').length} por capacidad desconocida. Catálogo: ${catalogo?.generado ?? 'aún no hay catálogo'}. Si crees que algún modelo puede hacerlo, fuérzalo con el campo modelo.` }
    }
  }
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
  // Si el cerebro recuerda que alguien lo hizo muy bien en algo parecido, empieza por él.
  const recuerdo = recomendar(await leerCerebro($), categoria, input.tarea)
  const preparar = (l: Candidato[]) => {
    const o = preferir(ordenar(tabla, categoria, l, caidosAhora(), catalogo).filter(alcanzable), recuerdo)
    return [...o.filter(libre), ...o.filter(c => !libre(c))]
  }
  // Primero el agente pedido; si no puede, se pasa a otro que sí funcione.
  let cola = [...preparar(candidatos), ...(pedido ? preparar(todos.filter(c => c.trabajador !== pedido)) : [])]
  if (modeloPedido) cola = [...cola.filter(c => c.modelo === modeloPedido), ...cola.filter(c => c.modelo !== modeloPedido)]

  // Copia aislada: varios agentes pueden editar el mismo repo a la vez sin pisarse.
  const copia = input.aislar && input.cwd ? await crearCopia($, input.cwd, `s${input.subtarea ?? 'x'}-${Date.now().toString(36)}`) : undefined
  if (copia && 'carpeta' in copia) input = { ...input, cwd: copia.carpeta }
  // La skill ponytail va con el mapa del código de la carpeta donde trabajará el agente.
  if (conSkills.includes('ponytail') && input.cwd) input = { ...input, tarea: input.tarea + (await mapaDelCodigo($, input.cwd)) }

  // Si un modelo falla (sin sesión, sin cuota, caído), se pasa solo al siguiente de la cola.
  const cambios: string[] = []
  // Aparte de cambios: un reintento con el mismo modelo no gasta el cupo de cambios de modelo (MAX_CAMBIOS).
  const reintentos: string[] = []
  let r: Intento | undefined
  let elegido = cola[0]
  let anadidas: string[] = []
  let avisoArchivo: string | undefined
  let reservaHecha = false
  if (input.subtarea === undefined) input.alLanzar?.()
  for (const c of cola) {
    if (cambios.length > MAX_CAMBIOS) break
    const k = clave(c.trabajador, c.modelo)
    if (caidosAhora().has(k)) continue
    if (!esLocal(c) && salud.get(c.trabajador)?.ok === false) continue
    elegido = c
    ocupados.set(k, (ocupados.get(k) ?? 0) + 1)
    if (!reservaHecha && input.subtarea !== undefined) {
      const reserva = await reservarSubtarea($, input.subtarea)
      if (reserva.error) {
        ocupados.set(k, (ocupados.get(k) ?? 1) - 1)
        if (copia && 'carpeta' in copia) await borrarCopia($, copia)
        return { subtarea: input.subtarea, error: reserva.error }
      }
      reservaHecha = true
      avisoArchivo = reserva.aviso_archivo
    }
    input.alLanzar?.()
    try {
      const leeSkills = c.trabajador !== 'ollama' && c.trabajador !== 'aider'
      const extra = leeSkills && automaticas.length ? (await instruccionSkills($, automaticas)) + (input.cwd && automaticas.some(n => CON_MAPA.includes(n)) ? await mapaDelCodigo($, input.cwd) : '') : ''
      // Lo que el centro decidió y por qué, para estudiar los falsos positivos: solo cuenta lo que este agente recibió de verdad.
      anadidas = extra ? automaticas : []
      const clasificacion = clasificada ? { clase: claseTarea, motivos: clasificada.motivos, anadidas, ...(input.sin_skills_automaticas ? { apagada: true } : {}) } : undefined
      const datos = { ...input, categoria, clasificacion, ...(extra ? { tarea: input.tarea + extra, skills: [...conSkills, ...automaticas] } : {}) }
      let reintento = 0
      do {
        if (reintento) {
          reintentos.push(`${k} reintento ${reintento}: error de arranque`)
          // setTimeout y no $.clock.after: el motor de pruebas no avanza el reloj simulado.
          await new Promise<void>(resolver => setTimeout(resolver, 1000))
        }
        const liberar = await semaforoAgentes.tomar()
        try {
          r = await intentar($, c, datos, timeoutMs)
        } finally {
          liberar()
        }
        if (r.ok || !esErrorDeArranque(r.s.texto) || reintento >= REINTENTOS_ARRANQUE) break
        reintento++
      } while (true)
    } finally {
      ocupados.set(k, (ocupados.get(k) ?? 1) - 1)
    }
    if (r.ok) break
    // Cancelado a mano desde la web: no se prueba otro modelo.
    if (r.s.texto.includes(`[cortado: ${CANCELADO}]`)) break
    // Cupo gratis agotado o modelo caído del proveedor: se aparta SOLO ese modelo el tiempo que toque y se pasa al siguiente sin gastar cambios.
    const tipo = r.s.errorTipo
    if (tipo === 'provider.free-limit' || tipo === 'provider.no-route' || (tipo === 'provider.invalid-request' && /unavailable/i.test(r.s.texto))) {
      const ms = tipo === 'provider.free-limit' ? (r.s.reintentoMs ?? HORA_MS) : 30 * 60_000
      caidos.set(k, Date.now() + ms - CAIDO_MS)
      motivoAgente.set(c.trabajador, tipo === 'provider.free-limit' ? 'sin cupo gratis' : 'modelo no disponible')
      continue
    }
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
  if (!r) {
    if (copia && 'carpeta' in copia) await borrarCopia($, copia)
    const avisoEstado = await marcar($, input.subtarea, { estado: 'pendiente' })
    return { subtarea: input.subtarea, error: 'Todos los modelos posibles fallaron hace poco. Prueba otro trabajador o espera unos minutos.', ...(avisoArchivo ?? avisoEstado ? { aviso_archivo: avisoArchivo ?? avisoEstado } : {}) }
  }
  const avisoEstado = await marcar($, input.subtarea, { estado: r.ok ? 'realizado' : 'pendiente' })
  avisoArchivo ??= avisoEstado
  const quienFue = clave(elegido.trabajador, elegido.modelo)
  const aislado = copia && 'carpeta' in copia ? await cerrarCopia($, copia, `mst: subtarea ${input.subtarea ?? '-'} (${quienFue})`) : copia
  if (aislado && 'escalar' in aislado && aislado.escalar?.includes('masiva') && !escaladasMasivas.has(r.id)) {
    escaladasMasivas.add(r.id)
    void $.prompt.submit({ text: `[Centro de agentes MST] ESCALADA (modificación masiva): ${quienFue}: ${aislado.aviso_masiva}. No conviene juntar la rama sin revisarla.` }).catch(() => undefined)
  }
  const verificacion = r.ok && input.verificar?.trim() ? await verificarEn($, input.cwd, input.verificar.trim()) : undefined
  const revisor = claseTarea === 'escritura' && r.ok ? await rutaSkill($, 'ponytail-review') : undefined
  // El modelo pedido a propósito se usa aunque el catálogo no le confirme la capacidad; se avisa para que el jefe lo sepa.
  const modeloDe = forzado ?? todos.find(c => c.modelo === pedidoModelo) ?? elegido
  const entradaPedida = pedidoModelo && necesidades.length ? entradaDe(catalogo, modeloDe.trabajador as any, modeloDe.modelo) : undefined
  const avisoCapacidad = pedidoModelo
    ? necesidades.map(cap => {
        const valor = entradaPedida?.capacidades[cap]
        return valor === true ? '' : `El catálogo no confirma que ${pedidoModelo} tenga ${cap} (${valor === false ? 'no la tiene' : 'se desconoce'}); se usó porque lo pediste.`
      }).filter(Boolean).join(' ')
    : ''

  return {
    id: r.id,
    subtarea: input.subtarea,
    trabajador: quienFue,
    exito: r.ok,
    segundos: Math.round(r.ms / 1000),
    tokens: { entrada: r.s.tokensIn, salida: r.s.tokensOut, ...(r.s.tokensCache === undefined ? {} : { cache: r.s.tokensCache }) },
    ...(necesidades.length ? { necesita: necesidades } : {}),
    ...(necesidades.length && input.necesita === undefined ? { detectada: true } : {}),
    ...(avisoCapacidad ? { aviso_capacidad: avisoCapacidad } : {}),
    ...(cambios.length || reintentos.length ? { cambios: [...reintentos, ...cambios] } : {}),
    ...(avisoArchivo ? { aviso_archivo: avisoArchivo } : {}),
    ...(aislado ? { copia: aislado } : {}),
    ...(aislado && 'escalar' in aislado && aislado.escalar ? { escalar: aislado.escalar, aviso_masiva: aislado.aviso_masiva } : {}),
    ...(verificacion ? { verificacion } : {}),
    salida: r.s.texto.slice(0, 60_000) || '(sin salida)',
    aviso: verificacion
      ? `Verificación ${verificacion.ok ? 'superada' : 'FALLIDA'} con "${verificacion.comando}". Revisa y llama a registrar_auditoria con este id.`
      : 'Resultado sin verificar. Audítalo y llama a registrar_auditoria con este id.',
    // Para detectar falsos positivos: la clase que decidió el centro, sus motivos y las skills que añadió solo.
    ...(clasificada ? { clasificacion: { clase: claseTarea, motivos: clasificada.motivos, skills_anadidas: anadidas, ...(input.sin_skills_automaticas ? { apagada_por_encargo: true } : {}) } } : {}),
    ...(revisor ? { auditar_con: 'ponytail-review', aviso_auditoria: `Es un cambio de código: audítalo con la skill ponytail-review (lee ${revisor}); revisa los archivos que cambió y quién los usa.` } : {}),
  }
}

// Carpeta compartida: sin "aislar", los agentes de una misma carpeta (y rama) esperan su turno solo si chocan en archivos.
// Con "archivos" declarados, los que tocan cosas distintas trabajan a la vez; sin ellos se toma todo el repo.
const cerrojos = new Cerrojos()
const llaveCarpeta = (cwd: string) => cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
async function cambiosGit($: EngineInterface, cwd: string) {
  const r = await git($, cwd, ['status', '--porcelain']).catch(() => undefined)
  return r && r.exitCode === 0 ? archivosCambiados(r.stdout) : null
}
async function delegarUno($: EngineInterface, modelos: Modelos, input: Encargo, timeoutMs: number, sinBloqueo = false) {
  if (input.subtarea !== undefined && (await read($, plan))?.subtareas.some(s => s.n === input.subtarea && s.manual)) return { error: `La subtarea ${input.subtarea} es manual y no se delega` }
  if (!input.cwd || input.aislar) return delegarSinCerrojo($, modelos, input, timeoutMs, sinBloqueo)
  const llave = llaveCarpeta(input.cwd)
  const t0 = Date.now()
  const liberar = await cerrojos.tomar(llave, input.archivos)
  const esperoSeg = Math.round((Date.now() - t0) / 1000)
  const antes = await cambiosGit($, input.cwd)
  try {
    const r = (await delegarSinCerrojo($, modelos, input, timeoutMs, sinBloqueo)) as Record<string, any>
    const despues = antes && (await cambiosGit($, input.cwd))
    const suyos = input.archivos?.length ? input.archivos : ['*']
    const fuera = despues ? fueraDeAlcance(antes, despues, suyos, cerrojos.deOtros(llave, liberar.id, liberar.desde)) : []
    return {
      ...r,
      carpeta_compartida: { archivos: suyos, ...(esperoSeg ? { esperoSeg } : {}) },
      ...(fuera.length ? { fuera_de_alcance: fuera, aviso: `${r.aviso ?? ''} OJO: el agente tocó archivos que no eran suyos: ${fuera.join(', ')}. Revísalos.`.trim() } : {}),
    }
  } finally {
    liberar()
  }
}

// Si ningún encargo del grupo llegó a ejecutarse, los errores ya volvieron en la respuesta de la herramienta: no hay nada que auditar.
const hayQueAuditar = (grupo: string) => registro.delGrupo(grupo).some(e => e.trabajoId)

async function lanzarEncargo($: EngineInterface, modelos: Modelos, input: Encargo, timeoutMs: number, grupo?: string, sinBloqueo = false, existente?: ReturnType<typeof registro.nuevoEncargo>) {
  const encargo = existente ?? registro.nuevoEncargo({ grupo, subtarea: input.subtarea }, Date.now())
  void actualizarBarra($)
  let iniciar!: () => void
  const inicio = new Promise<void>(resolve => { iniciar = resolve })
  let iniciado = false
  const promesa = delegarUno($, modelos, { ...input, encargoId: encargo.id, alLanzar: () => {
    if (iniciado) return
    iniciado = true
    registro.marcar(encargo.id, 'corriendo', {}, Date.now())
    void actualizarBarra($)
    iniciar()
  } }, timeoutMs, sinBloqueo).then(async resultado => {
    const obj = resultado as Record<string, any>
    const exito = Boolean(obj.id && obj.exito)
    registro.marcar(encargo.id, obj.id ? (exito ? 'terminado' : 'fallido') : 'fallido', { trabajoId: obj.id, resultado }, Date.now())
    void actualizarBarra($)
    if (iniciado) {
      const fallos = registro.registrarFin(input.subtarea, exito)
      if (!exito && fallos === FALLOS_SEGUIDOS_ESCALA) void $.prompt.submit({ text: `[Centro de agentes MST] ESCALADA (fallos): la subtarea ${input.subtarea} lleva ${fallos} fallos seguidos. Modelos probados: ${Array.isArray(obj.cambios) && obj.cambios.length ? obj.cambios.join(', ') : obj.trabajador}. No la relances igual: cambia el enfoque o pregunta al usuario.` }).catch(() => undefined)
    }
    if (registro.avisarGrupo(encargo.grupo) && hayQueAuditar(encargo.grupo)) await avisarGrupo($, encargo.grupo)
    return resultado
  }).catch(async error => {
    const resultado = { error: String(error) }
    registro.marcar(encargo.id, 'fallido', { resultado }, Date.now())
    void actualizarBarra($)
    if (iniciado) {
      const fallos = registro.registrarFin(input.subtarea, false)
      if (fallos === FALLOS_SEGUIDOS_ESCALA) void $.prompt.submit({ text: `[Centro de agentes MST] ESCALADA (fallos): la subtarea ${input.subtarea} lleva ${fallos} fallos seguidos. Modelos probados: ${input.trabajador ?? 'trabajador'}. No la relances igual: cambia el enfoque o pregunta al usuario.` }).catch(() => undefined)
    }
    if (registro.avisarGrupo(encargo.grupo) && hayQueAuditar(encargo.grupo)) await avisarGrupo($, encargo.grupo)
    return resultado
  })
  const primero = await Promise.race([inicio.then(() => 'lanzado'), promesa.then(() => 'fin')])
  return { encargo, ...(primero === 'fin' ? { resultadoInmediato: await promesa } : {}), promesa }
}

export const register: Register = (on, options) => {
  const opt = (options ?? {}) as Opciones
  const modelos: Modelos = {
    // Los :cloud que entran en el plan Free de Ollama (probados con sesión iniciada); llama3.2:3b es local y queda de respaldo.
    ollama: lista(opt.ollamaModels, ['gpt-oss:120b-cloud', 'beam:cloud', 'gemma4:31b-cloud', 'nemotron-3-super:cloud', 'gpt-oss:20b-cloud', 'llama3.2:3b']),
    // Los modelos gratuitos propios de OpenCode (probados con herramientas MCP): sin Ollama y sin clave.
    opencode: lista(opt.opencodeModels, ['opencode/deepseek-v4.1-flash-free', 'opencode/glm-5.3-flash-free', 'opencode/minimax-m3.1-flash-free', 'opencode/nemotron-3-ultra-free', 'opencode/big-pickle']),
    // proveedor/modelo de Hermes; ollama-local está en ~/.hermes/config.yaml y apunta a tu Ollama (gratis, sin clave).
    hermes: lista(opt.hermesModels, ['ollama-local/gpt-oss:120b-cloud', 'ollama-local/beam:cloud', 'ollama-local/gemma4:31b-cloud', 'ollama-local/gpt-oss:20b-cloud']),
    // Aider llama a Ollama con el prefijo ollama_chat/ (el de chat, que respeta el formato de edición).
    // chatgpt = tu cuenta de ChatGPT (cupo mensual gratis limitado); ollama/... = tu Ollama, de respaldo.
    codex: lista(opt.codexModels, ['chatgpt', 'ollama/gpt-oss:120b-cloud']),
    aider: lista(opt.aiderModels, ['ollama_chat/gpt-oss:120b-cloud', 'ollama_chat/beam:cloud', 'ollama_chat/gemma4:31b-cloud']),
    claude: lista(opt.claudeModels, ['haiku', 'sonnet', 'opus']),
  }
  const timeoutMs = Math.min(10, Math.max(1, Number(opt.timeoutMin ?? 8))) * 60_000
  limiteInactividadMs = Math.min(120, Math.max(10, Number(opt.inactividadMin ?? INACTIVIDAD_MIN_POR_DEFECTO))) * 60_000
  contexto = { modelos, timeoutMs }
  presupuestoClaude = Math.max(0, Number(opt.presupuestoClaudeTokens ?? 400_000)) || 0
  const tema = String(opt.ntfyTema ?? '').trim()
  temaNtfy = temaNtfyValido(tema) ? tema : ''
  esperaInicialMs = Math.min(600, Math.max(15, Number(opt.esperaInicialSeg ?? 90))) * 1000
  skillsAuto = opt.ponytailAutomatico !== false
  // Solo con el ajuste en true (el plugin.json lo trae activado); sin él, como en las pruebas, el camino de siempre.
  lanzadorDesacoplado = opt.lanzadorDesacoplado === true

  on('session.start', async ($, e, next) => {
    // Cada chat tiene su centro: su id nombra su carpeta. Se recupera lo guardado y se sigue guardando cada 2 s.
    SID = ((await $.session.id().catch(() => 'local')) || 'local').replace(/[^\w-]/g, '')
    carpetaProyecto = e.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
    rutaProyecto = e.cwd
    await restaurarEstado($).catch(() => undefined)
    void refrescarCatalogo($, modelos, opt.catalogoEnLinea !== false).catch(() => undefined)
    $.clock.every(2000, () => guardarEstado($))
    $.clock.every(60_000, () => void vigilar($).catch(() => undefined))
    if (barraEstado) barraEstado.cancel()
    barraEstado = $.clock.every(5000, () => void actualizarBarra($).catch(() => undefined))
    $.clock.every(2000, async () => {
      try {
        const listaTrabajos = (await read($, trabajos)) ?? []
        const ahora = Date.now()
        const vivos = filasVivas(listaTrabajos, ahora)
        if (vivosPrevios === 0 && vivos.length >= 1 && !panelCerradoAMano) {
          void $.ui.open({ id: PANE, title: TITULO }).catch(() => undefined)
        }
        vivosPrevios = vivos.length
      } catch {}
    })
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
    // Busca en internet como mucho una vez cada 6 horas; el resto de sesiones solo leen un valor guardado.
    await autoactualizar($).catch(() => undefined)
    await $.command.register({ name: 'mst', description: 'Centro de agentes MST: abre el panel y la web; con una tarea, Claude la reparte entre los agentes y la verifica' })
    await $.command.register({ name: 'centro', description: 'Reparte una tarea entre Ollama/OpenCode/Claude (y sus modelos) y Claude la audita' })
    await $.command.register({ name: 'centro-bench', description: 'Manda la misma tarea a cada trabajador/modelo y compara' })
    await $.command.register({ name: 'centro-panel', description: 'Abre el panel del centro de agentes' })
    await $.command.register({ name: 'centro-web', description: 'Abre el centro de agentes en el navegador (se actualiza solo)' })
    await $.command.register({ name: 'mst-informe', description: 'Escribe el informe final de este chat (Markdown) y lo abre' })
    await $.command.register({ name: 'mst-modelos', description: 'Lista los modelos que puede usar cada agente y qué sabe hacer cada uno' })
    await $.command.register({ name: 'mst-estado', description: 'Muestra al instante qué agentes están trabajando, desde cuándo y hace cuánto dieron señal; no pasa por el jefe' })
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
        $.clock.after(1500, () => void abrirNavegador($).catch(() => undefined))
      }
    }
    // Tras una recarga del mod, o si se abrió al iniciar, la vista web sigue encendida.
    if (await $.store.get(WEB_KEY)) encenderWeb($)
    void actualizarBarra($)

    await $.tool.register({
      name: 'planificar',
      description: 'Registra el objetivo y la lista de subtareas del trabajo actual (reemplaza el plan anterior). El usuario ve en el panel cuáles faltan y cuáles están hechas.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          objetivo: { type: 'string', description: 'Resultado final en una frase' },
          cwd: { type: 'string', description: 'Carpeta del proyecto donde vive mst-tareas.json; por defecto la carpeta de la sesión' },
          subtareas: { type: 'array', items: { type: 'string' }, description: 'Títulos cortos, en orden' },
          dependencias: { type: 'object', description: 'Opcional. Qué subtareas espera cada una, p. ej. {"3": [1, 2]}: la 3 no se puede lanzar hasta que la 1 y la 2 estén hechas' },
          manuales: { type: 'array', items: { type: 'number' }, description: 'Posiciones de subtareas manuales que no se delegan' },
          tarea: { type: 'string', description: 'Id de tarea guardada para cargar, p. ej. T2' },
          agregar: { type: 'array', description: 'Títulos u objetos { titulo, depende_de: ["T3.1"], manual } para añadir a la tarea actual', items: { oneOf: [{ type: 'string' }, { type: 'object', properties: { titulo: { type: 'string' }, depende_de: { type: 'array', items: { type: 'string' } }, manual: { type: 'boolean' } }, required: ['titulo'] }] } },
          ajustar: { type: 'object', description: 'Ajustes por id de subtarea pendiente, p. ej. {"T3.2": { titulo, depende_de }}' },
          reabrir: { type: 'array', items: { type: 'string' }, description: 'Devuelve esas subtareas a pendiente para rehacerlas (y reabre su tarea si estaba solucionada). Úsalo cuando una tarea solucionada no cumplía lo pedido; si cumplía y hay trabajo nuevo, crea una tarea nueva con planificar.' },
        },
      },
    })
    await $.tool.register({
      name: 'delegar',
      description:
        'Lanza una tarea en segundo plano y devuelve sus ids al instante. Recibirás un aviso al terminar; consulta estado si hace falta y audita el resultado.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          trabajador: { type: 'string', enum: [...TRABAJADORES, 'auto'], description: 'Vacío o auto: el centro elige el mejor según el ranking' },
          modelo: { type: 'string', description: `Modelo del trabajador. Permitidos — ollama: ${ver(modelos.ollama)}; opencode: ${ver(modelos.opencode)}; claude: ${ver(modelos.claude)}. Vacío = el centro elige el mejor de la lista y cambia solo si falla.` },
          categoria: { type: 'string', description: 'Categoría corta de la tarea' },
          tarea: { type: 'string', description: 'Instrucción completa y autocontenida para el trabajador' },
          necesita: { type: 'array', items: { type: 'string', enum: ['imagen', 'herramientas', 'razonamiento'] }, description: "Capacidades que debe tener el modelo (p. ej. ['imagen'] para transcribir imágenes). Si no lo pones, el centro detecta solo cuando la tarea habla de imágenes; pasa [] para no detectar nada" },
          subtarea: { type: 'number', description: 'Número de la subtarea del plan (de planificar) que cubre este trabajo' },
          cwd: { type: 'string', description: 'Directorio de trabajo (opcional)' },
          aislar: { type: 'boolean', description: 'Si cwd es un repo git: el agente trabaja en su propia copia (git worktree, rama mst/...) y no pisa a los demás. Junta luego con el comando de "copia.juntar"' },
          verificar: { type: 'string', description: 'Comando que comprueba el resultado (p. ej. npm test); el centro lo ejecuta donde trabajó el agente y te da su salida' },
          archivos: { type: 'array', items: { type: 'string' }, description: 'Carpeta compartida (sin aislar): los archivos o carpetas que este agente puede tocar. Los que tocan cosas distintas trabajan a la vez en la misma rama; los que chocan esperan turno. Sin esto se reserva todo el repo y espera a los demás' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Skills que el agente debe seguir (p. ej. design-md, vercel:nextjs). Usa buscar_skills para encontrarlas.' },
          sin_skills_automaticas: { type: 'boolean', description: 'true para que el centro NO añada solo las skills de ponytail (ponytail al escribir código, ponytail-review al auditar un cambio, ponytail-audit al auditar un repo). Por defecto las añade si están instaladas.' },
        },
        required: ['categoria', 'tarea'],
      },
    })
    await $.tool.register({
      name: 'delegar_varios',
      description:
        'Lanza varias subtareas en segundo plano y devuelve sus ids al instante. Recibirás un único aviso cuando termine el grupo; consulta estado si hace falta.',
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
                necesita: { type: 'array', items: { type: 'string', enum: ['imagen', 'herramientas', 'razonamiento'] }, description: "Capacidades que debe tener el modelo (p. ej. ['imagen'] para transcribir imágenes). Si no lo pones, el centro detecta solo cuando la tarea habla de imágenes; pasa [] para no detectar nada" },
                categoria: { type: 'string' },
                subtarea: { type: 'number' },
                trabajador: { type: 'string', enum: [...TRABAJADORES, 'auto'] },
                modelo: { type: 'string' },
                cwd: { type: 'string', description: 'Directorio existente; distinto por tarea si editan archivos' },
                aislar: { type: 'boolean', description: 'Si cwd es un repo git: el agente trabaja en su propia copia (git worktree, rama mst/...) y no pisa a los demás. Junta luego con el comando de "copia.juntar"' },
                verificar: { type: 'string', description: 'Comando que comprueba el resultado (p. ej. npm test); el centro lo ejecuta donde trabajó el agente y te da su salida' },
                archivos: { type: 'array', items: { type: 'string' }, description: 'Carpeta compartida (sin aislar): los archivos o carpetas que este agente puede tocar. Los que tocan cosas distintas trabajan a la vez en la misma rama; los que chocan esperan turno. Sin esto se reserva todo el repo y espera a los demás' },
                skills: { type: 'array', items: { type: 'string' }, description: 'Skills que el agente debe seguir (p. ej. design-md, vercel:nextjs). Usa buscar_skills para encontrarlas.' },
                sin_skills_automaticas: { type: 'boolean', description: 'true para que el centro NO añada solo las skills de ponytail (ponytail al escribir código, ponytail-review al auditar un cambio, ponytail-audit al auditar un repo). Por defecto las añade si están instaladas.' },
              },
              required: ['tarea', 'categoria'],
            },
          },
        },
        required: ['tareas'],
      },
    })
    await $.tool.register({ name: 'estado', description: 'Devuelve encargos recientes (por defecto los últimos 30), con estado en_cola/corriendo/terminado/fallido, segundos, id de trabajo y resultado al terminar. Filtra por grupo o por ids de encargo eN.', isDeferred: false, inputSchema: { type: 'object', properties: { grupo: { type: 'string', description: 'Id de grupo devuelto por delegar_varios; devuelve todos sus encargos.' }, ids: { type: 'array', items: { type: 'string' }, description: 'Ids de encargo eN devueltos al lanzar; devuelve solo esos encargos.' } } } })
    await $.tool.register({
      name: 'buscar_skills',
      description: 'Busca entre las skills instaladas (las del usuario y las de sus plugins) las que sirven para una tarea. Devuelve nombre, descripción y ruta del SKILL.md. Pasa los nombres elegidos en "skills" al delegar.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { consulta: { type: 'string', description: 'Palabras clave de la tarea, EN INGLÉS (las descripciones de las skills están en inglés), p. ej. "landing page design ui", "deploy vercel", "browser test web"' } } },
    })
    await $.tool.register({
      name: 'registrar_auditoria',
      description: 'Guarda el puntaje (1-10) de tu auditoría a un trabajo delegado, para que el centro aprenda qué trabajador sirve para cada categoría. Con 6 o más, su subtarea queda solucionada.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id de trabajo tXXXX o id de encargo eN devuelto por delegar/delegar_varios' },
          puntaje: { type: 'number', minimum: 1, maximum: 10 },
          nota: { type: 'string' },
        },
        required: ['id', 'puntaje'],
      },
    })
    await $.tool.register({
      name: 'cerrar_subtarea',
      description: 'Marca como solucionada una subtarea que hiciste tú como jefe (p. ej. juntar ramas o revisar el conjunto), sin trabajo de un agente que auditar.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          subtarea: { type: 'number', description: 'Número de la subtarea del plan' },
          nota: { type: 'string', description: 'Qué hiciste, en una frase' },
        },
        required: ['subtarea'],
      },
    })
    await $.tool.register({
      name: 'ranking',
      description: 'Devuelve el puntaje promedio y tiempo promedio de cada trabajador por categoría.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { categoria: { type: 'string' } } },
    })
    await $.tool.register({ name: 'tareas_estado', description: 'Resumen corto de las tareas del proyecto (mst-tareas.json): cada tarea con su estado y, de la activa, sus subtareas. Úsala en vez de leer el archivo entero.', isDeferred: false, inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Carpeta del proyecto donde vive mst-tareas.json; por defecto la carpeta de la sesión' } } } })
    await $.tool.register({
      name: 'cerebro',
      description: 'Consulta el cerebro global: qué agente y modelo lo hicieron mejor en tareas parecidas de cualquier chat, y los casos más parecidos. Devuelve también el enlace web de este chat.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { consulta: { type: 'string', description: 'Palabras clave de la tarea nueva' }, area: { type: 'string', description: 'Categoría si ya la sabes (css, javascript, tests, docs...)' } }, required: ['consulta'] },
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

  // La persona cerró el panel a mano: se respeta (no se bloquea el cierre) y deja de abrirse solo.
  on('ui.close', { id: PANE }, async (_$, e, next) => {
    if (e.origin.kind === 'person') panelCerradoAMano = true
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  // /mst: lo primero en cualquier chat. Abre el panel y la web; con texto, además empieza el trabajo como jefe.
  on('command.run', { command: 'mst' }, async ($, e) => {
    panelCerradoAMano = false
    void $.ui.open({ id: PANE, title: TITULO })
    await $.store.set(WEB_KEY, true)
    await escribirWeb($)
    encenderWeb($)
    // Se da tiempo a que el servidor local empiece a escuchar.
    $.clock.after(1500, () => void abrirNavegador($))
    const url = await urlWeb($)
    const aviso = await avisoPonytail($)
    // La línea de modelos solo aparece con catálogo: sin él, los textos de /mst siguen igual.
    const catalogo = await leerCatalogoPlugin($)
    const lineaModelos = catalogo ? `\nModelos: ${catalogo.modelos.length} conocidos, ${catalogo.modelos.filter(e => e.capacidades.imagen === true).length} con imagen. Detalle: /mst-modelos o en la web.` : ''
    if (!e.args.trim()) return { text: `${TITULO}: ${url}\nEscribe /mst <tarea> para ponerlo a trabajar.${aviso}${lineaModelos}` }
    await update($, plan, () => null)
    // Sin await: el envío espera a que la sesión quede libre, y eso solo pasa cuando este comando ha respondido.
    void $.prompt.submit({ text: `${protocolo(modelos, url)}\n\nTAREA:\n${e.args}` }).catch(() => undefined)
    // Lo primero que ve el usuario es el enlace; el jefe lo repite y le hace sus preguntas.
    return { text: `${TITULO}: ${url}\nTarea enviada al jefe: antes de planificar te hará unas preguntas.${aviso}${lineaModelos}` }
  })

  on('command.run', { command: 'centro' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Uso: /centro <tarea>' }
    await update($, plan, () => null)
    void $.ui.open({ id: PANE, title: TITULO })
    // Sin await: el envío espera a que la sesión quede libre, y eso solo pasa cuando este comando ha respondido.
    void $.prompt.submit({ text: `${protocolo(modelos)}\n\nTAREA:\n${e.args}` }).catch(() => undefined)
    return { text: 'Tarea enviada al director.' }
  })

  on('command.run', { command: 'centro-bench' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Uso: /centro-bench <tarea>' }
    await update($, plan, () => null)
    void $.ui.open({ id: PANE, title: TITULO })
    // Sin await: el envío espera a que la sesión quede libre, y eso solo pasa cuando este comando ha respondido.
    void $.prompt.submit({ text: `${bench(modelos)}\n\nTAREA:\n${e.args}` }).catch(() => undefined)
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
    panelCerradoAMano = false
    await $.ui.open({ id: PANE, title: TITULO })
    return { text: 'Panel abierto.' }
  })

  on('command.run', { command: 'mst-informe' }, async $ => {
    const ruta = await escribirInforme($)
    // explorer abre el .md con el programa que tengas para Markdown; necesita la ruta con barras de Windows.
    await $.process.run(['explorer', ruta.replace(/\//g, '\\')]).catch(() => undefined)
    return { text: `Informe guardado en ${ruta}` }
  })

  on('command.run', { command: 'mst-modelos' }, async $ => {
    const catalogo = await leerCatalogoPlugin($)
    return { text: catalogo ? `${textoCatalogo(catalogo)}\n\nPara proponer uno al jefe: dile "prueba con <modelo>" en el chat o pulsa Proponer en la web.` : 'Aún no hay catálogo: se genera al iniciar la sesión (puede tardar unos segundos).' }
  })

  on('command.run', { command: 'mst-estado' }, async $ => {
    const lista = (await read($, trabajos)) ?? []
    return { text: textoEstado(lista, registro.todos(), Date.now(), AMARILLO_MS_POR_DEFECTO, limiteInactividadMs / 60_000) }
  })

  on('command.run', { command: 'centro-reset' }, async $ => {
    await $.store.delete(STORE_KEY)
    return { text: 'Puntajes borrados.' }
  })

  on('tool.call', { tool: 'mcp__centro-agentes__planificar' }, async ($, e) => {
    try {
      const a = args(e) as any
      const modos = ['tarea', 'agregar', 'ajustar', 'reabrir'].filter(k => a[k] !== undefined)
      const crear = a.objetivo !== undefined || a.subtareas !== undefined
      if (modos.length + Number(crear) !== 1) return res({ error: 'Elige un solo modo: objetivo/subtareas, tarea, agregar, ajustar o reabrir.' })
      let nuevo: Plan | undefined
      let archivo: any
      let aviso_archivo: string | undefined
      let metaArchivo: any
      let reabiertas: string[] | undefined
      const actualPrevio = await read($, plan)
      const raiz = typeof a.cwd === 'string' ? a.cwd : actualPrevio?.raiz ?? rutaProyecto
      if (!raiz) {
        if (!crear) return res({ error: 'No hay una carpeta de proyecto para acceder al archivo de tareas.' })
      }
      const montar = (t: Tarea): Plan => ({
        objetivo: t.titulo, tarea: t.id, raiz,
        subtareas: t.subtareas.map(s => ({ id: s.id, n: Number(s.id.split('.').at(-1)), titulo: s.titulo, estado: s.estado === 'cerrado' ? 'solucionado' : s.estado, ...(s.depende_de.length ? { espera: s.depende_de.map(d => Number(d.split('.').at(-1))) } : {}), ...(s.manual ? { manual: true } : {}) })),
      })
      if (crear) {
        if (typeof a.objetivo !== 'string' || !Array.isArray(typeof a.subtareas === 'string' ? JSON.parse(a.subtareas) : a.subtareas)) return res({ error: 'El modo crear requiere objetivo y subtareas (una lista).' })
        const titulos: unknown[] = typeof a.subtareas === 'string' ? JSON.parse(a.subtareas) : a.subtareas
        const dep = leerDependencias(a.dependencias, titulos.length)
        nuevo = { objetivo: corto(a.objetivo, 120), subtareas: titulos.map((titulo, i) => ({ n: i + 1, titulo: corto(String(titulo), 80), estado: 'pendiente', ...(dep.has(i + 1) ? { espera: dep.get(i + 1) } : {}), ...(Array.isArray(a.manuales) && a.manuales.includes(i + 1) ? { manual: true } : {}) })) }
        if (raiz) {
          const r = await tareasArchivo($, 'aplicar', raiz, { tipo: 'crear_tarea', titulo: nuevo.objetivo, subtareas: nuevo.subtareas.map(s => ({ titulo: s.titulo, depende_de: s.espera, manual: s.manual })) })
          if (r.ok && r.archivo) { archivo = r.archivo; const t = archivo.tareas.find((x: Tarea) => x.id === (r.cambios?.[0]?.match(/(?:crea|reutiliza) (T\d+)/)?.[1])); if (t) nuevo = montar(t); metaArchivo = { ...(r.creado ? { creado: true } : {}), ...(r.gitignore ? { gitignore: r.gitignore } : {}), ...(r.avisos?.length ? { avisos: r.avisos } : {}) } }
          else aviso_archivo = r.mensaje ?? 'No se pudo guardar el plan en el archivo'
        }
      } else if (modos[0] === 'tarea') {
        if (typeof a.tarea !== 'string') return res({ error: 'El modo tarea requiere un id, p. ej. T2.' })
        const r = raiz ? await tareasArchivo($, 'leer', raiz) : { archivo: null }
        const t = r.archivo?.tareas?.find((x: Tarea) => x.id === a.tarea)
        if (!t) return res({ error: `No existe la tarea ${a.tarea} en mst-tareas.json.` })
        nuevo = montar(t); metaArchivo = { ...(r.avisos?.length ? { avisos: r.avisos } : {}) }
      } else if (modos[0] === 'agregar') {
        if (!Array.isArray(a.agregar) || !a.agregar.length) return res({ error: 'El modo agregar requiere una lista de títulos u objetos.' })
        const actual = actualPrevio
        if (!actual?.tarea) return res({ error: 'No hay una tarea activa del archivo; carga una con planificar { tarea: "Tn" }.' })
        const subs = a.agregar.map((x: any) => typeof x === 'string' ? { titulo: x } : x)
        if (subs.some((x: any) => !x || typeof x.titulo !== 'string')) return res({ error: 'Cada elemento de agregar necesita un título.' })
        const r = await tareasArchivo($, 'aplicar', raiz || actual.raiz || '', { tipo: 'agregar', tarea: actual.tarea, subtareas: subs })
        if (r.ok) { archivo = r.archivo; nuevo = montar(archivo.tareas.find((x: Tarea) => x.id === actual.tarea)); metaArchivo = { ...(r.avisos?.length ? { avisos: r.avisos } : {}) } } else aviso_archivo = r.mensaje
      } else if (modos[0] === 'ajustar') {
        if (!a.ajustar || typeof a.ajustar !== 'object' || !Object.keys(a.ajustar).length) return res({ error: 'El modo ajustar requiere un objeto con ids y cambios.' })
        const actual = actualPrevio
        if (!actual?.tarea) return res({ error: 'No hay una tarea activa del archivo; carga una con planificar { tarea: "Tn" }.' })
        for (const [id, cambio] of Object.entries(a.ajustar)) {
          const r = await tareasArchivo($, 'aplicar', raiz || actual.raiz || '', { tipo: 'ajustar', id, ...(cambio as object) })
          if (!r.ok) { aviso_archivo = r.mensaje; break }
          archivo = r.archivo; metaArchivo = { ...(r.avisos?.length ? { avisos: r.avisos } : {}) }
        }
        if (archivo) nuevo = montar(archivo.tareas.find((x: Tarea) => x.id === actual.tarea))
      } else {
        if (!Array.isArray(a.reabrir) || !a.reabrir.length || a.reabrir.some((id: unknown) => typeof id !== 'string')) return res({ error: 'El modo reabrir requiere una lista de ids de tarea o subtareas.' })
        const ids: string[] = a.reabrir
        const tareas = ids.map(id => /^(T[1-9]\d*)(?:\.([1-9]\d*))?$/.exec(id)?.[1])
        if (tareas.some(id => !id)) return res({ error: 'Cada id de reabrir debe ser una tarea o subtarea válida, p. ej. T2.3.' })
        if (new Set(tareas).size !== 1) return res({ error: 'Reabre subtareas de una sola tarea por llamada.' })
        if (!raiz) return res({ error: 'No hay una carpeta de proyecto para acceder al archivo de tareas.' })
        reabiertas = []
        for (const id of ids) {
          const r = await tareasArchivo($, 'aplicar', raiz, { tipo: 'estado', id, estado: 'pendiente' })
          if (!r.ok) return res({ error: `No se pudo reabrir ${id}: ${r.mensaje}. Reabiertas: ${reabiertas.join(', ') || 'ninguna'}.` })
          reabiertas.push(id)
          archivo = r.archivo
          metaArchivo = { ...(r.avisos?.length ? { avisos: r.avisos } : {}) }
        }
        const recarga = await tareasArchivo($, 'leer', raiz)
        const tarea = recarga.archivo?.tareas?.find((t: Tarea) => t.id === tareas[0])
        if (!tarea) return res({ error: `No se pudo recargar la tarea ${tareas[0]} tras reabrir ${reabiertas.join(', ')}.` })
        nuevo = montar(tarea)
        metaArchivo = { ...(recarga.avisos?.length ? { avisos: recarga.avisos } : {}) }
      }
      if (!nuevo) return res({ error: aviso_archivo ?? 'No se pudo construir el plan.' })
      // El plan que se deja pasa al historial (salvo que sea el mismo objetivo: sigue siendo el mismo grupo) y, si el nuevo
      // objetivo ya estaba en el historial, sale de él: el grupo se reactiva con los trabajos que ya tenía.
      const anterior = await read($, plan)
      const mismo = (a: string, b: string) => a.trim() === b.trim()
      await update($, planes, l => [...(l ?? []).filter(p => !mismo(p.objetivo, nuevo.objetivo) && !(anterior && mismo(p.objetivo, anterior.objetivo))), ...(anterior && !mismo(anterior.objetivo, nuevo.objetivo) ? [anterior] : [])].slice(-6))
      await update($, plan, () => nuevo)
      void $.ui.open({ id: PANE, title: TITULO })
      return res({
        guardado: true,
        ...(nuevo.tarea ? { tarea: nuevo.tarea, ids: nuevo.subtareas.map(s => s.id) } : {}),
        ...(metaArchivo ? { archivo: metaArchivo } : {}),
        ...(aviso_archivo ? { aviso_archivo } : {}),
        subtareas: nuevo.subtareas.map(s => ({ n: s.n, titulo: s.titulo, estado: s.estado, ...(s.espera ? { espera: s.espera } : {}), ...(s.manual ? { manual: true } : {}) })),
        lanzar_ya: listas(nuevo.subtareas).map(s => s.n),
        ...(reabiertas ? { reabiertas } : {}),
      })
    } catch (err) {
      return res({ error: `planificar falló: ${String(err)}` })
    }
  }).catch(async (_$, _e, next) => res({ error: `planificar falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__delegar' }, async ($, e) => {
    const input = args(e) as Encargo
    const { encargo, resultadoInmediato, promesa } = await lanzarEncargo($, modelos, input, timeoutMs)
    if (resultadoInmediato) return res(resultadoInmediato)
    void promesa
    return res({ encargo: encargo.id, grupo: encargo.grupo, ...(input.subtarea === undefined ? {} : { subtarea: input.subtarea }), estado: 'lanzado', aviso: 'Trabajando en segundo plano. Recibirás UN aviso cuando termine el grupo; mientras, sigue con otra cosa o consulta con la herramienta estado.' })
  }).catch(async (_$, _e, next) => res({ error: `delegar falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__delegar_varios' }, async ($, e) => {
    const { tareas } = args(e) as { tareas: Encargo[] | string }
    // Algunos clientes mandan el array como texto JSON.
    const lista: Encargo[] = typeof tareas === 'string' ? JSON.parse(tareas) : (tareas ?? [])
    if (!lista.length) return res({ error: 'Pasa al menos una tarea en "tareas".' })
    // Todas a la vez: cada una elige el mejor modelo libre, así trabajan agentes distintos en paralelo.
    // Una subtarea que espera a otras del mismo lote arranca sola cuando esas terminan bien (y pasan su verificación).
    const subs = (await read($, plan))?.subtareas ?? []
    const grupo = registro.nuevoGrupo()
    const encargos = lista.map(t => registro.nuevoEncargo({ grupo, subtarea: t.subtarea }, Date.now()))
    void actualizarBarra($)
    const porIndice = new Map(lista.map((t, i) => [i, t]))
    const enMarcha = new Map<number, Promise<any>>()
    const iniciar = (i: number, camino = new Set<number>()): Promise<any> => {
      const t = porIndice.get(i)!
      const n = t.subtarea
      const ya = enMarcha.get(i)
      if (ya) return ya
      const espera = n === undefined ? [] : bloqueos(subs, n)
      const enLote = espera.map(dep => lista.findIndex(x => x.subtarea === dep)).filter(j => j >= 0 && j !== i && !camino.has(j))
      const p = (async () => {
        if (!espera.length || enLote.length < espera.length) return lanzarEncargo($, modelos, t, timeoutMs, grupo, false, encargos[i])
        const previas = await Promise.all(enLote.map(async j => {
          const previa = await iniciar(j, new Set([...camino, i]))
          return { resultado: await previa.promesa, subtarea: lista[j].subtarea }
        }))
        const mal = previas.filter(x => !x.resultado?.exito || x.resultado?.verificacion?.ok === false).map(x => x.subtarea)
        if (mal.length) {
          const resultado = { subtarea: n, error: `No se lanzó: la subtarea ${mal.join(', ')} de la que depende falló. Rehazla y vuelve a lanzar la ${n}.` }
          registro.marcar(encargos[i].id, 'fallido', { resultado }, Date.now())
          void actualizarBarra($)
          if (registro.avisarGrupo(grupo) && hayQueAuditar(grupo)) await avisarGrupo($, grupo)
          return { encargo: encargos[i], resultadoInmediato: resultado, resultado, promesa: Promise.resolve(resultado) }
        }
        return { ...(await lanzarEncargo($, modelos, t, timeoutMs, grupo, true, encargos[i])), tras: enLote.map(j => lista[j].subtarea) }
      })()
      enMarcha.set(i, p)
      return p
    }
    const respuesta = await Promise.all(lista.map(async (t, i) => {
      const espera = t.subtarea === undefined ? [] : bloqueos(subs, t.subtarea)
      const enLote = espera.some(dep => lista.some(x => x.subtarea === dep))
      if (enLote) {
        void iniciar(i)
        return { encargo: encargos[i].id, ...(t.subtarea === undefined ? {} : { subtarea: t.subtarea }), estado: 'en_espera' as const }
      }
      const lanzamiento = iniciar(i)
      const inmediato = await Promise.race([lanzamiento, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1500))])
      const error = inmediato?.resultadoInmediato?.error
      return { encargo: encargos[i].id, ...(t.subtarea === undefined ? {} : { subtarea: t.subtarea }), estado: error ? 'fallido' as const : 'lanzado' as const, ...(error ? { error } : {}) }
    }))
    return res({ grupo, encargos: respuesta, aviso: 'Trabajando en segundo plano. Recibirás UN aviso cuando termine todo el grupo; no esperes ni sondees en bucle. Audita los resultados al recibir el aviso.' })
  }).catch(async (_$, _e, next) => res({ error: `delegar_varios falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__estado' }, async ($, e) => {
    const filtro = args(e) as { grupo?: string; ids?: string[] }
    const todos = registro.todos()
    const encargos = (filtro.ids?.length ? todos.filter(x => filtro.ids!.includes(x.id)) : filtro.grupo ? todos.filter(x => x.grupo === filtro.grupo) : todos.slice(-30))
    const resumen = resumenEstado(encargos, Date.now())
    return res({ encargos: resumen, corriendo: encargos.filter(x => x.estado === 'corriendo').length, en_cola: encargos.filter(x => x.estado === 'en_cola').length, terminados: encargos.filter(x => x.estado === 'terminado').length, fallidos: encargos.filter(x => x.estado === 'fallido').length })
  })

  on('tool.call', { tool: 'mcp__centro-agentes__registrar_auditoria' }, async ($, e) => {
    const { id, puntaje, nota } = args(e) as { id: string; puntaje: number; nota?: string }
    const encargo = /^e\d+$/.test(id) ? registro.obtener(id) : undefined
    if (/^e\d+$/.test(id) && encargo && !encargo.trabajoId) return res({ error: `El encargo ${id} todavía no terminó` })
    const trabajoId = encargo?.trabajoId ?? id
    const lista = (await read($, trabajos)) ?? []
    const t = lista.find(x => x.id === trabajoId)
    if (!t) return res({ error: `No existe el trabajo ${id}` })
    const p = Math.max(1, Math.min(10, Math.round(puntaje)))

    const tabla = ((await $.store.get(STORE_KEY)) ?? {}) as Puntajes
    const fila = (tabla[t.categoria] ??= {})
    const c = (fila[t.trabajador] ??= { n: 0, suma: 0, msTotal: 0 })
    c.n += 1
    c.suma += p
    c.msTotal += t.ms ?? 0
    await $.store.set(STORE_KEY, tabla)

    await update($, trabajos, l => (l ?? []).map(x => (x.id === trabajoId ? { ...x, puntaje: p } : x)))
    await puntuarEnHistorial($, trabajoId, p)
    await anotarCerebro($, t, p, nota)
    const avisoArchivo = await marcar($, t.subtarea, { estado: p >= 6 ? 'solucionado' : 'pendiente', quien: t.trabajador, puntaje: p })
    await avisarSiTermino($)
    if (p < 6) $.ui.toast(`${t.trabajador} sacó ${p}/10 en ${t.categoria}${nota ? `: ${corto(nota, 40)}` : ''}`)
    const subs = (await read($, plan))?.subtareas ?? []
    const catalogo = await leerCatalogoPlugin($)
    const progreso = {
      hechas: subs.filter(s => s.estado === 'solucionado').length, total: subs.length, faltan: subs.filter(s => s.estado !== 'solucionado').map(s => s.n),
      // Las pendientes cuyas dependencias ya están hechas: lánzalas ahora.
      lanzar_ya: listas(subs).map(s => s.n),
    }
    // Con nota baja, propone el siguiente modelo mejor clasificado para esa categoría (sin repetir el que falló).
    const siguiente = p < 6
      ? ordenar(tabla, t.categoria, todosLosCandidatos(modelos), new Set([...caidosAhora(), t.trabajador]), catalogo)[0]
      : undefined
    return res({
      guardado: true, categoria: t.categoria, trabajador: t.trabajador, puntaje: p, progreso,
      ...(avisoArchivo ? { aviso_archivo: avisoArchivo } : {}),
      ...(siguiente ? { siguiente, aviso: `Rinde poco: vuelve a delegar con trabajador "${siguiente.trabajador}" y modelo "${siguiente.modelo}" (o déjalos vacíos y el centro elige).` } : {}),
    })
  }).catch(async (_$, _e, next) => res({ error: `registrar_auditoria falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__cerrar_subtarea' }, async ($, e) => {
    const { subtarea } = args(e) as { subtarea: number; nota?: string }
    const n = Number(subtarea)
    const subs0 = (await read($, plan))?.subtareas ?? []
    if (!subs0.some(s => s.n === n)) return res({ error: `No existe la subtarea ${subtarea} en el plan` })
    const avisoArchivo = await marcar($, n, { estado: 'solucionado', quien: 'jefe' })
    await avisarSiTermino($)
    const subs = (await read($, plan))?.subtareas ?? []
    return res({ hecha: n, ...(avisoArchivo ? { aviso_archivo: avisoArchivo } : {}), progreso: { hechas: subs.filter(s => s.estado === 'solucionado').length, total: subs.length, faltan: subs.filter(s => s.estado !== 'solucionado').map(s => s.n), lanzar_ya: listas(subs).map(s => s.n) } })
  }).catch(async (_$, _e, next) => res({ error: `cerrar_subtarea falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__buscar_skills' }, async ($, e) => {
    const { consulta } = args(e) as { consulta?: string }
    const lista = await listarSkills($)
    const halladas = buscarSkills(lista, consulta ?? '')
    return res(halladas.length ? { total: lista.length, skills: halladas } : { total: lista.length, skills: [], aviso: 'Ninguna encaja; prueba otras palabras o sigue sin skill.' })
  }).catch(async (_$, _e, next) => res({ error: `buscar_skills falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__cerebro' }, async ($, e) => {
    const { consulta, area } = args(e) as { consulta?: string; area?: string }
    return res({ web: await urlWeb($), ...consultar(await leerCerebro($), String(consulta ?? ''), area) })
  }).catch(async (_$, _e, next) => res({ error: `cerebro falló: ${String(next.error)}` }))

  on('tool.call', { tool: 'mcp__centro-agentes__modelos' }, async ($, e) => {
    const a = args(e) as { agente?: any; necesita?: Capacidad[] }
    const catalogo = await leerCatalogoPlugin($)
    if (!catalogo) return res({ existe: false, aviso: 'Aún no hay catálogo: se genera al iniciar la sesión (puede tardar unos segundos).' })
    const tabla = ((await $.store.get(STORE_KEY)) ?? {}) as Puntajes
    // Filtrar las filas equivale a consultarCatalogo: 'si' es capacidades[cap] === true y el agente no cambia.
    const modelos = filasModelos(catalogo, tabla).filter(f => (!a.agente || f.agente === a.agente) && (a.necesita ?? []).every(cap => f[cap] === 'si'))
    return res({ generado: catalogo.generado, fuentes: catalogo.fuentes, total: modelos.length, modelos })
  }).catch(async (_$, _e, next) => res({ error: `modelos falló: ${String(next.error)}` }))

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

  on('tool.call', { tool: 'mcp__centro-agentes__tareas_estado' }, async ($, e) => {
    const a = args(e) as { cwd?: string }
    const raiz = a.cwd ?? (await read($, plan))?.raiz ?? rutaProyecto
    if (!raiz) return res({ existe: false, aviso: 'Aún no hay plan guardado: se crea con el primer planificar.' })
    const r = await tareasArchivo($, 'resumen', raiz)
    return res(r?.ok === false ? r : r?.existe === false ? { existe: false, aviso: 'Aún no hay plan guardado: se crea con el primer planificar.' } : r)
  }).catch(async (_$, _e, next) => res({ error: `tareas_estado falló: ${String(next.error)}` }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const { p, pct, resumenPanel, seccionesPanel, figuraPanelSvg, altFigura } = await armar($, e.viewport?.rows ?? 30)
    const listaTrabajos = (await read($, trabajos)) ?? []
    const ahora = Date.now()
    const vivos = filasVivas(listaTrabajos, ahora)
    // En una frase, lo que ocupa ahora a los agentes.
    const ahoraTexto = vivos.length
      ? `Ahora: ${vivos[0].agente}${vivos[0].tarea ? ` → ${tituloCorto(vivos[0].tarea, 10)}` : ''}`
      : 'Ahora: nada en marcha'
    const barra = (n: number, largo = 20) => '█'.repeat(Math.round((n / 100) * largo)).padEnd(largo, '░')
    // La terminal no dibuja SVG: la figura solo aparece donde hay superficie Svg.
    const Svg = 'Svg' in els ? els.Svg : undefined
    const enPlegadas = (await read($, plegadas)) ?? {}
    const alternar = (clave: string) => { void update($, plegadas, x => ({ ...x, [clave]: !x[clave] })) }
    const version = await versionDelPlugin($)
    // El título y, al lado, un glifo discreto: nada de botones con marco.
    const cabecera = (clave: string, titulo: string) => {
      const cab = cabeceraPlegable(enPlegadas, clave, titulo)
      return (
        <Box key={`cab-${clave}`} flexDirection="row" gap={1}>
          <Text bold color={GRIS.mid}>{cab.titulo}</Text>
          <Button key={`btn-${clave}`} plain dimColor onPress={() => alternar(clave)}>{cab.glifo}</Button>
        </Box>
      )
    }
    return (
      // Cada apartado en su tarjeta: borde fino y tenue, y la cabecera (título + glifo) dentro.
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" gap={1} marginBottom={1}>
          <Text bold>{TITULO}</Text>
          {version !== undefined && <Text dimColor>v{version} · /mst</Text>}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor={GRIS.lo} paddingX={1} marginBottom={1}>
          {cabecera('vivos', 'Agentes trabajando ahora')}
          {!estaPlegada(enPlegadas, 'vivos') && (
            <Box flexDirection="column">
              {vivos.length === 0 && <Text color={GRIS.lo}>nadie</Text>}
              {filasPanelVivo(listaTrabajos, ahora).map((v, i) => {
                const nombreModelo = v.modelo ? `${v.agente}:${v.modelo}` : v.agente
                return <Text key={i} color={v.color}>{[nombreModelo, v.tarea, v.tiempo].filter(Boolean).join('  ')}</Text>
              })}
            </Box>
          )}
        </Box>
        {/* Sin isInteractive: se dibuja como imagen y se ajusta al ancho del panel. */}
        {Svg && (
          <Box flexDirection="column" borderStyle="round" borderColor={GRIS.lo} paddingX={1} marginBottom={1}>
            {cabecera('figura', 'Figura')}
            {!estaPlegada(enPlegadas, 'figura') && <Svg source={figuraPanelSvg} alt={altFigura} />}
          </Box>
        )}
        <Box flexDirection="column" borderStyle="round" borderColor={GRIS.lo} paddingX={1} marginBottom={1}>
          {cabecera('resumen', 'Resumen')}
          {!estaPlegada(enPlegadas, 'resumen') && (
            <Box flexDirection="column">
              {p && <Text color={GRIS.hi}>{tituloCorto(p.objetivo, 12)}</Text>}
              <Text color={GRIS.mid}>{ahoraTexto}</Text>
              <Text><Text color={VINO}>{barra(pct)}</Text></Text>
              {resumenPanel.map((f, i) => {
                // Cada fila en su línea: la etiqueta apagada y los datos en el tono de la fila.
                const [etiqueta, ...resto] = f.celdas
                return (
                  <Text key={i} color={GRIS[f.tono]}>
                    <Text dimColor>{etiqueta}</Text>
                    {resto.length > 0 ? `  ${resto.join('  ·  ')}` : ''}
                  </Text>
                )
              })}
            </Box>
          )}
        </Box>
        {seccionesPanel.map(s => (
          <Box flexDirection="column" borderStyle="round" borderColor={GRIS.lo} paddingX={1} marginBottom={1} key={s.titulo}>
            {cabecera(s.titulo.toLowerCase(), s.titulo)}
            {!estaPlegada(enPlegadas, s.titulo.toLowerCase()) && (
              <Box flexDirection="column">
                {s.filas.length === 0 && s.vacio && <Text color={GRIS.lo}>{s.vacio}</Text>}
                {/* Sin cortar: el texto hace wrap y se ve todo. */}
                {s.filas.map((f, i) => <Text key={i} color={GRIS[f.tono]} wrap="wrap">{f.celdas.filter(Boolean).join(' · ')}</Text>)}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })

  // Los avisos del plugin se dibujan en una sola línea; con ctrl+o (isExpanded) salen enteros.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.origin.kind !== 'plugin' || e.isExpanded) return next(e)
    return next({ ...e, text: lineaAviso(e.text) })
  })
}
