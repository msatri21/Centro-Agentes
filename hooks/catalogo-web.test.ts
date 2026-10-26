import { expect, test } from 'claude-code/testing'
import { paginaCentro, type FilaPagina } from './vista'

// Objeto base idéntico en todas las pruebas: así cada test solo cambia el catálogo
// y cualquier diferencia de HTML viene de ahí, no de datos de plan o trabajos.
const base: any = {
  clave: 'k',
  chat: 'c',
  jefe: 'OpenCode',
  plan: { objetivo: 'probar el catálogo', subtareas: [] },
  trabajos: [],
  agentes: [],
  modelos: {},
  rendimiento: [],
  ahorro: 0,
  // Un botón fuera del catálogo: sirve para comprobar que no se cuela en su regex.
  cancelables: [{ id: 'a', titulo: 'x' }],
  relanzables: [],
  version: '1',
  extra: '<svg id="extra"></svg>',
  ahora: 20_000,
}

// El catálogo es la última sección de la página, así que cortar hasta el pie
// aísla sus botones de los del resto (cancelar, relanzar...).
const seccionCatalogo = (html: string) => {
  const inicio = html.indexOf('<h2 class="seccion">Modelos disponibles</h2>')
  expect(inicio).toBeGreaterThanOrEqual(0)
  return html.slice(inicio, html.indexOf('<footer>', inicio))
}

test('el catálogo agrupa por agente y muestra marcas, notas y contexto abreviado', () => {
  const filas: FilaPagina[] = [
    // Van mezcladas a propósito: la página debe agruparlas aunque lleguen así.
    { agente: 'opencode', modelo: 'modelo-a', imagen: 'si', herramientas: 'no', razonamiento: 'desconocido', contexto: 262_144, nota_media: 8.5, veces: 3 },
    { agente: 'ollama', modelo: 'modelo-b', imagen: 'si', herramientas: 'si', razonamiento: 'si', contexto: 1_000_000 },
    { agente: 'opencode', modelo: 'modelo-c', imagen: 'no', herramientas: 'si', razonamiento: 'si', contexto: 1_500_000, nota_media: 7 },
  ]
  const html = paginaCentro({ ...base, catalogo: { generado: 'ayer', filas, fallos: [] } })
  const seccion = seccionCatalogo(html)

  expect(seccion).toContain('<h2 class="seccion">Modelos disponibles</h2>')
  expect(seccion).toContain('<strong>opencode</strong>')
  expect(seccion).toContain('<strong>ollama</strong>')

  // Las dos filas de opencode caen bajo una sola cabecera y antes que ollama.
  const cabeceraOpenCode = seccion.indexOf('<strong>opencode</strong>')
  const cabeceraOllama = seccion.indexOf('<strong>ollama</strong>')
  expect(cabeceraOpenCode).toBeLessThan(seccion.indexOf('modelo-a'))
  expect(seccion.indexOf('modelo-a')).toBeLessThan(seccion.indexOf('modelo-c'))
  expect(seccion.indexOf('modelo-c')).toBeLessThan(cabeceraOllama)
  expect(cabeceraOllama).toBeLessThan(seccion.indexOf('modelo-b'))
  expect(seccion.split('<strong>opencode</strong>').length - 1).toBe(1)

  // Cada capacidad tiene su propia marca, no solo un símbolo suelto en la página.
  expect(seccion).toContain('<span title="Sí admite imágenes">✓</span>')
  expect(seccion).toContain('<span title="No usa herramientas">✗</span>')
  expect(seccion).toContain('<span title="Se desconoce si razona">?</span>')

  // La nota media lleva el número de valoraciones entre paréntesis.
  expect(seccion).toContain('<td>8.5 (3)</td>')
  // modelo-b no tiene nota: se pinta una raya, no un cero que parecería una nota mala.
  expect(seccion).toMatch(/<td>modelo-b<\/td>.*?<td>—<\/td>/)

  // El contexto se abrevia para que quepa: 262144 => 262k, 1000000 => 1M, 1500000 => 1.5M.
  expect(seccion).toContain('<td>262k</td>')
  expect(seccion).toContain('<td>1M</td>')
  expect(seccion).toContain('<td>1.5M</td>')
})

test('cada fila propone su modelo con un botón que se puede volver a leer como JSON', () => {
  const filas: FilaPagina[] = [
    { agente: 'opencode', modelo: 'modelo-a', imagen: 'si', herramientas: 'si', razonamiento: 'si' },
    { agente: 'ollama', modelo: 'modelo-b', imagen: 'no', herramientas: 'no', razonamiento: 'no' },
    { agente: 'opencode', modelo: 'modelo-c', imagen: 'desconocido', herramientas: 'desconocido', razonamiento: 'desconocido' },
  ]
  const seccion = seccionCatalogo(paginaCentro({ ...base, catalogo: { filas, fallos: [] } }))

  // Los botones viajan como atributo escapado; se des-escapa en el mismo orden
  // que usan los navegadores (&amp; al final para no deshacer los demás).
  const crudos = [...seccion.matchAll(/data-accion="([^"]*)"/g)].map(m => m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'))
  const acciones = crudos.map(x => JSON.parse(x))

  // Solo los de la sección: el botón de cancelar de la cabecera no aparece aquí.
  expect(acciones).toHaveLength(3)
  for (const a of acciones) expect(a.tipo).toBe('proponer')
  expect(acciones.map(a => `${a.agente}:${a.modelo}`).sort()).toEqual([
    'ollama:modelo-b',
    'opencode:modelo-a',
    'opencode:modelo-c',
  ])
})

test('el nombre del modelo se escapa: un modelo malicioso no inyecta HTML', () => {
  const filas: FilaPagina[] = [
    { agente: 'opencode', modelo: '<img src=x onerror=alert(1)>', imagen: 'no', herramientas: 'no', razonamiento: 'no' },
  ]
  const html = paginaCentro({ ...base, catalogo: { filas, fallos: [] } })

  expect(seccionCatalogo(html)).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).not.toContain('<img src=x')
})

test('sin catálogo la página es exactamente la de antes y no aparece la sección', () => {
  const html = paginaCentro(base)
  // Mismo objeto con la clave puesta a undefined: no debe cambiar ni un carácter.
  const conUndefined = paginaCentro({ ...base, catalogo: undefined })

  expect(conUndefined).toBe(html)
  expect(html).not.toContain('Modelos disponibles')
  expect(html).not.toContain('Aún no hay catálogo')
})

test('un catálogo vacío explica que se genera al iniciar la sesión', () => {
  const html = paginaCentro({ ...base, catalogo: { filas: [], fallos: [] } })

  expect(html).toContain('Aún no hay catálogo: se genera al iniciar la sesión.')
})

test('los fallos de las fuentes se listan en su propia línea', () => {
  const html = paginaCentro({ ...base, catalogo: { filas: [], fallos: ['ollama: timeout'] } })

  expect(html).toContain('Fallos:')
  expect(html).toContain('<p class="vacio">Fallos: ollama: timeout</p>')
})
