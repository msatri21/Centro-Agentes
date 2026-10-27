// Prueba del error real de OpenCode (cupo gratis agotado): el parser lo lee, el mensaje real llega al jefe
// en vez de '[error] desconocido' y el modelo se aparta (la segunda delegación no lo lanza otra vez).
// Uso: node mcp/prueba-opencode-errores.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-errores-'))
const bin = path.join(temporal, 'bin')
fs.mkdirSync(bin)
const lanzamientos = path.join(temporal, 'lanzamientos.jsonl')
const falso = path.join(bin, 'opencode-falso.mjs')
fs.writeFileSync(falso, `import fs from 'node:fs'
const log=${JSON.stringify(lanzamientos)}
fs.appendFileSync(log, process.argv[process.argv.indexOf('-m')+1]+'\\n')
console.log(JSON.stringify({type:'error',sessionID:'ses_falsa',error:{type:'provider.free-limit',message:'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',status:429,retryAfterMs:33725000}}))
`)
if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${falso}" %*\r\n`)
else { const exe = path.join(bin, 'opencode'); fs.writeFileSync(exe, `#!/usr/bin/env node\nawait import(${JSON.stringify(falso)})\n`); fs.chmodSync(exe, 0o755) }
const base = process.platform === 'win32' ? [process.env.SystemRoot + '\\System32', process.env.SystemRoot, path.dirname(process.execPath)] : [path.dirname(process.execPath), '/usr/bin', '/bin']
const servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
const p = spawn(process.execPath, [servidor], { env: { ...process.env, PATH: [bin, ...base].join(path.delimiter), HOME: temporal, USERPROFILE: temporal, CENTRO_TRABAJADOR: '0', CENTRO_CHATS: path.join(temporal, 'chats'), CENTRO_SIN_WEB: '1', CENTRO_SIN_NAVEGADOR: '1', CENTRO_SIN_CATALOGO: '1', CENTRO_MODELOS: JSON.stringify({ opencode: ['opencode/cupo', 'opencode/minimax'], ollama: [], hermes: [], aider: [], codex: [], claude: [] }) }, stdio: ['pipe', 'pipe', 'inherit'] })
let resto = '', seq = 0
const pendientes = new Map()
p.stdout.on('data', trozo => { resto += trozo; let i; while ((i = resto.indexOf('\n')) >= 0) { const m = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1); pendientes.get(m.id)?.(m) } })
const pedir = (method, params) => new Promise(resolve => { const id = ++seq; pendientes.set(id, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
const llamar = async (name, args = {}) => JSON.parse((await pedir('tools/call', { name, arguments: args })).result.content[0].text)
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  await pedir('initialize', { protocolVersion: '2025-06-18' })

  const r = await llamar('delegar', { categoria: 'prueba', tarea: 'con cupo agotado', trabajador: 'opencode' })
  assert.equal(r.estado, 'lanzado', JSON.stringify(r))
  let estado
  do { estado = await llamar('estado', { grupo: r.grupo, esperar_seg: 10 }) } while (estado.terminados + estado.fallidos < 1)
  const e = estado.encargos[0]
  assert.equal(estado.fallidos, 1, JSON.stringify(estado))
  assert.match(e.resultado.salida, /Free usage limit reached/, 'el mensaje real del proveedor')
  assert.doesNotMatch(e.resultado.salida, /desconocido/)
  // Los dos modelos se probaron y quedaron apartados sin gastar cambios de modelo.
  assert.equal(fs.readFileSync(lanzamientos, 'utf8').split(/\r?\n/).filter(Boolean).length, 2)
  assert.equal(e.resultado.cambios, undefined, JSON.stringify(e.resultado.cambios))

  // El apartado dura retryAfterMs: la segunda delegación no lanza el opencode falso otra vez.
  const segunda = await llamar('delegar', { categoria: 'prueba', tarea: 'otra vez', trabajador: 'opencode' })
  assert.equal(segunda.estado, 'lanzado', JSON.stringify(segunda))
  do { estado = await llamar('estado', { grupo: segunda.grupo, esperar_seg: 10 }) } while (estado.terminados + estado.fallidos < 1)
  assert.match(estado.encargos[0].resultado.error, /Todos los modelos posibles fallaron/)
  assert.equal(fs.readFileSync(lanzamientos, 'utf8').split(/\r?\n/).filter(Boolean).length, 2, 'no se lanzó ningún modelo caído')

  p.kill(); console.log('ok: errores de OpenCode (cupo gratis) muestran el mensaje real y apartan el modelo')
} finally {
  try { p.kill() } catch {}
  await esperar(100)
  fs.rmSync(temporal, { recursive: true, force: true })
}
