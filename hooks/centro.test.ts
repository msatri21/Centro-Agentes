import { expect, mock, test } from 'claude-code/testing'

import { colaDeLineas, figura, pagina, tablero } from './figura'
import { buscarSkills, conSkills, costoComoClaude, esErrorDeCuenta, esMasNueva, etiquetaChat, leerFrontmatter, nombreDesdeMensaje, recuperar } from './register'

test('al recuperar un chat, lo que estaba en marcha queda interrumpido y su subtarea vuelve a pendiente', async () => {
  const g = {
    plan: { objetivo: 'o', subtareas: [{ n: 1, titulo: 'a', estado: 'hecha' as const }, { n: 2, titulo: 'b', estado: 'en curso' as const }] },
    trabajos: [
      { id: 't1', trabajador: 'ollama:x', categoria: 'c', tarea: 'a', estado: 'listo' as const, inicio: 1, subtarea: 1 },
      { id: 't2', trabajador: 'hermes:y', categoria: 'c', tarea: 'b', estado: 'corriendo' as const, inicio: 2, subtarea: 2 },
    ],
    encargos: [[2, { categoria: 'c', tarea: 'b', subtarea: 2 }]] as [number, any][],
  }
  const r = recuperar(g)
  expect(r.interrumpidos).toBe(1)
  expect(r.plan!.subtareas.map(s => s.estado)).toEqual(['hecha', 'pendiente'])
  expect(r.trabajos.map(t => t.estado)).toEqual(['listo', 'error'])
  expect(r.trabajos[1].salida).toContain('interrumpido')
  expect(r.encargos).toEqual(g.encargos)
})

test('el nombre del chat sale de su primer mensaje (o de la tarea de /mst) y va en la cabecera', async () => {
  expect(nombreDesdeMensaje('  revisa   el informe\nde ventas ')).toBe('revisa el informe de ventas')
  expect(nombreDesdeMensaje('Actúa como JEFE...\n\nTAREA:\nhaz el README')).toBe('haz el README')
  expect(etiquetaChat('Documentos', 'cruce 2023')).toBe('Documentos · cruce 2023')
  expect(etiquetaChat('', '')).toBe('chat')
  const html = pagina('<svg></svg>', '<svg></svg>', 't', 2, {
    clave: 'k', cancelables: [], relanzables: [], chat: 'Documentos · <cruce>',
    kpis: [{ etiqueta: 'Progreso', valor: '33%', nota: '1 de 3 subtareas' }, { etiqueta: 'Ahorro', valor: '$0.87', nota: 'total' }],
  })
  expect(html).toContain('/mst · orquestador de agentes · Documentos · &lt;cruce&gt;')
  expect(html).toContain('<h1>Centro de agentes <b>MST</b></h1>')
  expect(html).toContain('<i>01</i><span>Progreso</span><strong>33%</strong><small>1 de 3 subtareas</small>')
  expect(html).toContain('<i>02</i><span>Ahorro</span><strong>$0.87</strong>')
})

test('skills: lee el encabezado, busca por palabras, se marcan con ✦ y se reconocen errores de cuenta', async () => {
  const md = '﻿---\r\nname: design-md\r\ndescription: "Sistemas de diseño de marcas reales para UI y landing pages"\r\n---\r\n# Cuerpo'
  expect(leerFrontmatter(md)).toEqual({ name: 'design-md', description: 'Sistemas de diseño de marcas reales para UI y landing pages' })
  expect(leerFrontmatter('sin encabezado')).toEqual({ name: undefined, description: undefined })
  // Descripción de varias líneas, como la de design-md.
  expect(leerFrontmatter('---\nname: design-md\ndescription: >-\n  Reference library of brand\n  design systems.\nlicense: MIT\n---\n').description).toBe('Reference library of brand design systems.')
  const lista = [
    { nombre: 'design-md', descripcion: 'Sistemas de diseño para landing pages', ruta: 'a' },
    { nombre: 'vercel:deploy', descripcion: 'Despliega el proyecto en Vercel', ruta: 'b' },
    { nombre: 'pdf', descripcion: 'Leer y crear archivos PDF', ruta: 'c' },
  ]
  expect(buscarSkills(lista, 'diseño de una landing').map(s => s.nombre)).toEqual(['design-md'])
  expect(buscarSkills(lista, 'desplegar en vercel').map(s => s.nombre)).toEqual(['vercel:deploy'])
  expect(buscarSkills(lista, 'qqq')).toEqual([])
  // "3d" cuenta aunque sea corta; "de" no.
  expect(buscarSkills([...lista, { nombre: 'img2threejs', descripcion: 'Builds a 3d model from an image', ruta: 'd' }], '3d de').map(s => s.nombre)).toEqual(['img2threejs'])
  expect(conSkills(['design-md'], 'haz la portada')).toBe('✦ design-md · haz la portada')
  expect(conSkills(undefined, 'haz la portada')).toBe('haz la portada')
  expect(esErrorDeCuenta('This API key has expired. Create a new API key in OpenCode Console')).toBe(true)
  expect(esErrorDeCuenta('Todo bien, archivo creado')).toBe(false)
})

test('una tarea con skills no va a Ollama y el agente recibe la instrucción de seguirlas', async ($, on) => {
  base(on)
  const vistos: { argv: string[]; input?: string }[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    vistos.push({ argv: e.argv, input: e.input })
    yield { stream: 'stdout', text: '{"type":"text","part":{"text":"hecho"}}' }
    return { value: { code: 0, signal: null } }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'diseño', tarea: 'haz la portada', skills: ['design-md'] } }))
  expect(d.exito).toBe(true)
  expect(d.trabajador.startsWith('ollama')).toBe(false)
  const lanzado = vistos[vistos.length - 1]
  expect(`${lanzado.argv.join(' ')} ${lanzado.input ?? ''}`).toContain('Usa estas skills')
  expect(`${lanzado.argv.join(' ')} ${lanzado.input ?? ''}`).toContain('design-md')
})

test('compara versiones para saber si hay que autoactualizar', async () => {
  expect(esMasNueva('0.3.1', '0.3.0')).toBe(true)
  expect(esMasNueva('0.10.0', '0.9.9')).toBe(true)
  expect(esMasNueva('0.3.0', '0.3.0')).toBe(false)
  expect(esMasNueva('0.2.9', '0.3.0')).toBe(false)
  expect(esMasNueva('1.0', '0.99.99')).toBe(true)
})

test('el ahorro se calcula con el precio de Claude Sonnet 5.5', async () => {
  // 1M de entrada a $2 y 1M de salida a $10.
  expect(costoComoClaude(1_000_000, 0)).toBe(2)
  expect(costoComoClaude(0, 1_000_000)).toBe(10)
  expect(costoComoClaude()).toBe(0)
})

test('cada trabajo queda en el historial permanente con su puntaje, y suma al ahorro', async ($, on) => {
  base(on, { almacen: false })
  // Un almacén propio, para ver lo que el centro guarda por clave.
  const guardado: Record<string, any> = {}
  on('store.get', async (_$: any, e: any) => ({ value: guardado[e.key] }))
  on('store.set', async (_$: any, e: any) => {
    guardado[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', async (_$: any, e: any) => {
    delete guardado[e.key]
    return { value: undefined }
  })
  procesos(on, () => ({ stdout: '{"type":"text","part":{"text":"hecho"}}\n{"type":"step_finish","part":{"tokens":{"input":500000,"output":100000,"reasoning":0,"cache":{"read":0,"write":0}},"cost":0}}' }))
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'opencode', categoria: 'codigo', tarea: 'x' } }))
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: d.id, puntaje: 7 } })
  expect(guardado.historial.map((t: any) => [t.id, t.puntaje])).toEqual([[d.id, 7]])
  // 500k de entrada y 100k de salida con Claude Sonnet 5.5: $1 + $1.
  expect(guardado.ahorro).toEqual({ usd: 2, gastoClaude: 0, trabajos: 1 })
})

test('la página con controles lleva los botones, el aviso de listo y la notificación', async () => {
  const html = pagina('<svg></svg>', '<svg></svg>', 't', 2, {
    clave: 'k1',
    cancelables: [{ id: 'tA', titulo: 'ollama · <x>' }],
    relanzables: [{ n: 3, titulo: 'docs' }],
    listo: 'mi objetivo',
  })
  expect(html).toContain('■ Cancelar ollama · &lt;x&gt;')
  expect(html).toContain('data-accion="{&quot;tipo&quot;:&quot;cancelar&quot;,&quot;id&quot;:&quot;tA&quot;}"')
  expect(html).toContain('↻ Relanzar 3 · docs')
  expect(html).toContain('✓ Todo listo · mi objetivo')
  expect(html).toContain('new Notification')
  // Con controles recarga el script, no la etiqueta meta (que cortaría un clic a medias).
  expect(html).not.toContain('http-equiv="refresh"')
})

test('al quedar todas las subtareas hechas avisa una sola vez', async ($, on) => {
  base(on, { avisos: false })
  const toasts: string[] = []
  on('ui.toast', async (_$: any, e: any) => {
    toasts.push(typeof e === 'string' ? e : (e.text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  procesos(on)
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'demo', subtareas: ['a', 'b'] } })
  const a = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'claude', categoria: 'x', tarea: 'a', subtarea: 1 } }))
  const b = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'claude', categoria: 'x', tarea: 'b', subtarea: 2 } }))
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: a.id, puntaje: 8 } })
  expect(toasts.filter(t => t.includes('Todo listo')).length).toBe(0)
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: b.id, puntaje: 9 } })
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: b.id, puntaje: 9 } })
  expect(toasts.filter(t => t.includes('Todo listo')).length).toBe(1)
})

import { entornoDeRed, esErrorDeRed, leerClaude, leerHermes, leerOllama, leerOpencode, ordenar, proxyDeRegistro, vistaDe } from './register'

// La salida real de `hermes chat --format stream-json` contra el Ollama local.
const HERMES_OK = [
  '{"type": "system", "subtype": "init", "model": "gpt-oss:20b-cloud", "session_id": "s1"}',
  '{"type": "text", "text": "ok"}',
  '{"type": "result", "session_id": "s1", "exit_code": 0, "text": "ok", "tokens": {"input": 7481, "output": 34, "total": 11391, "cache_read": 3876, "cache_write": 0}}',
].join('\n')

test('hermes: lee su respuesta y tokens, y el centro lo lanza con su proveedor y modelo', async ($, on) => {
  expect(leerHermes(HERMES_OK)).toEqual({ texto: 'ok', tokensIn: 11357, tokensOut: 34, exitCode: 0 })
  expect(vistaDe('hermes', HERMES_OK)).toBe('ok')
  base(on)
  const argvs: string[][] = []
  procesos(on, argv => {
    argvs.push(argv)
    return { stdout: HERMES_OK, stderr: 'session_id: s1' }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'hermes', categoria: 'texto', tarea: 'di ok' } }))
  expect(d.exito).toBe(true)
  expect(d.trabajador).toBe('hermes:ollama-local/gpt-oss:120b-cloud')
  expect(d.salida).toBe('ok')
  expect(argvs[0].slice(1)).toEqual(['chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--yolo', '--provider', 'ollama-local', '-m', 'gpt-oss:120b-cloud'])
})

test('lee el proxy de Windows y prepara las variables de red sin mandar el Ollama local por el proxy', async () => {
  const reg = (on: string, srv?: string) => `    ProxyEnable    REG_DWORD    ${on}\n${srv ? `    ProxyServer    REG_SZ    ${srv}\n` : ''}`
  expect(proxyDeRegistro(reg('0x0', 'proxy:8080'))).toBe(undefined)
  expect(proxyDeRegistro(reg('0x1', 'proxy.empresa:8080'))).toBe('http://proxy.empresa:8080')
  expect(proxyDeRegistro(reg('0x1', 'http=p1:80;https=p2:443'))).toBe('http://p2:443')
  expect(proxyDeRegistro(reg('0x1'))).toBe(undefined)
  const e = entornoDeRed('http://p:8080', 'C:\\ca.pem')
  expect(e.HTTPS_PROXY).toBe('http://p:8080')
  expect(e.NO_PROXY).toContain('127.0.0.1')
  expect(e.NODE_EXTRA_CA_CERTS).toBe('C:\\ca.pem')
  expect(entornoDeRed()).toEqual({})
  expect(esErrorDeRed('Error: connect ECONNREFUSED 1.2.3.4:443')).toBe(true)
  expect(esErrorDeRed('407 Proxy Authentication Required')).toBe(true)
  expect(esErrorDeRed('self-signed certificate in certificate chain')).toBe(true)
  // El mensaje real de opencode detrás de un proxy que no deja pasar.
  expect(esErrorDeRed('Cannot connect to API: Unable to connect. Is the computer able to access the url?')).toBe(true)
  expect(esErrorDeRed('Escribe una función que valide un certificado')).toBe(false)
})

test('si el agente pedido no tiene red, corta enseguida y pasa a otro agente', async ($, on) => {
  base(on)
  const usados: string[] = []
  procesos(on, argv => {
    usados.push(argv[0] === 'cmd' ? argv[4].split(' ')[0] : argv[0])
    return argv[0] === 'opencode' || argv[4]?.startsWith('opencode')
      ? { exitCode: 1, stderr: 'Error: connect ECONNREFUSED 10.0.0.1:443' }
      : { stdout: 'ok' }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'opencode', categoria: 'codigo', tarea: 'x' } }))
  expect(d.exito).toBe(true)
  expect(d.trabajador.startsWith('opencode')).toBe(false)
  // Un solo intento con opencode: tras el error de red se aparta el agente entero.
  expect(usados.filter(u => u === 'opencode').length).toBe(1)
  expect(d.cambios[0]).toContain('ECONNREFUSED')
})

// Las herramientas devuelven su resultado como JSON en texto.
const out = (r: unknown) => JSON.parse((r as { result: string }).result)

type Respuesta = { exitCode?: number; stdout?: string; stderr?: string }
// Simula los procesos de los agentes: cada llamada a $.process.spawn responde con lo que dé `fn`.
const procesos = (on: any, fn: (argv: string[]) => Respuesta = () => ({ stdout: 'ok' })) =>
  on('process.spawn', async function* (_$: any, e: any) {
    const r = fn(e.argv)
    if (r.stdout) yield { stream: 'stdout', text: r.stdout }
    if (r.stderr) yield { stream: 'stderr', text: r.stderr }
    return { value: { code: r.exitCode ?? 0, signal: null } }
  })

const base = (on: any, { almacen = true, avisos = true } = {}) => {
  if (almacen) mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  if (avisos) on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
}

test('la página junta las dos tarjetas, se recarga sola y escapa el título', async () => {
  const html = pagina('<svg id="a"></svg>', '<svg id="b"></svg>', 'Centro <1/3>')
  expect(html).toContain('http-equiv="refresh" content="2"')
  expect(html).toContain('<svg id="a"></svg><svg id="b"></svg>')
  expect(html).toContain('<title>Centro &lt;1/3></title>')
  expect(html).toContain('Centro de agentes <b>MST</b>')
  // Dos tarjetas de 640 de ancho: 380 y 760 de alto → la primera recibe el doble de ancho para medir lo mismo de alto.
  const dos = pagina('<svg viewBox="0 0 640 380"></svg>', '<svg viewBox="0 0 640 760"></svg>', 't')
  expect(dos).toContain('grid-template-columns:1.684fr 0.842fr')
})

test('ordenar pone primero lo bueno, luego lo no probado y al final lo malo, salta los caídos y encarece Claude', async () => {
  const tabla = { codigo: { 'ollama:a': { n: 2, suma: 18, msTotal: 0 }, 'ollama:b': { n: 1, suma: 3, msTotal: 0 }, 'claude:haiku': { n: 1, suma: 7, msTotal: 0 } } }
  const c = [{ trabajador: 'ollama', modelo: 'b' }, { trabajador: 'ollama', modelo: 'c' }, { trabajador: 'ollama', modelo: 'a' }, { trabajador: 'opencode', modelo: 'd' }] as const
  expect(ordenar(tabla, 'codigo', [...c], new Set()).map(x => x.modelo)).toEqual(['a', 'c', 'd', 'b'])
  expect(ordenar(tabla, 'codigo', [...c], new Set(['ollama:a', 'ollama:c'])).map(x => x.modelo)).toEqual(['d', 'b'])
  // Claude con 7 vale 5,5 tras el recargo: pierde contra un gratis sin probar (6,5).
  expect(ordenar(tabla, 'codigo', [{ trabajador: 'claude', modelo: 'haiku' }, { trabajador: 'opencode', modelo: 'd' }], new Set()).map(x => x.modelo)).toEqual(['d', 'haiku'])
})

test('si el primer modelo falla, delegar cambia solo al siguiente y lo cuenta en cambios', async ($, on) => {
  base(on)
  const usados: string[] = []
  procesos(on, argv => {
    usados.push(argv[argv.length - 1])
    return argv.some(a => a.endsWith('cloud'))
      ? { exitCode: 1, stderr: 'You need to be signed in to Ollama to run Cloud models.' }
      : { stdout: 'ok' }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', categoria: 'texto', tarea: 'hola' } }))
  // Sin sesión, el primer :cloud falla, los demás :cloud se saltan y responde el local.
  expect(d.exito).toBe(true)
  expect(d.trabajador).toBe('ollama:llama3.2:3b')
  expect(d.cambios[0]).toContain('signed in')
  expect(usados).toEqual(['gpt-oss:120b-cloud', 'llama3.2:3b'])
})

test('delegar_varios lanza las tareas a la vez y reparte modelos distintos', async ($, on) => {
  base(on)
  procesos(on, () => ({ stdout: '{"type":"text","part":{"text":"hecho"}}' }))
  const r = out(await $.tool.call({
    tool: 'mcp__centro-agentes__delegar_varios',
    input: { tareas: [{ tarea: 'a', categoria: 'codigo', subtarea: 1 }, { tarea: 'b', categoria: 'codigo', subtarea: 2 }] },
  }))
  const quienes = r.resultados.map((x: any) => x.trabajador)
  expect(r.resultados.every((x: any) => x.exito)).toBe(true)
  expect(new Set(quienes).size).toBe(2)
  expect(quienes[0]).toBe('opencode:ollama/gpt-oss:120b-cloud')
})

test('la terminal de un agente muestra su texto legible y sus últimas líneas', async () => {
  const claude = ['{"type":"assistant","message":{"content":[{"type":"text","text":"Leyendo"},{"type":"tool_use","name":"Read"}]}}', '{"type":"result","result":"fin"}'].join('\n')
  expect(vistaDe('claude', claude)).toBe('Leyendo\n› Read')
  expect(vistaDe('opencode', '{"type":"text","part":{"text":"hola"}}')).toBe('hola')
  expect(colaDeLineas('1\n2\n3\n4\n5\n6\n7\n\n')).toEqual(['2', '3', '4', '5', '6', '7'])
  expect(colaDeLineas('x'.repeat(100), 6, 92)).toEqual(['x'.repeat(92), 'x'.repeat(8)])
  const svg = tablero({ titulo: 't', lectura: 'l', resumen: [], secciones: [], terminales: [{ titulo: 'ollama · 3s', lineas: ['hola'] }] })
  expect(svg).toContain('● ollama · 3s')
  expect(svg).toContain('<animate')
})

test('la figura marca quién trabaja y cabe en el límite de Svg con muchas subtareas', async () => {
  const svg = figura({
    bahias: [
      { nombre: 'ollama', tokens: 0, trabajando: false },
      { nombre: 'opencode', tokens: 900, trabajando: true },
      { nombre: 'claude', modelo: 'sonnet', tokens: 50_000, trabajando: false },
    ],
    subtareas: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 'hecha' : i % 3 === 1 ? 'en curso' : 'pendiente')),
    contexto: 40,
    titulo: 'demo <x>',
    lectura: '10/30 hechas',
  })
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('data-flow')
  expect(svg).toContain('data-pulse')
  expect(svg).toContain('DEMO &lt;X&gt;')
  expect(svg.length < 131072).toBe(true)
})

test('los lectores sacan texto y tokens de cada CLI', async () => {
  const usage = '{"type":"result","result":"ok","total_cost_usd":0.01,"usage":{"input_tokens":2,"cache_creation_input_tokens":30,"cache_read_input_tokens":20,"output_tokens":4},"modelUsage":{"claude-haiku-5-5":{"contextWindow":1000000}}}'
  const esperado = { texto: 'ok', tokensIn: 52, tokensOut: 4, ventana: 1000000, costo: 0.01 }
  expect(leerClaude(usage)).toEqual(esperado)
  expect(leerClaude(`{"type":"system"}\n{"type":"assistant","message":{"content":[]}}\n${usage}\n`)).toEqual(esperado)

  const o = leerOllama('hola', '\x1b[?25lprompt eval count:    35 token(s)\nprompt eval rate: 3 tokens/s\neval count:           11 token(s)\n')
  expect(o).toEqual({ texto: 'hola', tokensIn: 35, tokensOut: 11 })
  expect(leerOllama('inteligencias a\x1b[1D\x1b[K\nartificiales', '').texto).toBe('inteligencias a\nartificiales')

  const oc = leerOpencode([
    '{"type":"text","part":{"text":"ok"}}',
    '{"type":"step_finish","part":{"tokens":{"input":100,"output":2,"reasoning":1,"cache":{"write":0,"read":10}},"cost":0}}',
    '{"type":"error","error":{"name":"APIError","data":{"message":"sin cuota"}}}',
  ].join('\n'))
  expect(oc.texto).toBe('ok\n[error] sin cuota')
  expect([oc.tokensIn, oc.tokensOut]).toEqual([110, 3])
})

test('planificar crea subtareas y la auditoría las marca hechas o pendientes y sugiere otro modelo', async ($, on) => {
  base(on)
  procesos(on)
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'demo', subtareas: ['a', 'b'] } })

  const d1 = await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'claude', categoria: 'x', tarea: 'a', subtarea: 1 } })
  const d2 = await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'claude', categoria: 'x', tarea: 'b', subtarea: 2 } })
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: out(d1).id, puntaje: 8 } })
  const r = out(await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: out(d2).id, puntaje: 3 } }))

  expect(r.progreso).toEqual({ hechas: 1, total: 2, faltan: [2], lanzar_ya: [2] })
  expect(r.siguiente.trabajador).toBe('opencode')
})

test('delegar corre el trabajador, registrar guarda el puntaje y ranking lo devuelve', async ($, on) => {
  base(on)
  procesos(on, () => ({ stdout: 'hola desde ollama' }))
  const r = out(await $.tool.call({
    tool: 'mcp__centro-agentes__delegar',
    input: { trabajador: 'ollama', categoria: 'Docs', tarea: 'escribe un docstring' },
  }))
  expect(r.exito).toBe(true)
  expect(r.salida).toContain('hola desde ollama')

  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: r.id, puntaje: 8 } })
  const fila = out(await $.tool.call({ tool: 'mcp__centro-agentes__ranking', input: { categoria: 'docs' } }))[0]
  expect(fila.categoria).toBe('docs')
  expect(fila.trabajadores[0].promedio).toBe(8)
})

test('delegar usa el modelo pedido, rechaza uno no permitido y el ranking separa por modelo', async ($, on) => {
  base(on)
  const argvs: string[][] = []
  procesos(on, argv => {
    argvs.push(argv)
    return { stdout: 'ok' }
  })
  const op = await $.tool.call({
    tool: 'mcp__centro-agentes__delegar',
    input: { trabajador: 'claude', modelo: 'opus', categoria: 'codigo', tarea: 'x' },
  })
  expect(out(op).trabajador).toBe('claude:opus')
  expect(argvs[0]).toContain('opus')
  // La tarea va por stdin, no en la línea de comandos.
  expect(argvs[0]).not.toContain('x')

  const malo = await $.tool.call({
    tool: 'mcp__centro-agentes__delegar',
    input: { trabajador: 'claude', modelo: 'opus --dangerous', categoria: 'codigo', tarea: 'x' },
  })
  expect(out(malo).error).toContain('no permitido')
  expect(argvs.length).toBe(1)

  const so = await $.tool.call({
    tool: 'mcp__centro-agentes__delegar',
    input: { trabajador: 'claude', modelo: 'sonnet', categoria: 'codigo', tarea: 'x' },
  })
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: out(op).id, puntaje: 9 } })
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: out(so).id, puntaje: 5 } })
  const t = out(await $.tool.call({ tool: 'mcp__centro-agentes__ranking', input: { categoria: 'codigo' } }))[0].trabajadores
  expect(t.map((x: any) => x.trabajador)).toEqual(['claude:opus', 'claude:sonnet'])
})

import { agregarRendimiento, informeMarkdown, leerAider, temaNtfyValido } from './extras'
import { grafica } from './figura'
import { estadoAgentes } from './register'

test('aider: lee la respuesta sin ruido y sus tokens, y el centro lo lanza sin git ni preguntas', async ($, on) => {
  const salida = ['Aider v0.86.1', 'Model: ollama_chat/gpt-oss:120b-cloud with whole edit format', 'Git repo: none', '► **THINKING**', 'pienso…', '► **ANSWER**', 'Creé hola.txt', 'Applied edit to hola.txt', 'Tokens: 1.2k sent, 158 received.'].join('\n')
  expect(leerAider(salida)).toEqual({ texto: 'Creé hola.txt\nApplied edit to hola.txt', tokensIn: 1200, tokensOut: 158 })
  expect(leerAider('Tokens: 746 sent, 158 received.').tokensIn).toBe(746)
  base(on)
  const argvs: string[][] = []
  procesos(on, argv => {
    argvs.push(argv)
    return { stdout: salida }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'aider', categoria: 'codigo', tarea: 'crea hola.txt' } }))
  expect(d.exito).toBe(true)
  expect(d.trabajador).toBe('aider:ollama_chat/gpt-oss:120b-cloud')
  expect(argvs[0]).toContain('--no-git')
  expect(argvs[0].slice(1, 5)).toEqual(['--model', 'ollama_chat/gpt-oss:120b-cloud', '--message', 'crea hola.txt\n\nResponde siempre en español.'])
})

test('rendimiento por modelo, informe en Markdown, tema de ntfy y estado de agentes', async () => {
  const r = agregarRendimiento({ codigo: { 'a:x': { n: 2, suma: 16, msTotal: 20_000 } }, texto: { 'a:x': { n: 1, suma: 5, msTotal: 4000 }, 'b:y': { n: 1, suma: 9, msTotal: 1000 } } })
  expect(r).toEqual([{ quien: 'a:x', media: 7, n: 3, segundos: 8 }, { quien: 'b:y', media: 9, n: 1, segundos: 1 }])
  expect(grafica(r)).toContain('Rendimiento por modelo')
  const md = informeMarkdown({
    chat: 'proyecto · chat',
    plan: { objetivo: 'web', subtareas: [{ n: 1, titulo: 'a|b', estado: 'hecha', quien: 'aider:m', puntaje: 8 }] },
    trabajos: [{ id: 't', trabajador: 'aider:m', categoria: 'c', tarea: 'x', estado: 'listo', inicio: 0, ms: 61_000, puntaje: 4, tokensIn: 10, tokensOut: 2 }],
    ahorro: 0.5,
    fecha: 'hoy',
  })
  expect(md).toContain('1 de 1 subtareas hechas')
  expect(md).toContain('| 1 | a\\|b | hecha | aider:m | 8/10 |')
  expect(md).toContain('1 min 1 s')
  expect(md).toContain('Se rehicieron 1 trabajo(s)')
  expect(temaNtfyValido('mst-avisos-x7q2')).toBe(true)
  expect(temaNtfyValido('a b/../x')).toBe(false)
  const estado = estadoAgentes({ ollama: ['m'], opencode: ['m'], hermes: ['m'], aider: ['m', 'n'], claude: ['haiku'] }, Date.now(), 0)
  expect(estado.map(e => e.nombre)).toEqual(['ollama', 'opencode', 'hermes', 'aider', 'claude'])
  expect(estado.find(e => e.nombre === 'aider')).toEqual({ nombre: 'aider', ok: true, nota: '2/2 modelos' })
})

test('la página enseña el estado de los agentes, la Fig 3 y el enlace a todos los chats', async () => {
  const html = pagina('<svg></svg>', '<svg></svg>', 't', 2, { clave: 'k', cancelables: [], relanzables: [], agentes: [{ nombre: 'opencode', ok: false, nota: 'clave caducada · vuelve 10:00' }], rendimiento: '<svg id="fig3"></svg>' })
  expect(html).toContain('href="/todos?t=k"')
  expect(html).toContain('class="agente no"')
  expect(html).toContain('<section class="ancho"><svg id="fig3"></svg></section>')
})

import { leerDependencias, listas } from './extras'

test('dependencias: planificar las guarda, delegar no lanza una bloqueada y la auditoría dice cuáles ya se pueden lanzar', async ($, on) => {
  expect([...leerDependencias('{"3": [1, 2, 3, 9]}', 3)]).toEqual([[3, [1, 2]]])
  base(on)
  procesos(on)
  const p = out(await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'o', subtareas: ['a', 'b', 'c'], dependencias: { 3: [1, 2] } } }))
  expect(p.lanzar_ya).toEqual([1, 2])
  const bloqueada = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'x', tarea: 't', subtarea: 3 } }))
  expect(bloqueada.error).toContain('espera a 1, 2')
  const d1 = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'x', tarea: 't', subtarea: 1 } }))
  const d2 = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'x', tarea: 't', subtarea: 2 } }))
  expect(out(await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: d1.id, puntaje: 8 } })).progreso.lanzar_ya).toEqual([])
  expect(out(await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: d2.id, puntaje: 8 } })).progreso.lanzar_ya).toEqual([3])
  expect(listas([{ n: 1, titulo: 'a', estado: 'hecha' }, { n: 2, titulo: 'b', estado: 'pendiente', espera: [1] }]).map(s => s.n)).toEqual([2])
})

test('aislar crea una copia git para el agente, guarda sus cambios en su rama y verificar ejecuta los tests allí', async ($, on) => {
  base(on)
  const cwds: (string | undefined)[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    cwds.push(e.cwd)
    yield { stream: 'stdout', text: 'hecho' }
    return { value: { code: 0, signal: null } }
  })
  const escritos: string[] = []
  on('fs.write', async (_$: any, e: any) => { escritos.push(e.content ?? e.text ?? e.data ?? JSON.stringify(e)); return { value: undefined } })
  const runs: string[][] = []
  on('process.run', async (_$: any, e: any) => {
    runs.push(e.argv)
    const a = e.argv.join(' ')
    const stdout = a.includes('rev-parse') ? 'C:/repo\n' : a.includes('diff --stat') ? ' a.txt | 1 +' : a.includes('verificar-') ? '3 pass' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'opencode', categoria: 'codigo', tarea: 't', subtarea: 1, cwd: 'C:/repo', aislar: true, verificar: 'npm test' } }))
  expect(runs.some(r => r.includes('worktree') && r.includes('add'))).toBe(true)
  expect(d.copia.rama).toMatch(/^mst\/s1-/)
  expect(cwds.at(-1)).toBe(d.copia.carpeta)
  expect(d.copia.cambios).toContain('a.txt')
  expect(d.copia.juntar).toContain(`merge ${d.copia.rama}`)
  expect(d.verificacion).toMatchObject({ comando: 'npm test', ok: true, salida: '3 pass' })
  expect(d.aviso).toContain('superada')
  expect(escritos.some(t => t.includes('npm test'))).toBe(true)
})

test('delegar_varios lanza sola la subtarea que espera a otra del lote cuando esa termina bien, y no si falla', async ($, on) => {
  base(on)
  const orden: string[] = []
  // La tarea de claude va por stdin: el simulador mira e.input, no argv.
  on('process.spawn', async function* (_$: any, e: any) {
    const t = String(e.input ?? '')
    orden.push(t.includes('segunda') ? 'segunda' : 'primera')
    if (t.includes('rompe')) {
      yield { stream: 'stderr', text: 'boom' }
      return { value: { code: 1, signal: null } }
    }
    yield { stream: 'stdout', text: 'ok' }
    return { value: { code: 0, signal: null } }
  })
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'o', subtareas: ['a', 'b'], dependencias: { 2: [1] } } })
  const r = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar_varios', input: { tareas: [
    { subtarea: 2, categoria: 'x', trabajador: 'claude', tarea: 'segunda' },
    { subtarea: 1, categoria: 'x', trabajador: 'claude', tarea: 'primera' },
  ] } })).resultados
  expect(r.map((x: any) => x.exito)).toEqual([true, true])
  expect(r[0].tras).toEqual([1])
  expect(orden).toEqual(['primera', 'segunda'])

  const mal = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar_varios', input: { tareas: [
    { subtarea: 1, categoria: 'y', trabajador: 'claude', tarea: 'rompe' },
    { subtarea: 2, categoria: 'y', trabajador: 'claude', tarea: 'segunda' },
  ] } })).resultados
  expect(mal[1].error).toContain('No se lanzó')
})

test('cerrar_subtarea marca hecha la subtarea del jefe y desbloquea las siguientes', async ($, on) => {
  base(on)
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'o', subtareas: ['juntar', 'publicar'], dependencias: { 2: [1] } } })
  const r = out(await $.tool.call({ tool: 'mcp__centro-agentes__cerrar_subtarea', input: { subtarea: 1, nota: 'ramas juntas' } }))
  expect(r.progreso).toEqual({ hechas: 1, total: 2, faltan: [2], lanzar_ya: [2] })
  expect(out(await $.tool.call({ tool: 'mcp__centro-agentes__cerrar_subtarea', input: { subtarea: 9 } })).error).toContain('No existe')
})

test('/mst con tarea responde al momento y manda la tarea al jefe sin quedarse esperando', async ($, on) => {
  base(on)
  on('session.usage', async () => ({ value: { context: { percent: 0, tokens: 0, window: 200000 } } }))
  on('fs.write', async () => ({ value: undefined }))
  on('fs.read', async () => ({ value: 'clave' }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  procesos(on)
  // Como en la app: el envío no se resuelve hasta que el comando termina.
  on('prompt.submit', async () => new Promise(() => {}))
  const r = await Promise.race([
    $.command.run({ command: 'mst', args: 'crea hola.py' }),
    new Promise(res => setTimeout(() => res('bloqueado'), 3000)),
  ])
  expect(r).not.toBe('bloqueado')
  expect((r as any).text).toContain('tarea enviada al jefe')
  // Deja terminar lo que /mst lanza en segundo plano (web, servidor) antes de cerrar el test.
  await new Promise(res => setTimeout(res, 500))
})
