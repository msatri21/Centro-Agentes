import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { actualizar, leerCatalogo, rutaCatalogo } from './catalogo.mjs'

const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mst-catalogo-'))
let hechas = 0
const prueba = async (nombre, fn) => { await fn(); hechas++; console.log('✓', nombre) }
const agentes = ['ollama', 'opencode', 'hermes', 'aider', 'codex', 'claude']
const modelos = { ollama: ['gemma4:31b-cloud', 'gpt-oss:120b-cloud'], opencode: ['opencode/big-pickle', 'opencode/desconocido'], hermes: [], aider: ['ollama_chat/gemma4:31b-cloud'], codex: ['chatgpt'], claude: ['sonnet'] }
const respuestas = {
  'gemma4:31b-cloud': `  Model\n    context length 262144\n  Capabilities\n    completion\n    thinking\n      levels: [low medium high]\n      default: medium\n    tools\n    vision\n`,
  'gpt-oss:120b-cloud': `  Model\n    context length 131072\n  Capabilities\n    completion\n    tools\n    thinking\n      levels: [low medium high]\n      default: medium\n`,
}
const dev = JSON.stringify({ opencode: { models: { 'big-pickle': { modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000 }, tool_call: true, reasoning: true } } } })
const fabrica = ({ fallaOllama = false, fallaRed = false } = {}) => {
  const llamadas = { ejecutar: 0, descargar: 0 }
  return { llamadas, ejecutar: async (_c, args) => { llamadas.ejecutar++; return fallaOllama ? { codigo: null, stdout: '', stderr: 'no existe' } : { codigo: 0, stdout: respuestas[args[1]] ?? '', stderr: '' } }, descargar: async () => { llamadas.descargar++; if (fallaRed) throw new Error('sin internet'); return dev } }
}
const completar = (m = modelos) => ({ ...Object.fromEntries(agentes.map(a => [a, []])), ...m })

await prueba('primera ejecución descubre y guarda capacidades', async () => {
  const casa = temporal(), f = fabrica(), r = await actualizar({ casa, modelos: completar(), ahora: Date.UTC(2026, 0, 1), ...f })
  const entrada = (a, m) => r.catalogo.modelos.find(x => x.agente === a && x.modelo === m)
  assert.equal(entrada('ollama', 'gemma4:31b-cloud').contexto, 262144)
  assert.equal(entrada('ollama', 'gemma4:31b-cloud').capacidades.imagen, true)
  assert.equal(entrada('ollama', 'gpt-oss:120b-cloud').contexto, 131072)
  assert.equal(entrada('ollama', 'gpt-oss:120b-cloud').capacidades.imagen, false)
  assert.equal(entrada('aider', 'ollama_chat/gemma4:31b-cloud').capacidades.imagen, true)
  assert.equal(entrada('opencode', 'opencode/big-pickle').contexto, 200000)
  assert.deepEqual(entrada('opencode', 'opencode/desconocido').capacidades, {})
  assert.equal(entrada('claude', 'sonnet').origen, 'plugin'); assert.equal(entrada('codex', 'chatgpt').origen, 'plugin')
  assert.deepEqual(leerCatalogo(casa), r.catalogo); assert.equal(f.llamadas.ejecutar, 2); assert.equal(f.llamadas.descargar, 1)
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('catálogo vigente evita llamadas', async () => {
  const casa = temporal(), ahora = Date.UTC(2026, 0, 1), m = completar()
  await actualizar({ casa, modelos: m, ahora, ...fabrica() })
  const f = fabrica(), r = await actualizar({ casa, modelos: m, ahora: ahora + 1, ...f })
  assert.equal(r.actualizado, false); assert.equal(r.motivo, 'vigente'); assert.deepEqual(f.llamadas, { ejecutar: 0, descargar: 0 })
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('cambio de huella y vencimiento actualizan', async () => {
  const casa = temporal(), ahora = Date.UTC(2026, 0, 1), m = completar()
  await actualizar({ casa, modelos: m, ahora, ...fabrica() })
  assert.equal((await actualizar({ casa, modelos: completar({ claude: ['haiku'] }), ahora: ahora + 1, ...fabrica() })).motivo, 'otros modelos')
  assert.equal((await actualizar({ casa, modelos: completar({ claude: ['haiku'] }), ahora: ahora + 26 * 3600000, ...fabrica() })).motivo, 'caducado')
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('fuente fallida se reintenta pasados 60 minutos', async () => {
  const casa = temporal(), ahora = Date.UTC(2026, 0, 1), m = completar(), f = fabrica({ fallaOllama: true })
  const r = await actualizar({ casa, modelos: m, ahora, ...f })
  assert.equal(r.catalogo.fuentes.find(x => x.nombre === 'ollama').ok, false)
  assert.deepEqual(r.catalogo.modelos.find(x => x.agente === 'ollama').capacidades, {})
  assert.equal((await actualizar({ casa, modelos: m, ahora: ahora + 30 * 60000, ...fabrica() })).actualizado, false)
  assert.equal((await actualizar({ casa, modelos: m, ahora: ahora + 2 * 3600000, ...fabrica({ fallaOllama: true }) })).motivo, 'reintento')
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('un modelo de Ollama que no existe en el equipo no obliga a rehacer el catálogo cada hora', async () => {
  const casa = temporal(), ahora = Date.UTC(2026, 0, 1), m = completar({ ollama: ['gemma4:31b-cloud', 'llama3.2:3b'] })
  const ejecutar = async (_c, args) => args[1] === 'llama3.2:3b' ? { codigo: 1, stdout: '', stderr: "model 'llama3.2:3b' not found" } : { codigo: 0, stdout: respuestas[args[1]], stderr: '' }
  const r = await actualizar({ casa, modelos: m, ahora, ejecutar, descargar: async () => dev })
  const fuente = r.catalogo.fuentes.find(x => x.nombre === 'ollama')
  assert.equal(fuente.ok, true); assert.match(fuente.nota, /1 modelo\(s\) fallaron/)
  assert.equal(r.catalogo.modelos.find(x => x.modelo === 'gemma4:31b-cloud').capacidades.imagen, true)
  assert.deepEqual(r.catalogo.modelos.find(x => x.modelo === 'llama3.2:3b').capacidades, {})
  // Pasadas 2 horas sigue vigente: no se vuelve a ejecutar nada ni a descargar models.dev (eso es una vez al día).
  const f = fabrica(), otra = await actualizar({ casa, modelos: m, ahora: ahora + 2 * 3600000, ...f })
  assert.equal(otra.actualizado, false); assert.deepEqual(f.llamadas, { ejecutar: 0, descargar: 0 })
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('caché local sirve si falla red y en modo sin línea', async () => {
  const casa = temporal(), ruta = path.join(casa, '.cache', 'opencode', 'models.json')
  fs.mkdirSync(path.dirname(ruta), { recursive: true }); fs.writeFileSync(ruta, dev)
  const m = completar({ opencode: ['opencode/big-pickle'] }), f = fabrica({ fallaRed: true })
  const r = await actualizar({ casa, modelos: m, ...f })
  assert.equal(r.catalogo.fuentes[0].ok, false); assert.match(r.catalogo.fuentes[0].nota, /usada la caché local/)
  const g = fabrica(), s = await actualizar({ casa, modelos: m, enLinea: false, forzar: true, ...g })
  assert.equal(g.llamadas.descargar, 0); assert.equal(s.catalogo.fuentes[0].ok, true)
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('corrupto, versión ajena y forzar', async () => {
  const casa = temporal(), archivo = rutaCatalogo(casa); fs.mkdirSync(path.dirname(archivo), { recursive: true })
  for (const valor of ['basura', JSON.stringify({ version: 1 })]) {
    fs.writeFileSync(archivo, valor); assert.equal(leerCatalogo(casa), undefined)
    assert.equal((await actualizar({ casa, modelos: completar({ claude: ['opus'] }), enLinea: false })).motivo, 'nuevo')
  }
  assert.equal((await actualizar({ casa, modelos: completar({ claude: ['opus'] }), enLinea: false, forzar: true })).motivo, 'forzado')
  assert.equal(fs.readdirSync(path.dirname(archivo)).some(n => n.includes('.tmp.')), false)
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('seis procesos reales escriben JSON completo sin temporales', async () => {
  const casa = temporal(), entrada = JSON.stringify({ modelos: { claude: ['sonnet'], codex: ['chatgpt'] } })
  await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['mcp/catalogo.mjs', 'actualizar', '--forzar', '--sin-linea', '--casa', casa], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''; p.stdout.setEncoding('utf8').on('data', x => out += x); p.stderr.setEncoding('utf8').on('data', x => err += x)
    p.on('error', reject); p.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`${code}: ${err}${out}`))); p.stdin.end(entrada)
  })))
  const c = JSON.parse(fs.readFileSync(rutaCatalogo(casa), 'utf8'))
  assert.deepEqual(c.modelos.map(x => x.agente).sort(), ['claude', 'codex']); assert.equal(fs.readdirSync(path.dirname(rutaCatalogo(casa))).some(n => n.includes('.tmp.')), false)
  fs.rmSync(casa, { recursive: true, force: true })
})
await prueba('CLI leer y actualizar imprimen una línea JSON', async () => {
  const casa = temporal(), leer = spawnSync(process.execPath, ['mcp/catalogo.mjs', 'leer', '--casa', casa], { encoding: 'utf8' })
  assert.equal(leer.status, 0); assert.deepEqual(JSON.parse(leer.stdout), { existe: false }); assert.equal(leer.stdout.trim().split('\n').length, 1)
  const r = spawnSync(process.execPath, ['mcp/catalogo.mjs', 'actualizar', '--sin-linea', '--casa', casa], { input: JSON.stringify({ modelos: { claude: ['opus'], codex: ['chatgpt'] } }), encoding: 'utf8' })
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).ok, true); assert.equal(r.stdout.trim().split('\n').length, 1)
  // También acepta el objeto de modelos directo, sin el envoltorio { modelos }: así lo manda el plugin.
  const directa = spawnSync(process.execPath, ['mcp/catalogo.mjs', 'actualizar', '--forzar', '--sin-linea', '--casa', casa], { input: JSON.stringify({ claude: ['haiku', 'opus'], codex: ['chatgpt'] }), encoding: 'utf8' })
  assert.equal(directa.status, 0); assert.equal(JSON.parse(directa.stdout).modelos, 3)
  fs.rmSync(casa, { recursive: true, force: true })
})
console.log(`\n${hechas} pruebas de catálogo pasan.`)
