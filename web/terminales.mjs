// Terminales del tablero: cada una es una conversación propia con un agente (su propio proceso, su carpeta y su historial).
// Se ven en vivo (la salida va llegando) y se les habla cuando quieras: si está ocupada, el mensaje espera su turno.
// Cada mensaje lanza al agente con lo hablado antes, así que sirve el mismo CLI para todos y no hace falta una sesión interactiva.
// Lo usa servidor.js: GET /terminal/estado y POST /terminal/{enviar,parar,cerrar}, con la clave y el chat de siempre.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { leerAider } from '../hooks/extras.ts'
import { sinAnsi, vistaDe } from '../hooks/nucleo.ts'

const CASA = path.join(os.homedir(), '.centro-agentes')
const AGENTES = ['opencode', 'ollama', 'hermes', 'aider', 'codex', 'claude']
// Si el tablero no elige modelo, el que mejor funciona sin pagar ni claves que caduquen.
const MODELO_POR_DEFECTO = { claude: 'haiku', ollama: 'gpt-oss:120b-cloud', opencode: 'ollama/gpt-oss:120b-cloud', hermes: 'ollama-local/gpt-oss:120b-cloud', aider: 'ollama_chat/gpt-oss:120b-cloud', codex: 'chatgpt' }
const TIEMPO_MAX_MS = 30 * 60_000
const MAX_ACTIVAS = 8
// Lo que se lee de la salida de cada agente; Aider mezcla su banner con la respuesta y se limpia aparte.
const textoDe = (agente, crudo) => sinAnsi(agente === 'aider' ? leerAider(crudo).texto : vistaDe(agente, crudo))
const MAX_HISTORIAL = 10_000 // caracteres de conversación que se le repiten al agente

// ---------- Procesos (mismas reglas que el servidor MCP del centro) ----------
// Los CLIs de npm son atajos .cmd: Node no los lanza sin shell. Se busca el .exe real que llama el atajo.
function ejecutable(nombre) {
  if (process.platform !== 'win32') return nombre
  const fijos = { hermes: path.join(os.homedir(), '.hermes', 'bin', 'hermes.exe'), aider: path.join(os.homedir(), '.aider', 'bin', 'aider.exe') }
  if (fijos[nombre] && fs.existsSync(fijos[nombre])) return fijos[nombre]
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue
    const exe = path.join(dir, nombre + '.exe')
    if (fs.existsSync(exe)) return exe
    const cmd = path.join(dir, nombre + '.cmd')
    if (fs.existsSync(cmd)) {
      const m = fs.readFileSync(cmd, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/)
      if (m) return path.join(dir, m[1])
    }
  }
  return nombre
}
function comandoNode(nombre) {
  if (process.platform === 'win32')
    for (const dir of (process.env.PATH ?? '').split(';')) {
      const cmd = dir && path.join(dir, nombre + '.cmd')
      if (!cmd || !fs.existsSync(cmd)) continue
      const m = fs.readFileSync(cmd, 'utf8').match(/"%dp0%\\([^"]+\.js)"/)
      if (m) return [process.execPath, path.join(dir, m[1])]
    }
  return [nombre]
}
function argvDe(agente, modelo, prompt, cwd) {
  if (agente === 'ollama') return { argv: [ejecutable('ollama'), 'run', '--nowordwrap', '--hidethinking', modelo], stdin: prompt }
  if (agente === 'opencode') return { argv: [ejecutable('opencode'), 'run', '--standalone', '--format', 'json', '-m', modelo], stdin: prompt }
  if (agente === 'hermes') {
    const i = modelo.indexOf('/')
    const [prov, m] = i > 0 ? [modelo.slice(0, i), modelo.slice(i + 1)] : ['auto', modelo]
    return { argv: [ejecutable('hermes'), 'chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--yolo', '--provider', prov, '-m', m], stdin: prompt }
  }
  if (agente === 'aider') {
    const nombrados = [...new Set(prompt.match(/[\w./\\-]+\.[A-Za-z]\w{0,5}\b/g) ?? [])]
    const archivos = nombrados.filter(a => fs.existsSync(path.join(cwd, a)))
    return { argv: [ejecutable('aider'), ...archivos, '--model', modelo, '--message', prompt, '--yes-always', '--no-git', '--no-pretty', '--no-stream', '--no-check-update', '--no-show-model-warnings', '--no-analytics', '--input-history-file', 'NUL', '--chat-history-file', 'NUL'] }
  }
  if (agente === 'codex') {
    const local = modelo.startsWith('ollama/') ? ['--oss', '--local-provider', 'ollama', '-m', modelo.slice('ollama/'.length)] : modelo && modelo !== 'chatgpt' ? ['-m', modelo] : []
    return { argv: [...comandoNode('codex'), 'exec', '--json', '--sandbox', 'danger-full-access', '--skip-git-repo-check', ...local], stdin: prompt }
  }
  return { argv: [ejecutable('claude'), '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', modelo], stdin: prompt }
}
function lanzar(argv, cwd, stdin) {
  // En Windows, un CLI que no es un .exe solo arranca a través de cmd; los saltos de línea de un argumento se aplanan.
  const porCmd = process.platform === 'win32' && !/\.exe$/i.test(argv[0])
  const orden = porCmd ? ['cmd', ['/d', '/s', '/c', argv.map((a, i) => (i === 0 || !/[\s"&|<>^%]/.test(a) ? a : `"${a.replace(/"/g, "'").replace(/\r?\n/g, ' ')}"`)).join(' ')]] : [argv[0], argv.slice(1)]
  const p = spawn(orden[0], orden[1], { cwd, env: { ...process.env, PWD: cwd, OLLAMA_API_BASE: 'http://127.0.0.1:11434', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(process.env.HERMES_HOME ? {} : { HERMES_HOME: path.join(os.homedir(), '.hermes') }) }, windowsHide: true })
  p.stdin.on('error', () => {})
  p.stdin.end(stdin ?? '') // sin cerrar stdin, algunos agentes se quedan esperando entrada
  return p
}
const matar = p => {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
  else p.kill('SIGKILL')
}

// ---------- Estado de las terminales (en memoria y en ~/.centro-agentes/terminales/<chat>/<id>.json) ----------
const terminales = new Map() // "<chat>/<id>" → { agente, modelo, cwd, turnos, cola, activo, proc, crudo, inicio }
const archivo = (chat, id) => path.join(CASA, 'terminales', chat, `${id}.json`)
function cargar(chat, id, agente) {
  const clave = `${chat}/${id}`
  let t = terminales.get(clave)
  if (t) return t
  t = { chat, id, agente, modelo: '', cwd: '', turnos: [], cola: [], activo: false, proc: null, crudo: '', inicio: 0 }
  try {
    const g = JSON.parse(fs.readFileSync(archivo(chat, id), 'utf8'))
    if (g.agente === agente) Object.assign(t, { modelo: g.modelo ?? '', cwd: g.cwd ?? '', turnos: Array.isArray(g.turnos) ? g.turnos : [] })
  } catch {}
  terminales.set(clave, t)
  return t
}
function guardar(t) {
  try {
    fs.mkdirSync(path.dirname(archivo(t.chat, t.id)), { recursive: true })
    fs.writeFileSync(archivo(t.chat, t.id), JSON.stringify({ agente: t.agente, modelo: t.modelo, cwd: t.cwd, turnos: t.turnos.slice(-60) }))
  } catch {}
}
const carpetaPropia = t => path.join(CASA, 'terminales', t.chat, `${t.id}-trabajo`)

// Lo que se le dice al agente: lo hablado antes (si lo hay) y el mensaje nuevo.
function promptDe(previos, texto) {
  if (!previos.length) return texto
  let historia = previos.map(x => `[${x.rol === 'usuario' ? 'Usuario' : 'Tú'}] ${x.texto}`).join('\n\n')
  if (historia.length > MAX_HISTORIAL) historia = '…' + historia.slice(-MAX_HISTORIAL)
  return `Esta es una conversación en curso con el usuario. Lo que ya se habló:\n\n${historia}\n\nAhora el usuario te dice:\n${texto}`
}

function siguiente(t) {
  const mensaje = t.cola.shift()
  if (!mensaje) { t.activo = false; return }
  t.activo = true
  t.inicio = Date.now()
  t.crudo = ''
  const previos = t.turnos.slice(0, t.turnos.indexOf(mensaje)).filter(x => !x.fallo)
  const cwd = t.cwd || carpetaPropia(t)
  fs.mkdirSync(cwd, { recursive: true })
  const { argv, stdin } = argvDe(t.agente, t.modelo || MODELO_POR_DEFECTO[t.agente], promptDe(previos, mensaje.texto), cwd)
  mensaje.enCola = false
  let stderr = ''
  let cortado = ''
  let p
  try {
    p = lanzar(argv, cwd, stdin)
  } catch (e) {
    t.turnos.push({ rol: 'agente', texto: `No se pudo lanzar ${t.agente}: ${e}`, fallo: true, en: Date.now() })
    guardar(t)
    siguiente(t)
    return
  }
  t.proc = p
  const tope = setTimeout(() => { cortado = 'tiempo máximo'; matar(p) }, TIEMPO_MAX_MS)
  p.stdout.on('data', d => { t.crudo += d })
  p.stderr.on('data', d => { stderr += d })
  p.on('error', e => { stderr += String(e) })
  p.on('close', codigo => {
    clearTimeout(tope)
    if (t.proc !== p) return // se cerró la terminal mientras trabajaba
    t.proc = null
    let texto = textoDe(t.agente, t.crudo).trim()
    const fallo = (codigo !== 0 && !texto) || !!cortado || (!texto && !!stderr.trim())
    if (cortado === 'parada') texto = `${texto}\n[parada por el usuario]`.trim()
    else if (cortado) texto = `${texto}\n[cortada: ${cortado}]`.trim()
    else if (fallo) texto = `${texto}\n[error] ${sinAnsi(stderr).trim().slice(-800) || `salió con código ${codigo}`}`.trim()
    t.turnos.push({ rol: 'agente', texto: texto || '(sin respuesta)', fallo, ms: Date.now() - t.inicio, en: Date.now() })
    t.crudo = ''
    guardar(t)
    siguiente(t)
  })
  t.parar = () => { cortado = 'parada'; matar(p) }
}

// ---------- Rutas ----------
const ID = /^[\w-]{1,60}$/
const MODELO = /^[\w.:\/@+-]{0,100}$/
const vista = t => ({
  agente: t.agente,
  modelo: t.modelo || MODELO_POR_DEFECTO[t.agente],
  cwd: t.cwd || carpetaPropia(t),
  estado: t.activo ? 'trabajando' : 'libre',
  ms: t.activo ? Date.now() - t.inicio : 0,
  turnos: t.turnos.slice(-30).map(x => ({ rol: x.rol, texto: x.texto.slice(-6000), fallo: !!x.fallo, ms: x.ms, enCola: !!x.enCola })),
  actual: t.activo ? textoDe(t.agente, t.crudo).slice(-6000) : '',
})

// accion: { ruta: 'estado'|'enviar'|'parar'|'cerrar', chat, id, agente, modelo, cwd, texto }
export function manejar(a) {
  const mal = texto => ({ codigo: 400, datos: { error: texto } })
  if (!ID.test(a.id ?? '') || !AGENTES.includes(a.agente)) return mal('terminal inválida')
  if (a.ruta === 'cerrar') {
    const t = terminales.get(`${a.chat}/${a.id}`)
    if (t?.proc) { const p = t.proc; t.proc = null; matar(p) }
    terminales.delete(`${a.chat}/${a.id}`)
    try { fs.rmSync(archivo(a.chat, a.id), { force: true }) } catch {}
    return { codigo: 200, datos: { ok: true } }
  }
  const t = cargar(a.chat, a.id, a.agente)
  if (a.ruta === 'estado') return { codigo: 200, datos: vista(t) }
  if (a.ruta === 'parar') {
    // Para solo lo que está haciendo: si hay mensajes en cola, siguen después.
    t.parar?.()
    return { codigo: 200, datos: { ok: true } }
  }
  if (a.ruta !== 'enviar') return { codigo: 404, datos: { error: 'no existe' } }
  const texto = typeof a.texto === 'string' ? a.texto.trim() : ''
  if (!texto || texto.length > 4000) return mal('mensaje vacío o demasiado largo')
  if (typeof a.modelo !== 'string' || !MODELO.test(a.modelo)) return mal('modelo inválido')
  let cwd = ''
  if (a.cwd) {
    try {
      if (typeof a.cwd !== 'string' || !path.isAbsolute(a.cwd) || !fs.statSync(a.cwd).isDirectory()) throw new Error()
      cwd = path.resolve(a.cwd)
    } catch {
      return mal('la carpeta no existe')
    }
  }
  if (!t.activo && [...terminales.values()].filter(x => x.activo).length >= MAX_ACTIVAS) return { codigo: 429, datos: { error: `ya hay ${MAX_ACTIVAS} terminales trabajando` } }
  Object.assign(t, { modelo: a.modelo, cwd })
  const mensaje = { rol: 'usuario', texto, en: Date.now(), enCola: t.activo }
  t.turnos.push(mensaje)
  t.cola.push(mensaje)
  guardar(t)
  if (!t.activo) siguiente(t)
  return { codigo: 200, datos: vista(t) }
}
