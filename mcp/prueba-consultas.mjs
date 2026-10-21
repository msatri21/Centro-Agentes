// Prueba de punta a punta de las consultas de los agentes, sin agentes reales ni navegador:
// un agente (el servidor MCP en modo trabajador) pregunta y pide permiso, y el usuario contesta con la misma
// petición que hace la web (POST /accion tipo "responder") al servidor local de verdad.
// Uso: node mcp/prueba-consultas.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-consultas-'))
const CHATS = path.join(TMP, 'chats')
const CHAT = 'prueba'
const DIR = path.join(CHATS, CHAT)
const CLAVE = 'clave-de-prueba'
const PUERTO = 47431
fs.mkdirSync(DIR, { recursive: true })
fs.writeFileSync(path.join(TMP, 'clave.txt'), CLAVE)

const servidor = spawn(process.execPath, [path.join(AQUI, '..', 'web', 'servidor.js'), String(PUERTO), path.join(TMP, 'clave.txt'), CHATS, 'prueba'], { stdio: 'ignore' })
const dormir = ms => new Promise(r => setTimeout(r, ms))
const url = `http://127.0.0.1:${PUERTO}/accion?t=${CLAVE}&s=${CHAT}`
const contestar = (id, decision, texto) => fetch(url, { method: 'POST', body: JSON.stringify({ tipo: 'responder', id, decision, texto }) })
const consultas = () => (fs.existsSync(path.join(DIR, 'consultas.jsonl')) ? fs.readFileSync(path.join(DIR, 'consultas.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
const esperarConsulta = async n => {
  for (let i = 0; i < 100 && consultas().length < n; i++) await dormir(100)
  assert.ok(consultas().length >= n, `no apareció la consulta ${n}`)
  return consultas()[n - 1]
}

function agente(espera) {
  const p = spawn(process.execPath, [path.join(AQUI, 'centro-mcp.mjs')], { env: { ...process.env, CENTRO_SIN_NAVEGADOR: '1', CENTRO_CHATS: path.join(TMP, 'otros'), CENTRO_TRABAJADOR: '1', CENTRO_CHAT_DIR: DIR, CENTRO_TRABAJO: 'tprueba', ...(espera ? { CENTRO_ESPERA_MS: String(espera) } : {}) }, stdio: ['pipe', 'pipe', 'inherit'] })
  let resto = ''
  let id = 0
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
  const llamar = async (name, args) => (await pedir('tools/call', { name, arguments: args })).result.content[0].text
  return { pedir, llamar, cerrar: () => p.stdin.end() }
}

try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${PUERTO}/version`).then(r => r.ok).catch(() => false)) break
    await dormir(100)
  }
  const a = agente()
  await a.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } })
  assert.deepEqual((await a.pedir('tools/list')).result.tools.map(t => t.name), ['preguntar', 'pedir_permiso'])

  // 1) Un permiso que el usuario concede "siempre": la segunda vez ya no pregunta.
  let r = a.llamar('pedir_permiso', { accion: 'Instalar pm2', detalle: 'npm i -g pm2', categoria: 'instalar' })
  let c = await esperarConsulta(1)
  assert.equal(c.tipo, 'permiso')
  assert.equal(c.trabajo, 'tprueba')
  assert.equal((await contestar(c.id, 'siempre')).status, 200)
  assert.match(await r, /^APROBADO/)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DIR, 'permisos.json'), 'utf8')), ['instalar'])
  assert.equal((await contestar(c.id, 'aprobar')).status, 409, 'una consulta no se contesta dos veces')
  assert.match(await a.llamar('pedir_permiso', { accion: 'Instalar otra cosa', categoria: 'instalar' }), /^APROBADO/)
  assert.equal(consultas().length, 1, 'lo permitido siempre no abre otra consulta')

  // 2) Lo destructivo nunca se permite "siempre"; el usuario lo deniega con un motivo.
  r = a.llamar('pedir_permiso', { accion: 'Borrar build', detalle: 'rm -rf build', categoria: 'destructivo' })
  c = await esperarConsulta(2)
  assert.equal((await contestar(c.id, 'siempre')).status, 400)
  assert.equal((await contestar(c.id, 'denegar', 'ahora no')).status, 200)
  const denegado = await r
  assert.match(denegado, /^DENEGADO/)
  assert.match(denegado, /Motivo del usuario: ahora no/)

  // 3) Una pregunta con opciones, contestada con una de ellas.
  r = a.llamar('preguntar', { pregunta: '¿Regex o librería?', opciones: ['Regex', 'Librería'] })
  c = await esperarConsulta(3)
  assert.deepEqual(c.opciones, ['Regex', 'Librería'])
  assert.equal((await contestar(c.id, 'texto', 'Regex')).status, 200)
  assert.equal(await r, 'RESPUESTA DEL USUARIO: Regex')

  // 4) Cosas que el servidor rechaza.
  assert.equal((await contestar('no-existe', 'aprobar')).status, 404)
  assert.equal((await contestar(c.id, 'texto', '')).status, 400)
  assert.equal((await contestar('../x', 'aprobar')).status, 400)
  a.cerrar()

  // 5) Sin respuesta a tiempo: el agente recibe una negativa segura y la consulta se cierra.
  const b = agente(1200)
  await b.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } })
  assert.match(await b.llamar('pedir_permiso', { accion: 'Escribir fuera', categoria: 'escribir-fuera' }), /^SIN RESPUESTA a tiempo: se da por DENEGADO/)
  assert.match(await b.llamar('preguntar', { pregunta: '¿Algo?' }), /^SIN RESPUESTA a tiempo\./)
  const cerradas = fs.readFileSync(path.join(DIR, 'respuestas.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  assert.equal(cerradas.filter(x => x.vencida).length, 2)
  b.cerrar()
  console.log('ok: consultas de los agentes de punta a punta')
} finally {
  servidor.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}
