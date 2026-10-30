// Prueba del catálogo en el servidor MCP del jefe: herramienta modelos, capacidades al delegar y propuestas de la web.
// Sin red, sin gastar modelos y con un opencode falso en el PATH; todo cae en carpetas temporales.
// Uso: node mcp/prueba-mcp-catalogo.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { huellaDeModelos } from '../hooks/catalogo.ts'
import { llamarHastaTerminar } from './ayuda-prueba.mjs'

const servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-mcp-catalogo-'))
const raiz = path.join(temporal, 'proyecto')
fs.mkdirSync(raiz)
const marca = path.join(temporal, 'lanzamientos.txt')
const esperar = ms => new Promise(r => setTimeout(r, ms))
const lanzamientos = () => (fs.existsSync(marca) ? fs.readFileSync(marca, 'utf8').length : 0)

// Trabajador falso: el centro cree que es opencode y lee su salida como la de él.
const falso = path.join(temporal, 'bin')
fs.mkdirSync(falso)
const guion = path.join(falso, 'opencode-falso.mjs')
fs.writeFileSync(guion, `import fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(marca)}, 'x')\nconsole.log(JSON.stringify({ type: 'text', part: { text: 'hecho' } }))\n`)
if (process.platform === 'win32') fs.writeFileSync(path.join(falso, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${guion}" %*\r\n`)
else {
  const ruta = path.join(falso, 'opencode')
  fs.writeFileSync(ruta, `#!/usr/bin/env node\nimport fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(marca)}, 'x')\nconsole.log(JSON.stringify({ type: 'text', part: { text: 'hecho' } }))\n`)
  fs.chmodSync(ruta, 0o755)
}
// PATH mínimo: el falso primero y solo lo imprescindible para que arranque cmd (Windows) o env (Linux/macOS).
const systemPath = process.platform === 'win32'
  ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), process.env.SystemRoot ?? 'C:\\Windows', path.dirname(process.execPath)]
  : [path.dirname(process.execPath), '/usr/bin', '/bin']
const PATH = [falso, ...systemPath].filter(Boolean).join(path.delimiter)

// Solo los dos modelos falsos de opencode: así ningún otro agente puede colarse en la prueba.
const reparto = { ollama: [], opencode: ['opencode/ve', 'opencode/ci'], hermes: [], aider: [], codex: [], claude: [] }
const MODELOS_ENV = JSON.stringify(reparto)

// Catálogo de mentira, con la huella y la fecha frescas: no debe caducar aunque se mirara.
function catalogo({ imagenEnVe = true } = {}) {
  const ahora = Date.now()
  const fecha = new Date(ahora).toISOString().slice(0, 10)
  return {
    version: 2,
    generado: new Date(ahora).toISOString(),
    huella: huellaDeModelos(reparto),
    modelos: [
      { agente: 'opencode', modelo: 'opencode/ve', capacidades: { imagen: imagenEnVe, herramientas: true }, origen: 'models.dev', verificado: fecha },
      { agente: 'opencode', modelo: 'opencode/ci', capacidades: { imagen: false, herramientas: true }, origen: 'models.dev', verificado: fecha },
    ],
    fuentes: [{ nombre: 'prueba', ok: true, fecha }],
  }
}
function nuevaCasa(valor) {
  const casa = fs.mkdtempSync(path.join(temporal, 'casa-'))
  fs.mkdirSync(path.join(casa, '.centro-agentes'), { recursive: true })
  if (valor) fs.writeFileSync(path.join(casa, '.centro-agentes', 'catalogo.json'), JSON.stringify(valor))
  return casa
}

function cliente({ casa, chats, trabajador = '0' }) {
  const p = spawn(process.execPath, [servidor], {
    env: {
      ...process.env,
      PATH,
      HOME: casa,
      USERPROFILE: casa,
      CENTRO_TRABAJADOR: trabajador,
      CENTRO_SIN_NAVEGADOR: '1',
      CENTRO_SIN_WEB: '1',
      CENTRO_SIN_CATALOGO: '1',
      CENTRO_CHATS: chats,
      CENTRO_MODELOS: MODELOS_ENV,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let resto = '', id = 0
  const pendientes = new Map()
  p.stdout.on('data', d => {
    resto += d
    let i
    while ((i = resto.indexOf('\n')) >= 0) {
      const m = JSON.parse(resto.slice(0, i))
      resto = resto.slice(i + 1)
      pendientes.get(m.id)?.(m)
    }
  })
  const pedir = (method, params) => new Promise(r => { const n = ++id; pendientes.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  const llamar = async (nombre, argumentos = {}) => JSON.parse((await pedir('tools/call', { name: nombre, arguments: argumentos })).result.content[0].text)
  return {
    pedir,
    llamar,
    iniciar: () => pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba-catalogo', version: '1' } }),
    cerrar: () => p.stdin.end(),
  }
}

const jefe = cliente({ casa: nuevaCasa(catalogo()), chats: path.join(temporal, 'chats-jefe') })
await jefe.iniciar()

const todos = await jefe.llamar('modelos')
assert.equal(todos.total, 2)
assert.ok(todos.generado)
const conImagen = await jefe.llamar('modelos', { necesita: ['imagen'] })
assert.equal(conImagen.total, 1)
assert.equal(conImagen.modelos[0].modelo, 'opencode/ve')
assert.equal(conImagen.modelos[0].imagen, 'si')
console.log('✓ modelos lista el catálogo y filtra por necesita')

const detectado = await llamarHastaTerminar((n, a) => jefe.llamar(n, a), 'delegar', { cwd: raiz, categoria: 'texto', tarea: 'transcribe estas capturas de pantalla' })
assert.equal(detectado.exito, true)
assert.equal(detectado.trabajador, 'opencode:opencode/ve')
assert.deepEqual(detectado.necesita, ['imagen'])
assert.equal(detectado.detectada, true)
assert.equal(lanzamientos(), 1)
console.log('✓ delegar usa un modelo con imagen y devuelve detectada')

const forzado = await llamarHastaTerminar((n, a) => jefe.llamar(n, a), 'delegar', { cwd: raiz, categoria: 'texto', tarea: 'transcribe estas capturas de pantalla', modelo: 'opencode/ci' })
assert.equal(forzado.exito, true)
assert.equal(forzado.trabajador, 'opencode:opencode/ci')
assert.match(forzado.aviso_capacidad, /no la tiene/)
assert.equal(lanzamientos(), 2)
console.log('✓ un modelo explícito sin imagen se usa con aviso_capacidad')

// Las acciones de la web se leen cada 1,5 s: se espera al menos una vuelta antes de escribir la propuesta.
const chatsJefe = path.join(temporal, 'chats-jefe')
await esperar(1800)
const acciones = path.join(chatsJefe, fs.readdirSync(chatsJefe)[0], 'acciones.jsonl')
const exacto = '[Centro de agentes MST] El usuario propone probar el modelo opencode/ci (agente opencode) en la próxima tarea que le encaje. Compruébalo con la herramienta modelos, úsalo con delegar (campo modelo) cuando corresponda y puntúalo al auditar para que el cerebro aprenda.'
fs.appendFileSync(acciones, JSON.stringify({ tipo: 'proponer', agente: 'opencode', modelo: 'opencode/ci' }) + '\n')
fs.appendFileSync(acciones, JSON.stringify({ tipo: 'proponer', agente: 'opencode', modelo: 'modelo inválido' }) + '\n')
fs.appendFileSync(acciones, JSON.stringify({ tipo: 'proponer', agente: 'opencode', modelo: 'opencode/no-existe' }) + '\n')
await esperar(1800)
assert.deepEqual((await jefe.llamar('modelos')).avisos_web, [exacto])
console.log('✓ la propuesta de modelo desde la web llega como aviso')
jefe.cerrar()

const sinImagen = cliente({ casa: nuevaCasa(catalogo({ imagenEnVe: false })), chats: path.join(temporal, 'chats-sin-imagen') })
await sinImagen.iniciar()
const antes = lanzamientos()
const imposible = await llamarHastaTerminar((n, a) => sinImagen.llamar(n, a), 'delegar', { cwd: raiz, categoria: 'texto', tarea: 'transcribe estas capturas de pantalla' })
assert.match(imposible.error, /Ningún modelo conocido tiene la capacidad imagen/)
assert.deepEqual(imposible.necesita, ['imagen'])
assert.equal(imposible.detectada, true)
assert.equal(lanzamientos(), antes)
sinImagen.cerrar()
console.log('✓ sin modelo con imagen no se ejecuta ningún agente')

const sinCatalogo = cliente({ casa: nuevaCasa(), chats: path.join(temporal, 'chats-sin-catalogo') })
await sinCatalogo.iniciar()
const aviso = await sinCatalogo.llamar('modelos')
assert.equal(aviso.existe, false)
assert.equal(aviso.aviso, 'Aún no hay catálogo: se genera al iniciar la sesión (puede tardar unos segundos).')
sinCatalogo.cerrar()
console.log('✓ sin catálogo, modelos da el aviso')

const trabajador = cliente({ casa: nuevaCasa(catalogo()), chats: path.join(temporal, 'chats-trabajador'), trabajador: '1' })
await trabajador.iniciar()
assert.deepEqual((await trabajador.pedir('tools/list')).result.tools.map(t => t.name), ['preguntar', 'pedir_permiso'])
trabajador.cerrar()
console.log('✓ un trabajador no ve la herramienta modelos')

await esperar(300)
fs.rmSync(temporal, { recursive: true, force: true })
console.log('ok: servidor MCP con catálogo')
