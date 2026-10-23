// Comprueba la integración del plan del jefe con mst-tareas.json sin lanzar agentes reales.
// Un "opencode" falso en el PATH permite probar delegar y registrar_auditoria de punta a punta:
// no gasta modelos y todo lo que se escribe cae en carpetas temporales.
// Uso: node mcp/prueba-mcp-tareas.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-tareas-'))
const raiz = path.join(temporal, 'proyecto')
fs.mkdirSync(raiz)
const cerebro = path.join(temporal, 'cerebro.json')
const chats = path.join(temporal, 'chats')
// HOME/USERPROFILE temporales: puntajes, clave y web también quedan dentro de la prueba.
const casa = path.join(temporal, 'casa')
const marca = path.join(temporal, 'lanzamientos.txt')
fs.writeFileSync(cerebro, JSON.stringify({ experiencias: [] }))

// Trabajadores falsos: el centro cree que son opencode y hermes, y lee su salida como la de ellos.
const falso = path.join(temporal, 'bin')
fs.mkdirSync(falso)
const guion = path.join(falso, 'opencode-falso.mjs')
fs.writeFileSync(guion, `import fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(marca)}, 'x')\nconsole.log(JSON.stringify({ type: 'text', part: { text: 'hecho' } }))\n`)
const entradaHermes = path.join(temporal, 'entrada-hermes.txt')
const guionHermes = path.join(falso, 'hermes-falso.mjs')
fs.writeFileSync(guionHermes, `import fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(marca)}, 'x')\nfs.writeFileSync(${JSON.stringify(entradaHermes)}, fs.readFileSync(0, 'utf8'))\nconsole.log(JSON.stringify({ type: 'text', text: 'hecho' }))\n`)
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(falso, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${guion}" %*\r\n`)
  fs.writeFileSync(path.join(falso, 'hermes.cmd'), `@echo off\r\n"${process.execPath}" "${guionHermes}" %*\r\n`)
} else {
  fs.writeFileSync(path.join(falso, 'opencode'), `#!/usr/bin/env node\nimport fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(marca)}, 'x')\nconsole.log(JSON.stringify({ type: 'text', part: { text: 'hecho' } }))\n`)
  fs.writeFileSync(path.join(falso, 'hermes'), `#!/usr/bin/env node\nimport fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(marca)}, 'x')\nfs.writeFileSync(${JSON.stringify(entradaHermes)}, fs.readFileSync(0, 'utf8'))\nconsole.log(JSON.stringify({ type: 'text', text: 'hecho' }))\n`)
  fs.chmodSync(path.join(falso, 'opencode'), 0o755)
  fs.chmodSync(path.join(falso, 'hermes'), 0o755)
}
// PATH mínimo: el falso primero y solo lo imprescindible para que arranque cmd (Windows) o env (Linux/macOS).
const systemPath = process.platform === 'win32'
  ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), process.env.SystemRoot ?? 'C:\\Windows', path.dirname(process.execPath)]
  : [path.dirname(process.execPath), '/usr/bin', '/bin']
const PATH = [falso, ...systemPath].filter(Boolean).join(path.delimiter)

function cliente() {
  const p = spawn(process.execPath, [servidor], {
    env: {
      ...process.env,
      PATH,
      HOME: casa,
      USERPROFILE: casa,
      CENTRO_TRABAJADOR: '0',
      CENTRO_SIN_NAVEGADOR: '1',
      CENTRO_SIN_WEB: '1',
      CENTRO_CHATS: chats,
      CENTRO_CEREBRO: cerebro,
      // Solo los trabajadores falsos: si algo intentara otro, no habría modelos y fallaría la prueba.
      CENTRO_MODELOS: JSON.stringify({ opencode: ['opencode/falso'], hermes: ['hermes-falso'] }),
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let resto = '', id = 0
  const pendientes = new Map()
  p.stdout.on('data', d => {
    resto += d
    let i
    while ((i = resto.indexOf('\n')) >= 0) {
      const m = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1)
      pendientes.get(m.id)?.(m)
    }
  })
  const pedir = (method, params) => new Promise(r => { const n = ++id; pendientes.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  const llamar = async (nombre, argumentos) => {
    const m = await pedir('tools/call', { name: nombre, arguments: argumentos })
    return { ...JSON.parse(m.result.content[0].text), errorMcp: m.result.isError }
  }
  return { pedir, llamar, cerrar: () => p.stdin.end() }
}

const jefe = cliente()
const llamar = (nombre, args = {}) => jefe.llamar(nombre, { cwd: raiz, ...args })
const archivoDeTareas = () => JSON.parse(fs.readFileSync(path.join(raiz, 'mst-tareas.json'), 'utf8'))
const lanzamientos = () => (fs.existsSync(marca) ? fs.readFileSync(marca, 'utf8').length : 0)

// Sin archivo: tareas_estado lo dice en vez de inventar un plan.
const vacio = await llamar('tareas_estado')
assert.equal(vacio.existe, false)
assert.equal(vacio.aviso, 'Aún no hay plan guardado: se crea con el primer planificar.')

// Crear: el plan se guarda en T1 con sus subtareas y dependencias.
const crear = await llamar('planificar', { objetivo: 'Integración', subtareas: ['Base', 'Prueba'], dependencias: { 2: [1] } })
assert.equal(crear.tarea, 'T1')
assert.deepEqual(crear.ids, ['T1.1', 'T1.2'])
assert.equal(crear.archivo.creado, true)
assert.deepEqual(crear.lanzar_ya, [1])
const primero = archivoDeTareas()
assert.deepEqual(primero.tareas[0].subtareas.map(s => s.id), ['T1.1', 'T1.2'])
assert.deepEqual(primero.tareas[0].subtareas[1].depende_de, ['T1.1'])

// El mismo objetivo reutiliza la tarea en vez de duplicarla.
const reutilizar = await llamar('planificar', { objetivo: 'Integración', subtareas: ['Base', 'Prueba'] })
assert.equal(reutilizar.tarea, 'T1')
assert.equal(archivoDeTareas().siguiente_tarea, 2)

// Manuales: se guardan con manual: true y no se delegan nunca.
const manual = await llamar('planificar', { objetivo: 'Manual', subtareas: ['Paso humano', 'Paso automático'], manuales: [1] })
assert.equal(manual.tarea, 'T2')
assert.equal(archivoDeTareas().tareas[1].subtareas[0].manual, true)
const rechazoManual = await llamar('delegar', { categoria: 'manual', tarea: 'No lanzar', subtarea: 1 })
assert.match(rechazoManual.error, /manual y no se delega/)
assert.equal(rechazoManual.id, undefined)
assert.equal(lanzamientos(), 0)

// Agregar y ajustar actúan sobre la tarea activa y devuelven los ids nuevos.
const agregar = await llamar('planificar', { agregar: ['Operación'] })
assert.deepEqual(agregar.ids, ['T2.1', 'T2.2', 'T2.3'])
assert.equal(archivoDeTareas().tareas[1].subtareas.length, 3)
const ajustar = await llamar('planificar', { ajustar: { 'T2.3': { titulo: 'Operación final' } } })
assert.equal(ajustar.subtareas[2].titulo, 'Operación final')
assert.equal(archivoDeTareas().tareas[1].subtareas[2].titulo, 'Operación final')

// El protocolo de los agentes (no editar mst-tareas.json, anotar «Propuestas:») también sale de este servidor.
const protocolo = await llamar('delegar', { categoria: 'texto', trabajador: 'hermes', tarea: 'Redacta algo', subtarea: 2 })
assert.equal(protocolo.exito, true)
const entrada = fs.readFileSync(entradaHermes, 'utf8')
assert.match(entrada, /No edites mst-tareas\.json/)
assert.match(entrada, /Propuestas:/)
assert.equal(archivoDeTareas().tareas[1].subtareas[1].estado, 'realizado')
assert.equal(lanzamientos(), 1)

// Cargar una tarea concreta y rechazar modos mezclados.
const cargar = await llamar('planificar', { tarea: 'T1' })
assert.equal(cargar.tarea, 'T1')
assert.deepEqual(cargar.subtareas.map(s => s.titulo), ['Base', 'Prueba'])
const mezclados = await llamar('planificar', { tarea: 'T1', agregar: ['mal'] })
assert.match(mezclados.error, /Elige un solo modo/)
const estado = await llamar('tareas_estado')
assert.equal(estado.existe, true)
assert.equal(estado.tareas.length, 2)
assert.equal(estado.activa.id, 'T1')

// Cerrar como jefe deja la subtarea solucionada EN EL ARCHIVO.
const cierre = await llamar('cerrar_subtarea', { subtarea: 1 })
assert.equal(cierre.hecha, 1)
assert.deepEqual(cierre.progreso.lanzar_ya, [2])
assert.equal(archivoDeTareas().tareas[0].subtareas[0].estado, 'solucionado')

// Delegar de verdad (con el falso): pasa por en_proceso y el resultado queda realizado.
const delegado = await llamar('delegar', { categoria: 'tests', trabajador: 'opencode', tarea: 'Ejecuta la prueba', subtarea: 2 })
assert.equal(delegado.exito, true)
assert.ok(delegado.id)
assert.equal(lanzamientos(), 2)
assert.equal(archivoDeTareas().tareas[0].subtareas[1].estado, 'realizado')

// Auditar con 6 o más la deja solucionada en memoria y en el archivo.
const audiencia = await llamar('registrar_auditoria', { id: delegado.id, puntaje: 8, nota: 'cumple' })
assert.equal(audiencia.puntaje, 8)
assert.deepEqual(audiencia.progreso.faltan, [])
assert.equal(archivoDeTareas().tareas[0].subtareas[1].estado, 'solucionado')

// Una subtarea que ya no está pendiente no se vuelve a lanzar (ni se gasta un agente).
const conflicto = await llamar('delegar', { categoria: 'tests', trabajador: 'opencode', tarea: 'Otra vez', subtarea: 2 })
assert.match(conflicto.error, /ya está en proceso/)
assert.equal(lanzamientos(), 2)

// Reabrir una tarea auditada vuelve a pendiente solo la subtarea indicada y reconstruye el plan.
const reapertura = await llamar('planificar', { objetivo: 'Reapertura', subtareas: ['Uno', 'Dos'] })
await llamar('cerrar_subtarea', { subtarea: 1 })
await llamar('cerrar_subtarea', { subtarea: 2 })
assert.equal(archivoDeTareas().tareas[2].estado, 'solucionado')
assert.ok(archivoDeTareas().tareas[2].solucionada)
const reabierta = await llamar('planificar', { reabrir: ['T3.2'] })
assert.equal(reabierta.tarea, 'T3')
assert.deepEqual(reabierta.reabiertas, ['T3.2'])
assert.deepEqual(reabierta.lanzar_ya, [2])
assert.equal(reabierta.subtareas[1].estado, 'pendiente')
assert.equal(archivoDeTareas().tareas[2].estado, 'en_proceso')
assert.equal(archivoDeTareas().tareas[2].solucionada, null)
assert.equal(archivoDeTareas().tareas[2].subtareas[1].estado, 'pendiente')
assert.equal((await llamar('planificar', { reabrir: ['T1.1', 'T3.1'] })).error, 'Reabre subtareas de una sola tarea por llamada.')
const idInexistente = await llamar('planificar', { reabrir: ['T3.9'] })
assert.match(idInexistente.error, /La subtarea no existe/)
assert.match(idInexistente.error, /Reabiertas: ninguna/)
assert.match((await llamar('planificar', { reabrir: ['T3.1'], tarea: 'T3' })).error, /Elige un solo modo/)
assert.equal(archivoDeTareas().tareas[2].subtareas[0].estado, 'solucionado')

// Archivo bloqueado (aquí, una carpeta con su nombre): el trabajo sigue con aviso_archivo.
fs.renameSync(path.join(raiz, 'mst-tareas.json'), path.join(temporal, 'tareas-guardadas.json'))
fs.rmSync(path.join(raiz, 'mst-tareas.json.bak'), { force: true })
fs.mkdirSync(path.join(raiz, 'mst-tareas.json'))
const sinArchivo = await llamar('delegar', { categoria: 'tests', trabajador: 'opencode', tarea: 'Sigue sin archivo', subtarea: 1 })
assert.equal(sinArchivo.exito, true)
assert.ok(sinArchivo.aviso_archivo)
assert.equal(lanzamientos(), 3)

// Crear con el archivo ilegible conserva el plan en memoria y avisa; no inventa una tarea.
const bloqueada = path.join(temporal, 'bloqueado')
fs.mkdirSync(bloqueada)
fs.mkdirSync(path.join(bloqueada, 'mst-tareas.json'))
const planMemoria = await jefe.llamar('planificar', { cwd: bloqueada, objetivo: 'Solo memoria', subtareas: ['Continúa'] })
assert.equal(planMemoria.tarea, undefined)
assert.equal(planMemoria.guardado, true)
assert.ok(planMemoria.aviso_archivo)
assert.deepEqual(planMemoria.subtareas.map(s => s.n), [1])
assert.match((await jefe.llamar('planificar', { cwd: bloqueada, tarea: 'T1' })).error, /No existe la tarea T1/)
// Sin archivo válido, tareas_estado informa de que está corrupto en vez de romperse.
const corrupto = await jefe.llamar('tareas_estado', { cwd: bloqueada })
assert.equal(corrupto.existe, true)
assert.equal(corrupto.corrupto, true)

// La lista exacta de herramientas del jefe incluye tareas_estado (los trabajadores solo ven preguntar y pedir_permiso).
const nombres = (await jefe.pedir('tools/list')).result.tools.map(t => t.name)
assert.deepEqual(nombres, ['planificar', 'tareas_estado', 'delegar', 'delegar_varios', 'registrar_auditoria', 'cerrar_subtarea', 'juntar_copias', 'cerebro', 'ranking'])
jefe.cerrar()
console.log('ok: integración de tareas del servidor MCP')
