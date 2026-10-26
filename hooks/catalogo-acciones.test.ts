import { expect, mock, test } from 'claude-code/testing'

import { construir } from './catalogo'
import type { Catalogo, Fuente, ModelosPorAgente } from './catalogo'
import { atenderAcciones, reiniciarCatalogoParaPruebas } from './register'

// Los mismos modelos y datos que usa catalogo-plugin.test.ts: el catálogo sale de las dos fuentes reales.
const MODELOS: ModelosPorAgente = {
  ollama: ['gemma4:31b-cloud', 'gpt-oss:120b-cloud'],
  opencode: ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle'],
  hermes: [],
  aider: [],
  codex: ['chatgpt'],
  claude: [],
}

const DATOS = {
  ollama: {
    'gemma4:31b-cloud': { capacidades: { imagen: true, herramientas: true, razonamiento: true }, contexto: 32_000 },
    'gpt-oss:120b-cloud': { capacidades: { imagen: false, herramientas: true, razonamiento: true }, contexto: 1_000_000 },
  },
  modelsDev: {
    'deepseek-v4.1-flash-free': { modalities: { input: ['text', 'image'] }, tool_call: true, reasoning: true, limit: { context: 200_000 } },
    'big-pickle': { modalities: { input: ['text'] }, tool_call: true, reasoning: false, limit: { context: 128_000 } },
  },
}

const FUENTES: Fuente[] = [
  { nombre: 'ollama', ok: true, fecha: '2026-10-25' },
  { nombre: 'models.dev', ok: true, fecha: '2026-10-25' },
]

const catalogoDe = (ahora = Date.UTC(2026, 9, 25)) => construir(MODELOS, DATOS, ahora, FUENTES)

// Lo mínimo que necesita register en cada prueba: almacén, reloj, avisos y procesos.
const base = (on: any) => {
  mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
}

// Los archivos que lee register; cualquier otra ruta es un fallo de la prueba.
const archivos = (on: any, leer: (ruta: string) => string | undefined) =>
  on('fs.read', async (_$: any, e: any) => {
    const ruta = String(e?.path ?? e)
    const contenido = leer(ruta.replace(/\\/g, '/'))
    if (contenido === undefined) throw new Error(`ruta no simulada: ${ruta}`)
    return { value: contenido }
  })

// atenderAcciones no usa el motor completo (como refrescarCatalogo), así que se le pasa uno mínimo.
// shortcut: solo fs.read, env.get, ui.toast y prompt.submit, que es lo único que toca.
const motor = () => {
  const enviados: string[] = []
  let contenido = ''
  const $ = {
    env: { get: async () => 'C:\\Users\\Prueba' },
    fs: {
      read: async (ruta: string) => {
        if (String(ruta).endsWith('acciones.jsonl')) return contenido
        throw new Error(`ruta no simulada: ${ruta}`)
      },
    },
    ui: { toast: () => undefined },
    prompt: {
      submit: async (e: { text: string }) => {
        enviados.push(e.text)
      },
    },
  }
  return { $: $ as any, enviados, escribir: (texto: string) => { contenido = texto } }
}

const TEXTO_PROPUESTA = '[Centro de agentes MST] El usuario propone probar el modelo opencode/deepseek-v4.1-flash-free (agente opencode) en la próxima tarea que le encaje. Compruébalo con la herramienta modelos, úsalo con delegar (campo modelo) cuando corresponda y puntúalo al auditar para que el cerebro aprenda.'

test('una propuesta de la web llega al jefe una sola vez y con el texto exacto', async () => {
  const m = motor()

  // Primera lectura con el archivo vacío: fija el punto de partida e ignora lo viejo.
  await atenderAcciones(m.$)
  expect(m.enviados).toHaveLength(0)

  m.escribir('{"tipo":"proponer","agente":"opencode","modelo":"opencode/deepseek-v4.1-flash-free"}\n')
  await atenderAcciones(m.$)
  await new Promise(res => setTimeout(res, 10))

  expect(m.enviados).toHaveLength(1)
  expect(m.enviados[0]).toBe(TEXTO_PROPUESTA)
})

// Sin contexto de register (motor mínimo) solo valen el agente conocido y el patrón del modelo;
// la comprobación "modelo en la lista del agente" necesita el contexto real y la cubre la web (prueba-servidor).
test('una propuesta inválida no llega al jefe', async () => {
  const m = motor()
  await atenderAcciones(m.$)

  m.escribir([
    { tipo: 'proponer', agente: 'desconocido', modelo: 'modelo-x' },
    { tipo: 'proponer', agente: 'opencode', modelo: 'modelo con espacios' },
    { tipo: 'proponer', agente: 'opencode', modelo: 'modelo;rm' },
    { tipo: 'proponer', agente: 'opencode' },
  ].map(l => JSON.stringify(l)).join('\n') + '\n')
  await atenderAcciones(m.$)
  await new Promise(res => setTimeout(res, 10))

  expect(m.enviados).toEqual([])
})

test('/mst-modelos lista el catálogo y la frase para proponer', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const catalogo = catalogoDe()
  archivos(on, ruta => (ruta.endsWith('catalogo.json') ? JSON.stringify(catalogo) : undefined))

  const r = (await $.command.run({ command: 'mst-modelos' })) as any
  expect(r.text).toContain('Catálogo generado:')
  expect(r.text).toContain('opencode: opencode/deepseek-v4.1-flash-free')
  expect(r.text).toContain('Para proponer uno al jefe: dile "prueba con <modelo>" en el chat o pulsa Proponer en la web.')
})

test('/mst-modelos sin catálogo avisa de que se genera al iniciar', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  archivos(on, () => undefined)

  const r = (await $.command.run({ command: 'mst-modelos' })) as any
  expect(r.text).toBe('Aún no hay catálogo: se genera al iniciar la sesión (puede tardar unos segundos).')
})

// Prepara la página web: catálogo, clave, versión, procesos y lo que se escribe.
const pagina = (on: any, catalogo: () => Catalogo | undefined) => {
  on('session.usage', async () => ({ value: { context: { percent: 0, tokens: 0, window: 200_000 } } }))
  archivos(on, ruta => {
    if (ruta.endsWith('catalogo.json')) {
      const c = catalogo()
      return c ? JSON.stringify(c) : undefined
    }
    if (ruta.endsWith('clave.txt')) return 'clave'
    if (ruta.endsWith('plugin.json')) return '{"version":"1"}'
    return undefined
  })
  const escritos: { ruta: string; texto: string }[] = []
  on('fs.write', async (_$: any, e: any) => {
    escritos.push({ ruta: String(e?.path ?? ''), texto: String(e?.content ?? e?.text ?? e?.data ?? '') })
    return { value: undefined }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: 'ok' }
    return { value: { code: 0, signal: null } }
  })
  return escritos
}

const htmlEscrito = (escritos: { ruta: string; texto: string }[]) =>
  escritos.filter(e => e.ruta.endsWith('centro.html')).at(-1)?.texto ?? ''

test('/mst termina con la línea de modelos cuando hay catálogo', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const catalogo = catalogoDe()
  pagina(on, () => catalogo)
  const n = catalogo.modelos.length
  const m = catalogo.modelos.filter(e => e.capacidades.imagen === true).length

  const r = (await $.command.run({ command: 'mst', args: '' })) as any
  expect(r.text.endsWith(`\nModelos: ${n} conocidos, ${m} con imagen. Detalle: /mst-modelos o en la web.`)).toBe(true)
})

test('/mst no añade la línea de modelos sin catálogo', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  pagina(on, () => undefined)

  const r = (await $.command.run({ command: 'mst', args: '' })) as any
  expect(r.text).not.toContain('Modelos:')
})

test('la página escrita incluye la sección del catálogo y sus botones', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const escritos = pagina(on, () => catalogoDe())

  await $.command.run({ command: 'mst', args: '' })
  const html = htmlEscrito(escritos)
  expect(html).toContain('Modelos disponibles')
  // El atributo va escapado; se des-escapa para leerlo como lo lee el navegador.
  const crudo = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  expect(crudo).toContain('"tipo":"proponer"')
})

test('la página escrita avisa cuando no hay catálogo', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const escritos = pagina(on, () => undefined)

  await $.command.run({ command: 'mst', args: '' })
  const html = htmlEscrito(escritos)
  // La vista fusionada pinta la sección con filas vacía: su texto vacío solo sale si
  // armar le pasa un catálogo sin entradas, no si omite el campo por completo.
  expect(html).toContain('Aún no hay catálogo: se genera al iniciar la sesión.')
  // Sin filas no hay botón Proponer (el JSON va escapado en el atributo).
  const crudo = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  expect(crudo).not.toContain('"tipo":"proponer"')
})
