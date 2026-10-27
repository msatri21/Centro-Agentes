import { expect, test } from 'claude-code/testing'
import { CADUCA_MS, construir, desdeModelsDev, detectarNecesidades, filtrarPorCapacidad, filasModelos, huellaDeModelos, leerOllamaShow, modeloOllamaDe, puntosCatalogo, tablaDelPlugin, textoCatalogo, caducado, consultar, entradaDe } from './catalogo'
import type { Catalogo, ModelosPorAgente } from './catalogo'

const vacios = (): ModelosPorAgente => ({ ollama: [], opencode: [], hermes: [], aider: [], codex: [], claude: [] })
const muestra = `  Model
    architecture        gemma4         
    parameters          32682372656    
    context length      262144         
    embedding length    5376           
    quantization        BF16           

  Capabilities
    completion     
    thinking       
        levels     false, true    
        default    false          
    tools          
    vision         `

test('lee ollama show con capabilities completas y contexto', () => {
  expect(leerOllamaShow(muestra)).toEqual({ capacidades: { imagen: true, herramientas: true, razonamiento: true }, contexto: 262144 })
  expect(leerOllamaShow(`  Model\n    context length 131072\n  Capabilities\n    completion\n    tools\n    thinking\n        levels false, true\n        default false`)).toEqual({ capacidades: { imagen: false, herramientas: true, razonamiento: true }, contexto: 131072 })
  expect(leerOllamaShow('')).toEqual({ capacidades: {} })
})

test('models.dev distingue ausencias de valores negativos', () => {
  expect(desdeModelsDev({ modalities: { input: ['text'] }, limit: { context: 1000000 }, tool_call: true, reasoning: false })).toEqual({ capacidades: { imagen: false, herramientas: true, razonamiento: false }, contexto: 1000000 })
  expect(desdeModelsDev({})).toEqual({ capacidades: {} })
  expect(desdeModelsDev(null)).toEqual({ capacidades: {} })
})

test('resuelve nombres de Ollama por agente', () => {
  for (const [a, m, esperado] of [['ollama', 'qwen', 'qwen'], ['aider', 'ollama_chat/qwen', 'qwen'], ['hermes', 'ollama-local/qwen', 'qwen'], ['opencode', 'ollama/qwen', 'qwen'], ['codex', 'ollama/qwen', 'qwen']] as const) expect(modeloOllamaDe(a, m)).toBe(esperado)
  expect(modeloOllamaDe('aider', 'qwen')).toBe(undefined)
  expect(modeloOllamaDe('codex', 'chatgpt')).toBe(undefined)
  expect(modeloOllamaDe('claude', 'sonnet')).toBe(undefined)
})

test('tabla fija solo reconoce modelos conocidos del plugin', () => {
  expect(tablaDelPlugin('claude', 'sonnet')?.capacidades).toEqual({ imagen: true, herramientas: true })
  expect(tablaDelPlugin('codex', 'chatgpt')?.capacidades.imagen).toBe(true)
  expect(tablaDelPlugin('codex', 'gpt-5')).toBe(undefined)
})

test('construir prioriza Ollama, models.dev y tabla; deduplica y marca origen', () => {
  const m = vacios()
  m.ollama = ['qwen']
  m.opencode = ['ollama/qwen', 'opencode/id', 'opencode/missing']
  m.claude = ['sonnet']
  m.codex = ['chatgpt']
  const fuente = [{ nombre: 'ollama', ok: false, fecha: 'hoy', nota: 'sin respuesta' }]
  const c = construir(m, { ollama: { qwen: { capacidades: { imagen: false }, contexto: 8192 } }, modelsDev: { id: { modalities: { input: ['image'] }, tool_call: true } } }, Date.UTC(2026, 0, 2), fuente)
  expect(c.modelos.map(e => e.origen)).toEqual(['ollama', 'ollama', 'models.dev', undefined, 'plugin', 'plugin'])
  expect(c.modelos[0].verificado).toBe('2026-01-02')
  expect(c.fuentes).toBe(fuente)
  expect(construir({ ...m, claude: ['sonnet', 'sonnet'] }, {}, 0, []).modelos.filter(e => e.agente === 'claude')).toHaveLength(1)
  expect(entradaDe(undefined, 'claude', 'haiku')?.origen).toBe('plugin')
})

test('huella ignora el orden; caducidad verifica fecha y huella', () => {
  const a = vacios(), b = vacios()
  a.ollama = ['a', 'b']; a.claude = ['sonnet']
  b.claude = ['sonnet']; b.ollama = ['b', 'a']
  expect(huellaDeModelos(a)).toBe(huellaDeModelos(b))
  const c = construir(a, {}, 1000, [])
  expect(caducado(undefined, 1000, c.huella)).toBe(true)
  expect(caducado(c, 1000 + CADUCA_MS, c.huella)).toBe(false)
  expect(caducado(c, 1001 + CADUCA_MS, c.huella)).toBe(true)
  expect(caducado({ ...c, generado: 'ilegible' }, 1000, c.huella)).toBe(true)
  expect(caducado(c, 1000, 'otra')).toBe(true)
})

test('detecta necesidades de imagen sin confundir imágenes de contenedor o sistema', () => {
  for (const s of ['Transcribe el texto de estas capturas de pantalla', 'Haz OCR de factura.png', 'FOTOS y fotografía', 'Analiza la imagen JPEG', 'Describe the photo']) expect(detectarNecesidades(s)).toEqual(['imagen'])
  for (const s of ['Construye la imagen de docker y súbela', 'docker images', 'imagen de contenedor', 'container image', 'imagen base', 'imagen ISO', 'imagen del sistema', 'imagen de disco', 'Corrige la función suma', 'Resume este informe']) expect(detectarNecesidades(s)).toEqual([])
  for (const s of ['Describe la imagen adjunta', 'Transcribe esta captura de pantalla', 'Lee el texto de esta imagen', 'Haz OCR del documento']) expect(detectarNecesidades(s)).toEqual(['imagen'])
  expect(detectarNecesidades('Actualiza el README con una imagen nueva')).toEqual([])
  expect(detectarNecesidades('Revisa esto', 'imagen')).toEqual(['imagen'])
  for (const s of ['Agrega la meta og-image al layout', 'Optimiza hero.webp en public/', 'Crea una imagen de docker', 'Redimensiona logo.png a 200px', 'Analiza public/img/foo.jpg']) expect(detectarNecesidades(s)).toEqual([])
})

test('filtra en desconocido y ausencia explícita de visión con motivos distintos', () => {
  const m = vacios(); m.ollama = ['qwen']; m.codex = ['custom']
  const c = construir(m, { ollama: { qwen: { capacidades: { imagen: false } } } }, 1, [])
  const candidatos = [{ trabajador: 'claude', modelo: 'otro' }, { trabajador: 'ollama', modelo: 'qwen' }, { trabajador: 'codex', modelo: 'custom' }]
  const r = filtrarPorCapacidad(candidatos, c, ['imagen'])
  expect(r.aptos).toEqual([])
  expect(r.excluidos.map(x => x.motivo)).toEqual(['desconocido', 'no_la_tiene', 'desconocido'])
  expect(filtrarPorCapacidad(candidatos, undefined, []).aptos).toEqual(candidatos)
})

test('puntúa herramientas, razonamiento y contexto como desempate', () => {
  expect(puntosCatalogo(undefined)).toBe(0)
  expect(puntosCatalogo({ agente: 'ollama', modelo: 'x', capacidades: { herramientas: true, razonamiento: true }, contexto: 80000 })).toBeGreaterThan(3.99)
})

test('consulta filtra todas las capacidades y texto muestra marcas, contexto y fuentes fallidas', () => {
  const m = vacios(); m.ollama = ['x']; m.claude = ['sonnet']
  const c = construir(m, { ollama: { x: { capacidades: { imagen: false }, contexto: 262144 } } }, 0, [{ nombre: 'models.dev', ok: false, fecha: '', nota: 'timeout' }])
  expect(consultar(c, { agente: 'claude', necesita: ['imagen', 'herramientas'] })).toHaveLength(1)
  expect(consultar(undefined)).toEqual([])
  expect(textoCatalogo(undefined)).toBe('Aún no hay catálogo')
  const texto = textoCatalogo(c)
  expect(texto).toContain('✗imagen')
  expect(texto).toContain('?herramientas')
  expect(texto).toContain('262k')
  expect(texto).toContain('(plugin)')
  expect(texto).toContain('timeout')
})

test('filasModelos sin catálogo devuelve vacío', () => {
  expect(filasModelos(undefined, {})).toEqual([])
})

test('filasModelos conserva el orden y marca si/no/desconocido', () => {
  const m = vacios()
  m.ollama = ['a']
  m.codex = ['chatgpt']
  m.claude = ['sonnet']
  const c = construir(m, { ollama: { a: { capacidades: { imagen: false, herramientas: true } } } }, Date.UTC(2026, 0, 2), [])
  const filas = filasModelos(c, {})
  expect(filas.map(f => `${f.agente}:${f.modelo}`)).toEqual(['ollama:a', 'codex:chatgpt', 'claude:sonnet'])
  expect(filas[0]).toMatchObject({ imagen: 'no', herramientas: 'si', razonamiento: 'desconocido' })
  expect(filas[1]).toMatchObject({ imagen: 'si', herramientas: 'si', razonamiento: 'desconocido', origen: 'plugin' })
  expect(filas[2]).toMatchObject({ imagen: 'si', herramientas: 'si', razonamiento: 'desconocido', origen: 'plugin', verificado: '2026-01-02' })
})

test('filasModelos suma nota_media y veces de todas las categorías', () => {
  const m = vacios(); m.claude = ['haiku']
  const c = construir(m, {}, 0, [])
  const tabla = { codigo: { 'claude:haiku': { n: 2, suma: 16 } }, texto: { 'claude:haiku': { n: 1, suma: 7 } } }
  const filas = filasModelos(c, tabla)
  expect(filas).toHaveLength(1)
  expect(filas[0].veces).toBe(3)
  expect(filas[0].nota_media).toBe(Math.round(23 / 3 * 10) / 10)
  expect(filas[0].nota_media).toBe(7.7)
})

test('filasModelos omite nota_media y veces si nunca se usó', () => {
  const m = vacios(); m.claude = ['haiku']
  const c = construir(m, {}, 0, [])
  const fila = filasModelos(c, { codigo: { 'claude:haiku': { n: 0, suma: 0 } } })[0]
  expect('nota_media' in fila).toBe(false)
  expect('veces' in fila).toBe(false)
})

test('filasModelos ignora claves de la tabla fuera del catálogo', () => {
  const m = vacios(); m.claude = ['haiku']
  const c = construir(m, {}, 0, [])
  const filas = filasModelos(c, { codigo: { 'codex:chatgpt': { n: 5, suma: 40 } } })
  expect(filas).toHaveLength(1)
  expect(filas.some(f => f.agente === 'codex')).toBe(false)
  expect('nota_media' in filas[0]).toBe(false)
})

