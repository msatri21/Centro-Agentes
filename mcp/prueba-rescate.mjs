// Prueba del rescate: si OpenCode escribe una respuesta completa y luego termina con error de cupo,
// esa respuesta es el resultado (no se pasa al respaldo) y la auditoría queda a nombre de OpenCode.
// Además, una salida de Ollama que solo dice "You need to be signed in…" no cuenta como éxito.
// Uso: node mcp/prueba-rescate.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-rescate-'))
const bin = path.join(temporal, 'bin')
fs.mkdirSync(bin)
const lanzamientos = path.join(temporal, 'lanzamientos.jsonl')
const INFORME = 'Informe completo: ' + 'el análisis cubre todos los puntos pedidos con detalle. '.repeat(8)
const falsos = {
  // opencode/llena responde entero y luego se queda sin cupo; opencode/corta solo alcanza a saludar.
  opencode: `const m=process.argv[process.argv.indexOf('-m')+1]
fs.appendFileSync(log,'opencode '+m+'\\n')
console.log(JSON.stringify({type:'text',part:{text:m==='opencode/llena'?${JSON.stringify(INFORME)}:'Hola'}}))
console.log(JSON.stringify({type:'error',error:{type:'provider.free-limit',message:'Free usage limit reached.',retryAfterMs:3600000}}))
process.exitCode=1`,
  ollama: `fs.appendFileSync(log,'ollama\\n')
console.log('You need to be signed in to Ollama to run Cloud models.')`,
}
for (const [nombre, cuerpo] of Object.entries(falsos)) {
  const js = path.join(bin, `${nombre}-falso.mjs`)
  fs.writeFileSync(js, `import fs from 'node:fs'\nconst log=${JSON.stringify(lanzamientos)}\n${cuerpo}\n`)
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, `${nombre}.cmd`), `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`)
  else { const exe = path.join(bin, nombre); fs.writeFileSync(exe, `#!/usr/bin/env node\nawait import(${JSON.stringify(js)})\n`); fs.chmodSync(exe, 0o755) }
}
const base = process.platform === 'win32' ? [process.env.SystemRoot + '\\System32', process.env.SystemRoot, path.dirname(process.execPath)] : [path.dirname(process.execPath), '/usr/bin', '/bin']
const servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
const arrancar = modelos => spawn(process.execPath, [servidor], { env: { ...process.env, PATH: [bin, ...base].join(path.delimiter), HOME: temporal, USERPROFILE: temporal, CENTRO_TRABAJADOR: '0', CENTRO_CHATS: path.join(temporal, 'chats'), CENTRO_SIN_WEB: '1', CENTRO_SIN_NAVEGADOR: '1', CENTRO_SIN_CATALOGO: '1', CENTRO_MODELOS: JSON.stringify({ opencode: [], ollama: [], hermes: [], aider: [], codex: [], claude: [], ...modelos }) }, stdio: ['pipe', 'pipe', 'inherit'] })
const cliente = p => {
  let resto = '', seq = 0
  const pendientes = new Map()
  p.stdout.on('data', trozo => { resto += trozo; let i; while ((i = resto.indexOf('\n')) >= 0) { const m = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1); pendientes.get(m.id)?.(m) } })
  const pedir = (method, params) => new Promise(resolve => { const id = ++seq; pendientes.set(id, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
  const llamar = async (name, args = {}) => JSON.parse((await pedir('tools/call', { name, arguments: args })).result.content[0].text)
  return { pedir, llamar }
}
const terminar = async (llamar, grupo) => {
  let estado
  do { estado = await llamar('estado', { grupo, esperar_seg: 10 }) } while (estado.terminados + estado.fallidos < 1)
  return estado
}
const lanzados = () => fs.existsSync(lanzamientos) ? fs.readFileSync(lanzamientos, 'utf8').split(/\r?\n/).filter(Boolean) : []
const procesos = []
try {
  // 1) Respuesta completa + error de cupo: se conserva, no se lanza el respaldo y la auditoría es de OpenCode.
  const p1 = arrancar({ opencode: ['opencode/llena'], ollama: ['respaldo:cloud'] }); procesos.push(p1)
  const c1 = cliente(p1)
  await c1.pedir('initialize', { protocolVersion: '2025-06-18' })
  const r1 = await c1.llamar('delegar', { categoria: 'prueba', tarea: 'informe largo' })
  const e1 = (await terminar(c1.llamar, r1.grupo)).encargos[0]
  assert.equal(e1.resultado.exito, true, JSON.stringify(e1))
  assert.equal(e1.resultado.trabajador, 'opencode:opencode/llena')
  assert.ok(e1.resultado.salida.includes(INFORME.trim()), e1.resultado.salida)
  assert.match(e1.resultado.rescate, /Free usage limit reached/)
  assert.deepEqual(lanzados(), ['opencode opencode/llena'], 'no se lanzó el respaldo')
  const a1 = await c1.llamar('registrar_auditoria', { id: e1.id, puntaje: 8 })
  assert.equal(a1.trabajador, 'opencode:opencode/llena', JSON.stringify(a1))
  p1.kill()

  // 2) Sin respuesta útil: se pasa al respaldo, y el aviso de Ollama sin sesión no cuenta como éxito.
  fs.rmSync(lanzamientos, { force: true })
  fs.rmSync(path.join(temporal, '.claude'), { recursive: true, force: true })
  const p2 = arrancar({ opencode: ['opencode/corta'], ollama: ['respaldo:cloud'] }); procesos.push(p2)
  const c2 = cliente(p2)
  await c2.pedir('initialize', { protocolVersion: '2025-06-18' })
  const r2 = await c2.llamar('delegar', { categoria: 'prueba2', tarea: 'otra cosa' })
  const e2 = (await terminar(c2.llamar, r2.grupo)).encargos[0]
  assert.deepEqual(lanzados(), ['opencode opencode/corta', 'ollama'])
  assert.notEqual(e2.resultado.exito, true, JSON.stringify(e2))
  assert.equal(e2.resultado.rescate, undefined)

  console.log('ok: respuesta completa rescatada tras error de cupo; aviso de Ollama sin sesión no es éxito')
} finally {
  for (const p of procesos) try { p.kill() } catch {}
  await new Promise(resolve => setTimeout(resolve, 100))
  fs.rmSync(temporal, { recursive: true, force: true })
}
