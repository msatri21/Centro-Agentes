// Prueba en vivo del centro con agentes REALES: OpenCode con modelos gratuitos, trabajando en una carpeta de usar y tirar.
// Cada tanda lanza cinco agentes a la vez; varios se paran a preguntarte o a pedirte permiso, y uno se queda callado un minuto
// (alarma de silencio). Tú contestas en la web. Cuando una tanda termina, empieza otra, hasta que la pares con Ctrl+C
// o pasen las tandas que pidas (por defecto 30). Al parar se borra todo lo que creó.
//
// Levanta su propio servidor con la web de esta carpeta (puerto 47399), sin tocar el que ya tengas en el 47321.
// Uso: node mcp/prueba-en-vivo.mjs [tandas]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { llamarHastaTerminar } from './ayuda-prueba.mjs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const TANDAS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 30
const PUERTO = 47399
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-en-vivo-'))
const CHATS = path.join(TMP, 'chats')
const SANDBOX = path.join(TMP, 'carpeta-de-trabajo')
const CLAVE = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
fs.mkdirSync(CHATS, { recursive: true })
fs.mkdirSync(SANDBOX, { recursive: true })
fs.writeFileSync(path.join(TMP, 'clave.txt'), CLAVE)

const MODELOS = ['opencode/deepseek-v4.1-flash-free', 'opencode/glm-5.3-flash-free', 'opencode/minimax-m3.1-flash-free', 'opencode/nemotron-3-ultra-free', 'opencode/big-pickle']
const dormir = ms => new Promise(r => setTimeout(r, ms))
const hora = () => new Date().toLocaleTimeString('es')
const log = (...a) => console.log(`[${hora()}]`, ...a)

const web = spawn(process.execPath, [path.join(AQUI, '..', 'web', 'servidor.js'), String(PUERTO), path.join(TMP, 'clave.txt'), CHATS, 'en-vivo'], { stdio: 'ignore' })
const centro = spawn(process.execPath, [path.join(AQUI, 'centro-mcp.mjs')], {
  env: { ...process.env, CENTRO_CHATS: CHATS, CENTRO_SIN_NAVEGADOR: '1', CENTRO_SIN_WEB: '1', CENTRO_MODELOS: JSON.stringify({ opencode: MODELOS }) },
  stdio: ['pipe', 'pipe', 'inherit'],
})
let parando = false
function parar() {
  if (parando) return
  parando = true
  log('Parando: se cierran los agentes y se borra lo que creó la prueba.')
  try { centro.stdin.end() } catch {}
  try { centro.kill() } catch {}
  try { web.kill() } catch {}
  // Los agentes que ya estaban en marcha se cierran con el centro; se borra la carpeta cuando ya no la usan.
  setTimeout(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }, 1500)
}
process.on('SIGINT', parar)
process.on('SIGTERM', parar)
process.on('exit', () => { try { web.kill() } catch {} })

// Cliente MCP mínimo (una línea JSON por mensaje) hacia el centro.
let resto = ''
let n = 0
const pendientes = new Map()
centro.stdout.on('data', d => {
  resto += d
  let i
  while ((i = resto.indexOf('\n')) >= 0) {
    const m = JSON.parse(resto.slice(0, i))
    resto = resto.slice(i + 1)
    pendientes.get(m.id)?.(m)
  }
})
const pedir = (method, params) => new Promise(r => { const id = ++n; pendientes.set(id, r); centro.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
const herramienta = async (name, args) => {
  const r = await pedir('tools/call', { name, arguments: args })
  const t = r.result?.content?.[0]?.text ?? ''
  try { return JSON.parse(t) } catch { return t }
}

// Lo que hace cada agente en cada tanda: unos preguntan, otros piden permiso, uno se queda callado y otro trabaja sin molestar.
const tareas = k => [
  { subtarea: 1, categoria: 'prueba-pregunta', archivos: [`saludo-${k}.txt`], tarea: `Crea el archivo saludo-${k}.txt con un saludo corto. ANTES de crearlo, usa la herramienta preguntar para preguntar al usuario cómo se llama y usa su respuesta en el saludo.` },
  { subtarea: 2, categoria: 'prueba-permiso', archivos: [`instalar-${k}.txt`], tarea: `Crea el archivo instalar-${k}.txt con el texto "pm2 instalado (simulado)". ANTES, usa la herramienta pedir_permiso con categoria "instalar", accion "Instalar pm2 globalmente" y detalle "npm install --global pm2". Si te lo deniegan, escribe "no instalado" en su lugar. NO ejecutes ninguna instalación real.` },
  { subtarea: 3, categoria: 'prueba-destructivo', archivos: [`resultado-${k}.txt`, `temporal-${k}`], tarea: `Crea la carpeta temporal-${k} con un archivo dentro. Luego usa la herramienta pedir_permiso con categoria "destructivo", accion "Borrar la carpeta temporal-${k}" y detalle "rm -rf temporal-${k}". Solo si te lo aprueban, bórrala. Escribe en resultado-${k}.txt qué pasó.` },
  { subtarea: 4, categoria: 'prueba-silencio', archivos: [`listo-${k}.txt`], tarea: `Ejecuta en la terminal exactamente este comando y espera a que termine (tarda más de un minuto): ping -n 75 127.0.0.1 > nul   Después crea listo-${k}.txt con la palabra listo.` },
  { subtarea: 5, categoria: 'prueba-simple', archivos: [`notas-${k}.md`], tarea: `Crea notas-${k}.md con 3 viñetas sobre por qué conviene probar antes de entregar.` },
]
// Tres objetivos que se alternan: cada uno es un cuadrado del grafo; al repetirse, su cuadrado se reactiva.
const OBJETIVOS = ['Calculadora con tests', 'Pantalla de inicio de sesión', 'Informe de ventas']
const titulos = ['Saludo con una pregunta', 'Instalar pm2 con permiso', 'Borrar una carpeta con permiso', 'Un comando largo (silencio)', 'Notas sin molestar']

try {
  await pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba-en-vivo', version: '1' } })
  let id = ''
  log('Prueba en vivo preparada. Ábrela cuando quieras en tu navegador:')
  for (let k = 1; k <= TANDAS && !parando; k++) {
    const plan = await herramienta('planificar', { objetivo: OBJETIVOS[(k - 1) % OBJETIVOS.length], subtareas: titulos })
    if (!id) {
      id = new URL(plan.web ?? 'http://x/').searchParams.get('s') ?? ''
      console.log('')
      console.log(`    http://127.0.0.1:${PUERTO}/?t=${CLAVE}&s=${id}`)
      console.log('')
    }
    log(`Tanda ${k}: lanzo cinco agentes reales.`)
    const r = await llamarHastaTerminar(herramienta, 'delegar_varios', {
      tareas: tareas(k).map((t, i) => ({ ...t, cwd: SANDBOX, trabajador: 'opencode', modelo: MODELOS[i % MODELOS.length] })),
    })
    for (const x of r.resultados ?? []) {
      log(`  ${x.exito ? '✓' : '✗'} subtarea ${x.subtarea} · ${x.trabajador} · ${x.segundos} s`)
      if (x.id) await herramienta('registrar_auditoria', { id: x.id, puntaje: x.exito ? 8 : 3, nota: 'prueba en vivo' })
    }
    if (k < TANDAS && !parando) {
      log('Pausa de 20 s y empieza otra tanda (Ctrl+C para parar).')
      await dormir(20_000)
    }
  }
  log('Terminaron las tandas pedidas.')
} finally {
  parar()
}
