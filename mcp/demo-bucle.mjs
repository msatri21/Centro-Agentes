// Simulación en bucle del centro trabajando: un chat inventado ("demo-bucle") que repite una historia completa
// (plan, cinco OpenCode a la vez, un fallo con relevo, una card en silencio, otra con una pregunta, otra pidiendo
// permiso, notas y "Todo listo") para ver cómo se comporta el grafo con una card por agente desplegado.
// No lanza ningún agente ni gasta nada. Uso: node mcp/demo-bucle.mjs   (Ctrl+C para parar; borra el chat inventado al salir)
// Levanta su propio servidor con la web de esta carpeta (puerto 47399), sin tocar el que ya tengas en el 47321:
// http://127.0.0.1:47399/?t=<clave>&s=demo-bucle
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paginaCentro } from '../hooks/vista.ts'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const CASA = path.join(os.homedir(), '.centro-agentes')
const ID = 'demo-bucle'
const PUERTO = 47399
const DIR = path.join(CASA, 'chats', ID)
const ARCHIVO_CLAVE = path.join(CASA, 'clave.txt')
// Sin clave la web responde 403: se crea una de usar y tirar solo si no existe ninguna.
fs.mkdirSync(CASA, { recursive: true })
if (!fs.existsSync(ARCHIVO_CLAVE)) fs.writeFileSync(ARCHIVO_CLAVE, Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
const clave = fs.readFileSync(ARCHIVO_CLAVE, 'utf8').trim()
const CICLO = 84 // segundos que dura la historia antes de repetirse
const PASO_MS = 1500

const MODELOS = {
  opencode: ['opencode/deepseek-v4.1-flash-free'], ollama: ['gpt-oss:120b-cloud'], hermes: ['nous/poolside/laguna-s-2.1:free'],
  aider: ['ollama_chat/llama3.2:3b'], codex: ['chatgpt'], claude: ['haiku'],
}
const AGENTES = [
  { nombre: 'opencode', ok: true, nota: '5 modelos' }, { nombre: 'ollama', ok: true, nota: '6 modelos' }, { nombre: 'hermes', ok: true, nota: '4 modelos' },
  { nombre: 'aider', ok: true, nota: '1 modelo' }, { nombre: 'codex', ok: true, nota: 'cuenta de ChatGPT' }, { nombre: 'claude', ok: true, nota: '3 modelos' },
]
const SUBS = [
  { n: 1, titulo: 'Función cubo en productos.py' }, { n: 2, titulo: 'Resumen del README' }, { n: 3, titulo: 'Tests de la calculadora' },
  { n: 4, titulo: 'Función raíz con validación' }, { n: 5, titulo: 'Validar las entradas' }, { n: 6, titulo: 'Script de despliegue' },
  { n: 7, titulo: 'Revisar y entregar', espera: [1, 2, 3, 4, 5, 6] },
]
const ULTIMA = SUBS.length
// Trabajos de la historia: cuándo empiezan y terminan (en segundos de la historia) y la nota que reciben.
// `callado: [desde, hasta]` = el agente no escribe nada (alarma de silencio). `pendiente: [desde, hasta, tipo, texto, extra]` = espera al usuario:
// se escribe de verdad en consultas.jsonl y se puede contestar desde la web; al contestar, la alarma se apaga.
const HISTORIA = [
  { id: 'a', quien: 'opencode:opencode/deepseek-v4.1-flash-free', sub: 1, ini: 6, fin: 20, nota: [24, 9], ti: 24000, to: 300, lineas: ['› editando productos.py', '› python test_calc.py', 'ok: 4 pass'] },
  { id: 'b', quien: 'ollama:gpt-oss:120b-cloud', sub: 2, ini: 6, fin: 10, error: true, ti: 100, to: 0, lineas: ['escribiendo…', '✗ 429: sin cupo'] },
  { id: 'e', quien: 'hermes:nous/poolside/laguna-s-2.1:free', sub: 2, ini: 11, fin: 30, nota: [34, 8], ti: 52000, to: 900, lineas: ['› relevo: subtarea 2', '› leyendo README.md', 'ok'] },
  { id: 'c', quien: 'opencode:opencode/glm-5.3-flash-free', sub: 3, ini: 7, fin: 24, nota: [28, 9], ti: 31000, to: 410, lineas: ['› test_calc.py', '› python -m pytest', 'ok: 6 pass'] },
  { id: 'd', quien: 'opencode:opencode/minimax-m3.1-flash-free', sub: 4, ini: 8, fin: 46, callado: [18, 40], nota: [50, 8], ti: 40000, to: 520, lineas: ['› productos.py', '› raiz(x) con validación', 'ok: 3 pass'] },
  { id: 'g', quien: 'opencode:opencode/nemotron-3-ultra-free', sub: 5, ini: 8, fin: 42, pendiente: [16, 34, 'pregunta', '¿Valido las entradas con una expresión regular o con una librería?', { opciones: ['Expresión regular', 'Librería'] }], nota: [46, 9], ti: 36000, to: 380, lineas: ['› validar.py', '› esperando tu respuesta…', 'ok: 5 pass'] },
  { id: 'h', quien: 'opencode:opencode/big-pickle', sub: 6, ini: 9, fin: 48, pendiente: [22, 38, 'permiso', 'Quiere instalar pm2 en todo el sistema', { detalle: 'npm install --global pm2', categoria: 'instalar' }], nota: [52, 7], ti: 45000, to: 610, lineas: ['› deploy.sh', '› necesita instalar pm2', 'ok'] },
  { id: 'k', quien: 'codex:chatgpt', sub: 6, ini: 54, fin: 62, nota: [66, 9], ti: 18000, to: 260, lineas: ['› revisando deploy.sh', '› shellcheck deploy.sh', 'ok'] },
]
const CIERRE = 72 // el jefe cierra la última subtarea

function estadoEn(t, respondidas) {
  const ahora = Date.now()
  const base = ahora - t * 1000
  const pendientes = []
  const trabajos = HISTORIA.filter(h => t >= h.ini).map(h => {
    const terminado = t >= h.fin
    const puntaje = h.nota && t >= h.nota[0] ? h.nota[1] : undefined
    const l = h.lineas
    const visibles = terminado ? l : l.slice(0, 1 + Math.min(l.length - 1, Math.floor((t - h.ini) / 3)))
    const callado = !terminado && h.callado && t >= h.callado[0] && t <= h.callado[1]
    if (!terminado && h.pendiente && t >= h.pendiente[0] && t <= h.pendiente[1] && !respondidas.has('demo-' + h.id)) {
      pendientes.push({ id: h.id, consulta: 'demo-' + h.id, agente: h.quien.split(':')[0], tipo: h.pendiente[2], texto: h.pendiente[3], ...(h.pendiente[4] ?? {}), en: ahora })
    }
    return {
      id: h.id, trabajador: h.quien, categoria: 'demo', tarea: SUBS[h.sub - 1].titulo, estado: terminado ? (h.error ? 'error' : 'listo') : 'corriendo',
      inicio: base + h.ini * 1000, ms: terminado ? (h.fin - h.ini) * 1000 : undefined, subtarea: h.sub, puntaje,
      tokensIn: terminado ? h.ti : undefined, tokensOut: terminado ? h.to : undefined, salida: visibles.join('\n'),
      // Un agente en silencio lleva más de un minuto sin escribir; los demás acaban de hablar.
      ultimaActividad: callado ? ahora - 75_000 : ahora - 1500,
    }
  })
  const subtareas = SUBS.map(s => {
    const suyos = trabajos.filter(w => w.subtarea === s.n)
    const bueno = suyos.find(w => w.puntaje !== undefined && w.puntaje >= 6)
    const estado = s.n === ULTIMA ? (t >= CIERRE ? 'hecha' : 'pendiente') : bueno ? 'hecha' : suyos.some(w => w.estado === 'corriendo') ? 'en curso' : 'pendiente'
    const ultimo = suyos[suyos.length - 1]
    return { ...s, estado, quien: s.n === ULTIMA && estado === 'hecha' ? 'jefe' : bueno?.trabajador ?? ultimo?.trabajador, puntaje: bueno?.puntaje }
  })
  return { ahora, trabajos, pendientes, plan: t >= 2 ? { objetivo: 'Calculadora completa hecha por varios agentes (demo)', subtareas } : null }
}

// Las consultas de la historia se escriben de verdad (como haría un agente) para que se puedan contestar desde la web.
function abrirConsultas() {
  fs.mkdirSync(DIR, { recursive: true })
  for (const n of ['respuestas.jsonl', 'permisos.json']) fs.rmSync(path.join(DIR, n), { force: true })
  const lineas = HISTORIA.filter(h => h.pendiente).map(h => JSON.stringify({ id: 'demo-' + h.id, trabajo: h.id, tipo: h.pendiente[2], texto: h.pendiente[3], ...(h.pendiente[4] ?? {}), en: Date.now() }))
  fs.writeFileSync(path.join(DIR, 'consultas.jsonl'), lineas.join('\n') + '\n')
}
const respondidas = () => {
  try {
    return new Set(fs.readFileSync(path.join(DIR, 'respuestas.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id))
  } catch {
    return new Set()
  }
}
let anterior = Infinity
function escribir(t) {
  // Al empezar otra vuelta de la historia, las consultas vuelven a abrirse.
  if (t < anterior) abrirConsultas()
  anterior = t
  const { ahora, trabajos, plan, pendientes } = estadoEn(t, respondidas())
  const ahorro = trabajos.reduce((s, w) => s + ((w.tokensIn ?? 0) * 2 + (w.tokensOut ?? 0) * 10) / 1_000_000, 0)
  const corriendo = trabajos.filter(w => w.estado === 'corriendo')
  const html = paginaCentro({
    clave, chat: 'demo-bucle · simulación', jefe: 'Claude', plan, trabajos, agentes: AGENTES, modelos: MODELOS, pendientes,
    rendimiento: [{ quien: 'opencode:deepseek-v4.1', media: 9, n: 14, segundos: 11 }, { quien: 'hermes:laguna-s-2.1', media: 8.5, n: 9, segundos: 38 }, { quien: 'codex:chatgpt', media: 8, n: 6, segundos: 14 }, { quien: 'ollama:gpt-oss:120b', media: 7, n: 4, segundos: 3 }],
    ahorro: ahorro + 1.8,
    cancelables: corriendo.map(w => ({ id: w.id, titulo: `${w.trabajador.split(':')[0]} · ${w.tarea.slice(0, 28)}` })), relanzables: [], version: 'demo', ahora,
  })
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(path.join(DIR, 'centro.html'), html)
  // El índice "todos los chats" lee esto para mostrar el progreso.
  fs.writeFileSync(path.join(DIR, 'estado.json'), JSON.stringify({ plan, trabajos, encargos: [], nombre: 'demo-bucle' }))
}

// El servidor de esta carpeta, aparte del que ya tengas en el 47321. Si el puerto ya está ocupado, sale solo (servidor.js termina con 3).
const servidor = spawn(process.execPath, [path.join(AQUI, '..', 'web', 'servidor.js'), String(PUERTO), ARCHIVO_CLAVE, path.join(CASA, 'chats'), 'demo'], { stdio: 'ignore' })
const salir = () => {
  servidor.kill()
  fs.rmSync(DIR, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGINT', salir)
process.on('SIGTERM', salir)

const inicio = Date.now()
console.log(`demo-bucle en marcha (Ctrl+C para parar): http://127.0.0.1:${PUERTO}/?t=${clave}&s=${ID}`)
setInterval(() => escribir(((Date.now() - inicio) / 1000) % CICLO), PASO_MS)
escribir(0)
