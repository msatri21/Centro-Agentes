// Prueba rápida del servidor MCP sin lanzar agentes: saludo, herramientas, plan con dependencias y que un agente solo vea preguntar y pedir_permiso.
// Uso: node mcp/prueba-mcp.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
const proyectoPrueba = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-mcp-proyecto-'))

function cliente(env = {}) {
  const p = spawn(process.execPath, [servidor], { env: { ...process.env, CENTRO_TRABAJADOR: '0', CENTRO_SIN_NAVEGADOR: '1', CENTRO_CHATS: path.join(os.tmpdir(), 'centro-mcp-prueba'), ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
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
  return { pedir, cerrar: () => p.stdin.end() }
}

// El cerebro de la prueba es un archivo aparte (si no, se tocaría el de verdad) con dos experiencias sembradas.
const cerebroPrueba = path.join(os.tmpdir(), 'centro-cerebro-prueba.json')
fs.writeFileSync(cerebroPrueba, JSON.stringify({ experiencias: [{ en: 1, area: 'css', tarea: 'Estilos nocturnos con animaciones', agente: 'hermes', modelo: 'm1', nota: 9 }, { en: 2, area: 'css', tarea: 'Estilos de una landing', agente: 'opencode', modelo: 'm2', nota: 5 }] }))
const jefe = cliente({ CENTRO_CEREBRO: cerebroPrueba })
const ini = await jefe.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } })
assert.equal(ini.result.serverInfo.name, 'centro-agentes')
const nombres = (await jefe.pedir('tools/list')).result.tools.map(t => t.name)
assert.deepEqual(nombres, ['planificar', 'tareas_estado', 'delegar', 'delegar_varios', 'registrar_auditoria', 'cerrar_subtarea', 'juntar_copias', 'cerebro', 'ranking'])
const memoria = JSON.parse((await jefe.pedir('tools/call', { name: 'cerebro', arguments: { consulta: 'estilos con animaciones para una página', area: 'css' } })).result.content[0].text)
assert.match(memoria.web, /^http:\/\/127\.0\.0\.1:\d+\/\?t=/, 'el cerebro devuelve el enlace del chat')
assert.equal(memoria.recomendacion.agente, 'hermes')
assert.equal(memoria.similares.length, 2)
const plan = JSON.parse((await jefe.pedir('tools/call', { name: 'planificar', arguments: { cwd: proyectoPrueba, objetivo: 'prueba', subtareas: ['a', 'b'], dependencias: { 2: [1] } } })).result.content[0].text)
assert.deepEqual(plan.lanzar_ya, [1])
const bloqueada = JSON.parse((await jefe.pedir('tools/call', { name: 'delegar', arguments: { cwd: proyectoPrueba, categoria: 'x', tarea: 't', subtarea: 2 } })).result.content[0].text)
assert.match(bloqueada.error, /espera a 1/)
const cierre = JSON.parse((await jefe.pedir('tools/call', { name: 'cerrar_subtarea', arguments: { subtarea: 1 } })).result.content[0].text)
assert.deepEqual(cierre.progreso.lanzar_ya, [2])
assert.equal((await jefe.pedir('nada/raro')).error.code, -32601)
jefe.cerrar()

const agente = cliente({ CENTRO_TRABAJADOR: '1' })
await agente.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agente', version: '1' } })
assert.deepEqual((await agente.pedir('tools/list')).result.tools.map(t => t.name), ['preguntar', 'pedir_permiso'])
agente.cerrar()
console.log('ok: servidor MCP del centro')
