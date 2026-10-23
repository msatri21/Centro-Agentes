import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { transaccion, asegurarGitignore, ARCHIVO, resumenDe } from './tareas.mjs'

const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mst-tareas-'))
let hechas = 0
const prueba = async (nombre, fn) => { await fn(); hechas++; console.log('✓', nombre) }
const crear = titulo => ({ tipo: 'crear_tarea', titulo, subtareas: [{ titulo: 'hacer' }] })
const aplicarHijo = (raiz, op) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['mcp/tareas.mjs', 'aplicar', raiz, '--proyecto', 'prueba', '--hoy', '2026-01-02'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  p.stdout.setEncoding('utf8').on('data', x => out += x)
  p.stderr.setEncoding('utf8').on('data', x => err += x)
  p.on('error', reject)
  p.on('close', code => { try { if (code !== 0) throw new Error(`salida ${code}: ${err}${out}`); resolve(JSON.parse(out)) } catch (e) { reject(e) } })
  p.stdin.end(JSON.stringify(op))
})

await prueba('crea archivo inicial y marca creado', async () => {
  const r = temporal(), x = await transaccion(r, 'p', crear('uno'), { hoy: '2026-01-02' })
  assert.equal(x.ok, true); assert.equal(x.creado, true); assert.equal(JSON.parse(fs.readFileSync(path.join(r, ARCHIVO))).siguiente_tarea, 2)
  assert.equal(fs.existsSync(path.join(r, `${ARCHIVO}.lock`)), false)
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('operación fallida no crea archivo', async () => {
  const r = temporal(), x = await transaccion(r, 'p', { tipo: 'estado', id: 'T9', estado: 'realizado' })
  assert.equal(x.ok, false); assert.equal(fs.existsSync(path.join(r, ARCHIVO)), false); fs.rmSync(r, { recursive: true, force: true })
})
await prueba('avisa de campos que se normalizan', async () => {
  const r = temporal(); fs.writeFileSync(path.join(r, ARCHIVO), JSON.stringify({ proyecto: 'p', tareas: [] }))
  const x = await transaccion(r, 'p', crear('uno')); assert.ok(x.avisos.some(a => a.includes('siguiente_tarea')))
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('recupera JSON roto desde .bak y rechaza corrupción sin copia', async () => {
  const r = temporal(), f = path.join(r, ARCHIVO)
  fs.writeFileSync(f, '{ roto'); fs.writeFileSync(`${f}.bak`, JSON.stringify({ proyecto: 'p', tareas: [], siguiente_tarea: 1 }))
  const x = await transaccion(r, 'p', crear('uno')); assert.ok(x.avisos.includes('restaurado desde la copia .bak'))
  const s = temporal(); fs.writeFileSync(path.join(s, ARCHIVO), '{ roto')
  const y = await transaccion(s, 'p', crear('uno')); assert.equal(y.codigo, 'corrupto'); assert.equal(fs.readFileSync(path.join(s, ARCHIVO), 'utf8'), '{ roto')
  fs.rmSync(r, { recursive: true, force: true }); fs.rmSync(s, { recursive: true, force: true })
})
await prueba('recupera cerrojo caducado y espera ante uno reciente', async () => {
  const r = temporal(), lock = path.join(r, `${ARCHIVO}.lock`)
  fs.writeFileSync(lock, JSON.stringify({ en: Date.now() - 31000, token: 'muerto' }))
  assert.equal((await transaccion(r, 'p', crear('uno'), { caducaMs: 30000 })).ok, true)
  fs.writeFileSync(lock, JSON.stringify({ en: Date.now(), token: 'vivo' }))
  const x = await transaccion(r, 'p', crear('dos'), { esperaMs: 70, caducaMs: 30000 })
  assert.equal(x.codigo, 'ocupado'); fs.rmSync(lock, { force: true }); fs.rmSync(r, { recursive: true, force: true })
})
await prueba('cerrojo caducado que no se puede borrar espera hasta devolver ocupado', async () => {
  const r = temporal(), lock = path.join(r, `${ARCHIVO}.lock`), hace = new Date(Date.now() - 120000)
  fs.mkdirSync(lock); fs.utimesSync(lock, hace, hace)
  const inicio = Date.now(), x = await transaccion(r, 'p', crear('uno'), { esperaMs: 1000 })
  assert.equal(x.codigo, 'ocupado'); assert.ok(Date.now() - inicio >= 950); assert.ok(Date.now() - inicio < 2500)
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('resumen informa JSON roto sin lanzar excepción', async () => {
  const r = temporal(); fs.writeFileSync(path.join(r, ARCHIVO), '{ roto')
  const x = resumenDe(r, 'p'); assert.equal(x.existe, true); assert.equal(x.corrupto, true)
  const proceso = spawnSync(process.execPath, ['mcp/tareas.mjs', 'resumen', r], { encoding: 'utf8' })
  assert.equal(proceso.status, 0); assert.equal(JSON.parse(proceso.stdout).corrupto, true)
  fs.writeFileSync(`${path.join(r, ARCHIVO)}.bak`, JSON.stringify({ proyecto: 'p', tareas: [], siguiente_tarea: 1 }))
  assert.ok(resumenDe(r, 'p').avisos.some(a => a.includes('próxima operación')))
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('aviso de reconstrucción está bien codificado', () => {
  const fuente = fs.readFileSync(new URL('./tareas.mjs', import.meta.url), 'utf8')
  assert.ok(!fuente.includes('reconstruy?'))
  assert.ok(fuente.includes('Falta siguiente_tarea; se reconstruyó desde los ids'))
})
await prueba('archiva tareas excedentes sin duplicar bloques', async () => {
  const r = temporal(); await transaccion(r, 'p', crear('base'), { hoy: '2026-01-01' })
  for (let i = 1; i <= 6; i++) await transaccion(r, 'p', { tipo: 'estado', id: 'T1.1', estado: 'solucionado' }, { hoy: `2026-01-0${i}` }).catch(() => {})
  // Se crean seis tareas solucionadas para ejercitar el límite sin cambiar reglas puras.
  const f = path.join(r, ARCHIVO), a = JSON.parse(fs.readFileSync(f)); a.tareas = []
  for (let i = 1; i <= 6; i++) a.tareas.push({ id: `T${i}`, titulo: `t${i}`, estado: 'solucionado', depende_de: [], enlaces: [], creada: '2026-01-01', solucionada: `2026-01-0${i}`, cerrada: null, subtareas: [] })
  a.siguiente_tarea = 7; fs.writeFileSync(f, JSON.stringify(a))
  const x = await transaccion(r, 'p', crear('nueva'), { hoy: '2026-01-10' }), md = fs.readFileSync(path.join(r, 'mst-tareas-cerradas.md'), 'utf8')
  assert.equal(x.ok, true); assert.ok(!JSON.parse(fs.readFileSync(f)).tareas.some(t => t.id === 'T1')); assert.ok(md.includes('## T1 · t1'))
  assert.equal((await transaccion(r, 'p', crear('nueva'))).ok, true); assert.equal(fs.readFileSync(path.join(r, 'mst-tareas-cerradas.md'), 'utf8').match(/## T1 ·/g).length, 1)
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('gitignore respeta repositorio, archivo previo y versionado', () => {
  const a = temporal(); assert.equal(asegurarGitignore(a).accion, 'sin_git')
  const r = path.join(a, 'repo'); fs.mkdirSync(r); spawnSync('git', ['init', r], { stdio: 'ignore' })
  assert.equal(asegurarGitignore(r).accion, 'creado'); assert.equal(asegurarGitignore(r).accion, 'ya_estaba')
  const c = path.join(a, 'con-previo'); fs.mkdirSync(c); spawnSync('git', ['init', c], { stdio: 'ignore' }); fs.writeFileSync(path.join(c, '.gitignore'), 'node_modules\n')
  assert.equal(asegurarGitignore(c).accion, 'anadido'); assert.equal(asegurarGitignore(c).accion, 'ya_estaba')
  fs.writeFileSync(path.join(r, ARCHIVO), '{}'); spawnSync('git', ['add', '-f', ARCHIVO], { cwd: r, stdio: 'ignore' })
  const v = asegurarGitignore(r); assert.equal(v.versionado, true); assert.ok(v.aviso.includes('git rm --cached'))
  fs.rmSync(a, { recursive: true, force: true })
})
await prueba('concurrencia real conserva las ocho tareas e ids', async () => {
  const r = temporal(); const resultados = await Promise.all(Array.from({ length: 8 }, (_, i) => aplicarHijo(r, crear(`tarea-${i}`))))
  assert.ok(resultados.every(x => x.ok)); const a = JSON.parse(fs.readFileSync(path.join(r, ARCHIVO)))
  assert.equal(a.tareas.length, 8); assert.equal(a.siguiente_tarea, 9); assert.deepEqual(a.tareas.map(t => t.id).sort(), Array.from({ length: 8 }, (_, i) => `T${i + 1}`))
  assert.equal(fs.readdirSync(r).some(n => n.startsWith(`${ARCHIVO}.tmp`)), false); assert.equal(fs.existsSync(path.join(r, `${ARCHIVO}.lock`)), false)
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('concurrencia real aplica solo una transición condicional', async () => {
  const r = temporal(); await transaccion(r, 'p', crear('uno'))
  const xs = await Promise.all(Array.from({ length: 6 }, () => aplicarHijo(r, { tipo: 'estado', id: 'T1.1', estado: 'en_proceso', solo_si: 'pendiente' })))
  assert.equal(xs.filter(x => x.ok).length, 1); assert.equal(xs.filter(x => x.codigo === 'conflicto').length, 5)
  assert.equal(fs.readdirSync(r).some(n => n.startsWith(`${ARCHIVO}.tmp`)), false); assert.equal(fs.existsSync(path.join(r, `${ARCHIVO}.lock`)), false)
  fs.rmSync(r, { recursive: true, force: true })
})
await prueba('25 rondas con seis procesos recuperan cerrojo caduco sin perder tareas', async () => {
  for (let ronda = 0; ronda < 25; ronda++) {
    const r = temporal(), lock = path.join(r, `${ARCHIVO}.lock`)
    fs.writeFileSync(lock, JSON.stringify({ pid: -1, en: Date.now() - 120000, token: `muerto-${ronda}` }))
    const resultados = await Promise.all(Array.from({ length: 6 }, (_, i) => aplicarHijo(r, crear(`r${ronda}-tarea-${i}`))))
    assert.ok(resultados.every(x => x.ok), `ronda ${ronda}: ${JSON.stringify(resultados)}`)
    const a = JSON.parse(fs.readFileSync(path.join(r, ARCHIVO)))
    assert.equal(a.tareas.length, 6, `ronda ${ronda}`)
    assert.equal(new Set(a.tareas.map(t => t.id)).size, 6, `ids ronda ${ronda}`)
    assert.equal(fs.readdirSync(r).some(n => n.includes('.tmp.')), false, `temporales ronda ${ronda}`)
    assert.equal(fs.existsSync(lock), false, `cerrojo ronda ${ronda}`)
    fs.rmSync(r, { recursive: true, force: true })
  }
})
console.log(`\n${hechas} pruebas de tareas pasan.`)

