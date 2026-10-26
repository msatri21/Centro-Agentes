import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-async-'))
const bin = path.join(temporal, 'bin'), estadoDir = path.join(temporal, 'procesos')
fs.mkdirSync(bin); fs.mkdirSync(estadoDir)
const lanzamientos = path.join(temporal, 'lanzamientos.jsonl')
const falso = path.join(bin, 'opencode-falso.mjs')
fs.writeFileSync(falso, `import fs from 'node:fs'
import path from 'node:path'
const d=${JSON.stringify(estadoDir)}, log=${JSON.stringify(lanzamientos)}
const args=process.argv.slice(2), modelo=args[args.indexOf('-m')+1]
fs.appendFileSync(log, modelo+'\\n')
const id=process.pid+'.'+Date.now(), activo=path.join(d,id)
fs.writeFileSync(activo,'')
const vivos=fs.readdirSync(d).length
fs.appendFileSync(log, 'vivos:'+vivos+'\\n')
await new Promise(r=>setTimeout(r, Number(process.env.FALSO_MS||700)))
fs.rmSync(activo,{force:true})
if(modelo==='opencode/reintenta' && !fs.existsSync(${JSON.stringify(path.join(temporal, 'ya-reintento'))})) {
 fs.writeFileSync(${JSON.stringify(path.join(temporal, 'ya-reintento'))},'')
 console.log(JSON.stringify({type:'text',part:{text:'Standalone server exited before reporting readiness'}})); process.exit(1)
}
console.log(JSON.stringify({type:'text',part:{text:'resultado falso'}}))
`)
if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${falso}" %*\r\n`)
else { const exe = path.join(bin, 'opencode'); fs.writeFileSync(exe, `#!/usr/bin/env node\nawait import(${JSON.stringify(falso)})\n`); fs.chmodSync(exe, 0o755) }
const base = process.platform === 'win32' ? [process.env.SystemRoot + '\\System32', process.env.SystemRoot, path.dirname(process.execPath)] : [path.dirname(process.execPath), '/usr/bin', '/bin']
const servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
const p = spawn(process.execPath, [servidor], { env: { ...process.env, PATH: [bin, ...base].join(path.delimiter), HOME: temporal, USERPROFILE: temporal, CENTRO_TRABAJADOR: '0', CENTRO_CHATS: path.join(temporal, 'chats'), CENTRO_SIN_WEB: '1', CENTRO_SIN_NAVEGADOR: '1', CENTRO_SIN_CATALOGO: '1', CENTRO_MODELOS: JSON.stringify({ opencode: ['opencode/lento', 'opencode/reintenta'] }), FALSO_MS: '700' }, stdio: ['pipe', 'pipe', 'inherit'] })
let resto = '', seq = 0
const pendientes = new Map()
p.stdout.on('data', trozo => { resto += trozo; let i; while ((i = resto.indexOf('\n')) >= 0) { const m = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1); pendientes.get(m.id)?.(m) } })
const pedir = (method, params) => new Promise(resolve => { const id = ++seq; pendientes.set(id, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
const llamar = async (name, args = {}) => JSON.parse((await pedir('tools/call', { name, arguments: args })).result.content[0].text)
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  await pedir('initialize', { protocolVersion: '2025-06-18' })
  const inicio = Date.now(), r = await llamar('delegar', { categoria: 'prueba', tarea: 'lenta', trabajador: 'opencode', modelo: 'opencode/lento' })
  assert.equal(r.estado, 'lanzado', JSON.stringify(r)); assert.ok(Date.now() - inicio < 600)
  assert.match((await llamar('registrar_auditoria', { id: r.encargo, puntaje: 8 })).error, /todavía no terminó/)
  const corriendo = await llamar('estado', { ids: [r.encargo] })
  assert.equal(corriendo.corriendo, 1)
  const esperaInicio = Date.now()
  const consultado = await llamar('estado', { ids: [r.encargo], esperar_seg: 10 })
  assert.ok(Date.now() - esperaInicio < 3000, 'esperar_seg terminó al completar el encargo')
  assert.equal(consultado.terminados, 1)
  assert.equal((await llamar('registrar_auditoria', { id: r.encargo, puntaje: 8 })).guardado, true)
  const conAviso = consultado
  assert.equal(conAviso.avisos_web.length, 1)
  assert.match(conAviso.avisos_web[0], /Terminó el grupo/)
  assert.equal((await llamar('ranking')).avisos_web, undefined)

  const antes = Date.now()
  const lote = await llamar('delegar_varios', { tareas: Array.from({ length: 6 }, (_, i) => ({ categoria: 'prueba', tarea: `paralela ${i}`, trabajador: 'opencode', modelo: 'opencode/lento' })) })
  assert.equal(lote.encargos.length, 6)
  let esperarLote
  do { esperarLote = await llamar('estado', { grupo: lote.grupo, esperar_seg: 10 }) } while (esperarLote.terminados + esperarLote.fallidos < 6)
  assert.ok(Date.now() - antes < 10000)
  assert.equal(esperarLote.terminados, 6, JSON.stringify(esperarLote))
  const max = Math.max(...fs.readFileSync(lanzamientos, 'utf8').split(/\r?\n/).filter(x => x.startsWith('vivos:')).map(x => Number(x.slice(6))))
  assert.ok(max <= 4, `máximo observado: ${max}`)

  const reintento = await llamar('delegar', { categoria: 'prueba', tarea: 'reintentar arranque', trabajador: 'opencode', modelo: 'opencode/reintenta' })
  const hecho = await llamar('estado', { ids: [reintento.encargo], esperar_seg: 10 })
  assert.equal(hecho.terminados, 1)
  assert.equal(hecho.encargos[0].resultado.reintentos.length, 1)
  assert.equal(fs.readFileSync(lanzamientos, 'utf8').split(/\r?\n/).filter(x => x === 'opencode/reintenta').length, 2)

  const proyecto = path.join(temporal, 'proyecto')
  fs.mkdirSync(proyecto)
  await llamar('planificar', { cwd: proyecto, objetivo: 'dependencias', subtareas: ['base', 'final'], dependencias: { 2: [1] } })
  const dependientes = await llamar('delegar_varios', { tareas: [1, 2].map(subtarea => ({ cwd: proyecto, subtarea, categoria: 'prueba', tarea: `dependencia ${subtarea}`, trabajador: 'opencode', modelo: 'opencode/lento' })) })
  assert.equal(dependientes.encargos[1].estado, 'en_espera')
  let estadoDeps
  do { estadoDeps = await llamar('estado', { grupo: dependientes.grupo, esperar_seg: 10 }) } while (estadoDeps.terminados + estadoDeps.fallidos < 2)
  assert.equal(estadoDeps.terminados, 2, JSON.stringify(estadoDeps))
  assert.deepEqual(estadoDeps.encargos[1].resultado.tras, [1])

  const error = await llamar('delegar', { categoria: 'prueba', tarea: 'no válido', trabajador: 'desconocido' })
  assert.match(error.error, /Trabajador desconocido/)
  assert.equal((await llamar('ranking')).avisos_web, undefined)

  p.kill(); console.log('ok: delegación MCP asíncrona')
} finally {
  try { p.kill() } catch {}
  await esperar(100)
  fs.rmSync(temporal, { recursive: true, force: true })
}
