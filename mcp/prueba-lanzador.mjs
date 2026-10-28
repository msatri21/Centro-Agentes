#!/usr/bin/env node
// Prueba del lanzador: salida en vivo, código de salida, stdin, cancelación, arranque fallido y supervivencia al padre.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const LANZADOR = fileURLToPath(new URL('./lanzador.mjs', import.meta.url))
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'lanzador-'))
const fallos = []

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms))
const ruta = (id, ext) => path.join(CARPETA, id + ext)
const leerJson = fichero => {
  try { return JSON.parse(fs.readFileSync(fichero, 'utf8')) } catch { return undefined }
}
const log = id => {
  try {
    return fs.readFileSync(ruta(id, '.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch {
    return []
  }
}
const texto = (id, stream) => log(id).filter(x => x.s === stream).map(x => x.t).join('')
const comprobar = (condicion, mensaje) => { if (!condicion) fallos.push(mensaje) }
const agenteFalso = (nombre, codigo) => {
  const fichero = path.join(CARPETA, nombre)
  fs.writeFileSync(fichero, codigo)
  return fichero
}
const preparar = (id, argv) => fs.writeFileSync(ruta(id, '.argv.json'), JSON.stringify(argv))
const lanzar = id => {
  const p = spawn(process.execPath, [LANZADOR, CARPETA, id], { cwd: CARPETA, stdio: 'ignore', windowsHide: true })
  p.on('error', () => {})
  return p
}
async function esperarFin(id, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const fin = leerJson(ruta(id, '.fin.json'))
    if (fin) return fin
    await dormir(25)
  }
  return undefined
}
async function correr(id, ms = 15000) {
  const p = lanzar(id)
  const codigo = await new Promise(resolve => {
    const t = setTimeout(() => { try { p.kill() } catch {}; resolve(undefined) }, ms)
    p.on('close', c => { clearTimeout(t); resolve(c) })
  })
  return { codigo, fin: leerJson(ruta(id, '.fin.json')) }
}
const vivo = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}
async function esperarMuerto(pid, ms = 2000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (!vivo(pid)) return true
    await dormir(50)
  }
  return false
}

async function main() {
  // (g) al lanzar, borra los archivos de más de 3 días y deja los recientes.
  const viejo = path.join(CARPETA, 'viejo.log'), reciente = path.join(CARPETA, 'reciente.log')
  fs.writeFileSync(viejo, 'x'); fs.writeFileSync(reciente, 'x')
  const hace4Dias = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
  fs.utimesSync(viejo, hace4Dias, hace4Dias)
  preparar('g', [process.execPath, agenteFalso('agente-g.mjs', "process.stdout.write('g')\n")])
  await correr('g')
  comprobar(!fs.existsSync(viejo), '(g) no borró el archivo viejo')
  comprobar(fs.existsSync(reciente), '(g) borró un archivo reciente')
  // (a) stdout y stderr, con su stream y código 0.
  preparar('a', [process.execPath, agenteFalso('agente-a.mjs', "process.stdout.write('hola')\nprocess.stderr.write('aviso')\n")])
  const a = await correr('a')
  comprobar(a.fin?.code === 0, `(a) fin.json: ${JSON.stringify(a.fin)}`)
  comprobar(log('a').some(x => x.s === 'stdout' && x.t.includes('hola')), '(a) falta "hola" en stdout')
  comprobar(log('a').some(x => x.s === 'stderr' && x.t.includes('aviso')), '(a) falta "aviso" en stderr')
  comprobar(!texto('a', 'stdout').includes('aviso') && !texto('a', 'stderr').includes('hola'), '(a) streams cruzados')

  // (b) el código del agente pasa al lanzador.
  preparar('b', [process.execPath, agenteFalso('agente-b.mjs', 'process.exit(3)\n')])
  const b = await correr('b')
  comprobar(b.fin?.code === 3, `(b) fin.json: ${JSON.stringify(b.fin)}`)
  comprobar(b.codigo === 3, `(b) el lanzador salió con ${b.codigo}`)

  // (c) stdin con acento y ñ, de ida y vuelta.
  const agenteC = agenteFalso('agente-c.mjs', [
    "process.stdin.setEncoding('utf8')",
    "let t = ''",
    "process.stdin.on('data', d => { t += d })",
    "process.stdin.on('end', () => process.stdout.write(t))",
    '',
  ].join('\n'))
  preparar('c', [process.execPath, agenteC])
  fs.writeFileSync(ruta('c', '.in'), 'café ñandú')
  const c = await correr('c')
  comprobar(c.fin?.code === 0, `(c) fin.json: ${JSON.stringify(c.fin)}`)
  comprobar(texto('c', 'stdout') === 'café ñandú', `(c) stdin no volvió intacto: ${JSON.stringify(texto('c', 'stdout'))}`)

  // (d) cancelar mata al agente y a su hijo.
  const agenteD = agenteFalso('agente-d.mjs', [
    "import { spawn } from 'node:child_process'",
    "const hijo = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })",
    "process.stdout.write('hijo:' + hijo.pid + '\\n')",
    'setTimeout(() => {}, 60000)',
    '',
  ].join('\n'))
  preparar('d', [process.execPath, agenteD])
  lanzar('d')
  const tPid = Date.now()
  let pids
  while (Date.now() - tPid < 5000 && !pids) {
    pids = leerJson(ruta('d', '.pid.json'))
    if (!pids) await dormir(25)
  }
  let hijoPid
  const tHijo = Date.now()
  while (Date.now() - tHijo < 5000 && !hijoPid) {
    const m = texto('d', 'stdout').match(/hijo:(\d+)/)
    if (m) hijoPid = Number(m[1])
    else await dormir(25)
  }
  fs.writeFileSync(ruta('d', '.cancelar'), '')
  const d = await esperarFin('d', 5000)
  comprobar(d?.cancelado === true, `(d) fin.json sin cancelado: ${JSON.stringify(d)}`)
  comprobar(Boolean(pids) && (await esperarMuerto(pids.agente)), '(d) el agente sigue vivo')
  comprobar(Boolean(hijoPid) && (await esperarMuerto(hijoPid)), '(d) el hijo del agente sigue vivo')

  // (e) comando inexistente: no arranca y lo deja escrito.
  preparar('e', ['mst-comando-que-no-existe-12345'])
  const e = await correr('e')
  comprobar(e.fin?.code === null && typeof e.fin?.error === 'string', `(e) fin.json: ${JSON.stringify(e.fin)}`)
  comprobar(e.codigo === 1, `(e) el lanzador salió con ${e.codigo}`)

  // (h) un atajo .cmd que usa %~dp0 (como el de pnpm) se lanza por nombre: con el nombre entrecomillado cmd no lo resolvía.
  if (process.platform === 'win32') {
    // El atajo vive en otra carpeta que el cwd y se encuentra por PATH, como el de pnpm.
    fs.mkdirSync(path.join(CARPETA, 'bin-h'), { recursive: true })
    fs.writeFileSync(path.join(CARPETA, 'bin-h', 'atajo-h.cmd'), '@"%~dp0\\..\\h-sale.cmd" %*\r\n')
    fs.writeFileSync(path.join(CARPETA, 'h-sale.cmd'), '@echo hola-h\r\n')
    preparar('h', ['atajo-h'])
    const h = await new Promise(resolve => {
      const p = spawn(process.execPath, [LANZADOR, CARPETA, 'h'], { cwd: CARPETA, stdio: 'ignore', windowsHide: true, env: { ...process.env, PATH: path.join(CARPETA, 'bin-h') + ';' + process.env.PATH } })
      p.on('close', () => resolve(leerJson(ruta('h', '.fin.json'))))
    })
    comprobar(h?.code === 0 && texto('h', 'stdout').includes('hola-h'), `(h) atajo .cmd: ${JSON.stringify(h)} ${texto('h', 'stderr')}`)
  }

  // (f) el padre muere de golpe y el lanzador termina igual.
  const agenteF = agenteFalso('agente-f.mjs', [
    'let i = 0',
    'const tic = setInterval(() => {',
    "  process.stdout.write('linea ' + i + '\\n')",
    '  i++',
    '  if (i === 10) clearInterval(tic)',
    '}, 300)',
    '',
  ].join('\n'))
  preparar('f', [process.execPath, agenteF])
  // El padre lanza al lanzador como lo hace el plugin (sin desacoplar y con --desacoplado) y muere de golpe.
  const padreF = agenteFalso('padre-f.mjs', [
    "import { spawn } from 'node:child_process'",
    `spawn(process.execPath, ${JSON.stringify([LANZADOR, CARPETA, 'f', '--desacoplado'])}, { stdio: 'ignore' })`,
    'setInterval(() => {}, 1000)',
    '',
  ].join('\n'))
  const padre = spawn(process.execPath, [padreF], { cwd: CARPETA, stdio: 'ignore', windowsHide: true })
  padre.on('error', () => {})
  const tPadre = Date.now()
  while (Date.now() - tPadre < 5000 && !fs.existsSync(ruta('f', '.pid.json'))) await dormir(25)
  try { process.kill(padre.pid, 'SIGKILL') } catch {}
  const f = await esperarFin('f', 15000)
  const lineas = texto('f', 'stdout').match(/linea \d+/g) ?? []
  comprobar(f?.code === 0, `(f) fin.json: ${JSON.stringify(f)}`)
  comprobar(lineas.length === 10, `(f) log incompleto: ${lineas.length} líneas`)
}

try {
  await main()
} finally {
  try { fs.rmSync(CARPETA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}
}

if (fallos.length) {
  for (const fallo of fallos) console.error('FALLO ' + fallo)
  process.exit(1)
}
console.log('ok: lanzador')
