#!/usr/bin/env node
// Lanzador de agentes: ejecuta el agente y deja TODO en disco (argv, stdin, salida en vivo, pid y final).
// Así una instancia posterior del plugin puede leer el trabajo aunque la que lo lanzó ya no exista.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

const [carpeta, id, ...opciones] = process.argv.slice(2)
if (!carpeta || !id) {
  process.stderr.write('uso: node mcp/lanzador.mjs <carpeta> <id> [--desacoplado]\n')
  process.exit(1)
}

// --desacoplado: este proceso solo relanza al lanzador de verdad fuera del árbol de quien lo llamó y sale al instante.
// Así el plugin lo lanza con $.process.spawn (que no permite desacoplar) y, aunque el plugin muera o se recargue
// y el sistema cierre sus procesos hijos, el agente y su lanzador siguen y dejan el resultado en disco.
if (opciones.includes('--desacoplado')) {
  const hijo = spawn(process.execPath, [fileURLToPath(import.meta.url), carpeta, id], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  })
  hijo.on('error', () => process.exit(1))
  hijo.unref()
  setTimeout(() => process.exit(0), 100)
  await new Promise(() => {})
}

const ruta = ext => path.join(carpeta, id + ext)
const FIN = ruta('.fin.json')
const CANCELAR = ruta('.cancelar')

// El lanzador no puede depender de quien lo lanzó: si su stdout/stderr ya no existen, escribir ahí no lo tira.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

let escrito = false
// fin.json es lo último que se escribe: se escribe aparte y se renombra para que nunca se lea a medias.
function escribirFin(datos) {
  if (escrito) return
  escrito = true
  const tmp = FIN + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(datos))
    fs.renameSync(tmp, FIN)
  } catch {}
}

function anotar(stream, texto) {
  if (!texto) return
  try { fs.appendFileSync(ruta('.log'), JSON.stringify({ s: stream, t: texto }) + '\n') } catch {}
}

function leerArgv() {
  try {
    const argv = JSON.parse(fs.readFileSync(ruta('.argv.json'), 'utf8'))
    return Array.isArray(argv) && argv.length && argv.every(a => typeof a === 'string') ? argv : undefined
  } catch {
    return undefined
  }
}

// Sin <id>.in el agente recibe stdin vacío y cerrado (si no, los que lo leen se quedan esperando).
function leerEntrada() {
  try { return fs.readFileSync(ruta('.in')) } catch { return Buffer.alloc(0) }
}

// En Windows los CLIs de npm son atajos .cmd: spawn sin shell da ENOENT/EINVAL y solo cmd los lanza.
function existeEnWindows(nombre) {
  const limpio = nombre.replace(/^"|"$/g, '')
  if (/[\\/]/.test(limpio)) return fs.existsSync(limpio)
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue
    const base = path.join(dir.replace(/^"|"$/g, ''), limpio)
    if (fs.existsSync(base) || exts.some(ext => fs.existsSync(base + ext))) return true
  }
  return false
}

function arrancar(argv, verbatim = false) {
  return new Promise(resolve => {
    let proceso
    try {
      proceso = spawn(argv[0], argv.slice(1), {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Sin esto, Node vuelve a escapar las comillas del comando que ya va entrecomillado para cmd.
        windowsVerbatimArguments: verbatim,
        // Fuera de Windows el agente abre su propio grupo: cancelar mata a todo el árbol con process.kill(-pid).
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      resolve({ error })
      return
    }
    proceso.once('spawn', () => resolve({ proceso }))
    proceso.once('error', error => resolve({ error }))
  })
}

function matarArbol(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
      return
    }
    try { process.kill(-pid, 'SIGKILL') } catch { process.kill(pid, 'SIGKILL') }
  } catch {}
}

// Los logs de agentes que terminaron hace días ya no le sirven a nadie: se borran al lanzar uno nuevo (el plugin no puede borrar archivos).
const CADUCIDAD_MS = 3 * 24 * 60 * 60 * 1000
function limpiarViejos() {
  try {
    for (const nombre of fs.readdirSync(carpeta)) {
      const ruta = path.join(carpeta, nombre)
      try { if (Date.now() - fs.statSync(ruta).mtimeMs > CADUCIDAD_MS) fs.rmSync(ruta, { force: true }) } catch {}
    }
  } catch {}
}

async function principal() {
  limpiarViejos()
  const argv = leerArgv()
  if (!argv) {
    escribirFin({ code: null, signal: null, cancelado: false, fin: Date.now(), error: 'argv.json ausente o inválido' })
    process.exit(1)
  }

  let arranque = await arrancar(argv)
  if (arranque.error && process.platform === 'win32' && ['ENOENT', 'EINVAL'].includes(arranque.error.code) && existeEnWindows(argv[0])) {
    // El nombre del comando va sin comillas si no las necesita: con comillas, cmd no resuelve los atajos .cmd de pnpm (%~dp0 queda vacío).
    const comillas = (a, primero) => (primero && !/[\s&|<>^()%!"]/.test(a) ? a : `"${a.replace(/"/g, "'")}"`)
    const linea = argv.map((a, i) => comillas(a, i === 0)).join(' ')
    arranque = await arrancar(['cmd', '/d', '/s', '/c', `"${linea}"`], true)
  }
  if (arranque.error || !arranque.proceso?.pid) {
    const error = String(arranque.error?.message ?? arranque.error ?? 'no se pudo arrancar el agente')
    escribirFin({ code: null, signal: null, cancelado: false, fin: Date.now(), error })
    process.exit(1)
  }

  const agente = arranque.proceso
  agente.on('error', () => {}) // un kill fallido no debe tirar el lanzador
  try { fs.writeFileSync(ruta('.pid.json'), JSON.stringify({ lanzador: process.pid, agente: agente.pid, inicio: Date.now() })) } catch {}

  agente.stdin.on('error', () => {})
  agente.stdin.end(leerEntrada())

  const decodificar = (flujo, stream) => {
    const decodificador = new StringDecoder('utf8') // no parte los caracteres multibyte entre trozos
    flujo.on('data', trozo => anotar(stream, decodificador.write(trozo)))
    flujo.on('end', () => anotar(stream, decodificador.end()))
    flujo.on('error', () => {})
  }
  decodificar(agente.stdout, 'stdout')
  decodificar(agente.stderr, 'stderr')

  let cancelado = false
  const vigilante = setInterval(() => {
    if (cancelado || !fs.existsSync(CANCELAR)) return
    cancelado = true
    matarArbol(agente.pid)
  }, 500)

  agente.on('close', (code, signal) => {
    clearInterval(vigilante)
    escribirFin({ code: code ?? null, signal: signal ?? null, cancelado, fin: Date.now() })
    process.exit(code ?? 1)
  })
}

principal().catch(error => {
  escribirFin({ code: null, signal: null, cancelado: false, fin: Date.now(), error: String(error?.message ?? error) })
  process.exit(1)
})
