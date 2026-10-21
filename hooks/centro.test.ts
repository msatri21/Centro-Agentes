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
  expect(quienes[0]).toBe('opencode:opencode/deepseek-v4.1-flash-free')
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

test('opencode: la tarea va por stdin completa, con sus saltos de línea, y no en la línea de comandos', async ($, on) => {
  base(on)
  const vistos: { argv: string[]; input?: string; env?: Record<string, string> }[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    vistos.push({ argv: e.argv, input: e.input, env: e.env })
    yield { stream: 'stdout', text: '{"type":"text","part":{"text":"hecho"}}' }
    return { value: { code: 0, signal: null } }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'opencode', categoria: 'codigo', tarea: 'línea uno\nlínea dos' } }))
  expect(d.exito).toBe(true)
  expect(vistos[0].argv[0]).toBe('opencode')
  expect(vistos[0].argv.some(a => a.includes('línea'))).toBe(false)
  expect(vistos[0].input).toContain('línea uno\nlínea dos')
  // Y el agente sabe quién es (para sus herramientas preguntar y pedir_permiso) y cuándo usarlas.
  expect(vistos[0].input).toContain('pedir_permiso')
  expect(vistos[0].env?.CENTRO_TRABAJADOR).toBe('1')
  expect(vistos[0].env?.CENTRO_TRABAJO).toBe(d.id)
  expect(vistos[0].env?.CENTRO_CHAT_DIR).toContain('/chats/')
  expect(vistos[0].env?.CENTRO_ESPERA_MS).toBe('900000')
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
  const estado = estadoAgentes({ ollama: ['m'], opencode: ['m'], hermes: ['m'], aider: ['m', 'n'], codex: ['chatgpt'], claude: ['haiku'] }, Date.now(), 0)
  expect(estado.map(e => e.nombre)).toEqual(['ollama', 'opencode', 'hermes', 'aider', 'codex', 'claude'])
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

import { leerCodex } from './register'

test('codex: lee su respuesta y tokens, y se lanza con su cuenta o con Ollama, con la tarea por stdin', async ($, on) => {
  const salida = [
    '{"type":"thread.started","thread_id":"x"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata not found"}}',
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"ls"}}',
    '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Añadí saluda()"}}',
    '{"type":"turn.completed","usage":{"input_tokens":2000,"cached_input_tokens":1500,"output_tokens":80}}',
  ].join('\n')
  expect(leerCodex(salida)).toEqual({ texto: 'Añadí saluda()', tokensIn: 2000, tokensOut: 80 })
  expect(leerCodex('{"type":"error","message":"Not logged in"}').texto).toBe('[error] Not logged in')
  base(on)
  const vistos: { argv: string[]; input?: string }[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    vistos.push({ argv: e.argv, input: e.input })
    yield { stream: 'stdout', text: salida }
    return { value: { code: 0, signal: null } }
  })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'codex', categoria: 'codigo', tarea: 'crea hola.py' } }))
  expect(d.exito).toBe(true)
  expect(d.trabajador).toBe('codex:chatgpt')
  expect(vistos[0].argv.slice(0, 6)).toEqual(['codex', 'exec', '--json', '--sandbox', 'danger-full-access', '--skip-git-repo-check'])
  // Codex recibe su propio servidor MCP por la línea de comandos, con la identidad reenviada y un tiempo de espera largo.
  const lineaCodex = vistos[0].argv.join(' ')
  expect(lineaCodex).toContain('mcp_servers.centro.command="node"')
  expect(lineaCodex).toContain('centro-mcp.mjs')
  expect(lineaCodex).toContain('env_vars=["CENTRO_TRABAJADOR","CENTRO_CHAT_DIR","CENTRO_TRABAJO","CENTRO_ESPERA_MS"]')
  expect(lineaCodex).toContain('tool_timeout_sec=1200')
  expect(vistos[0].input).toContain('pedir_permiso')
  expect(vistos[0].input).toContain('crea hola.py')
  const o = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'codex', modelo: 'ollama/gpt-oss:120b-cloud', categoria: 'codigo', tarea: 'x' } }))
  expect(o.trabajador).toBe('codex:ollama/gpt-oss:120b-cloud')
  expect(vistos[1].argv.slice(-5)).toEqual(['--oss', '--local-provider', 'ollama', '-m', 'gpt-oss:120b-cloud'])
})

import { Cerrojos, archivosCambiados, chocan, fueraDeAlcance } from './nucleo'

test('cerrojos: lo que no choca entra a la vez, lo que choca espera su turno y "todo el repo" espera a todos', async () => {
  expect(chocan('src/', 'src/a.py')).toBe(true)
  expect(chocan('A.py', 'B.py')).toBe(false)
  expect(chocan('*', 'x.py')).toBe(true)
  expect(chocan('src\\a.py', './src/a.py')).toBe(true)
  const c = new Cerrojos()
  const orden: string[] = []
  const a = await c.tomar('/r', ['A.py'])
  const b = await c.tomar('/r', ['B.py'])
  orden.push('A y B dentro')
  const a2 = c.tomar('/r', ['A.py']).then(l => (orden.push('A2'), l))
  const todo = c.tomar('/r').then(l => (orden.push('todo'), l))
  const otraCarpeta = await c.tomar('/otra')
  otraCarpeta()
  await new Promise(r => setTimeout(r, 20))
  expect(orden).toEqual(['A y B dentro'])
  a()
  ;(await a2)()
  b()
  ;(await todo)()
  expect(orden).toEqual(['A y B dentro', 'A2', 'todo'])
})

test('lee los archivos cambiados de git y detecta lo que un agente tocó sin ser suyo', async () => {
  expect(archivosCambiados(' M A.py\n?? nuevo.py\nR  viejo.py -> n.py\n M "con espacio.py"\n')).toEqual(['A.py', 'nuevo.py', 'n.py', 'con espacio.py'])
  expect(fueraDeAlcance(['x.py'], ['x.py', 'A.py', 'z.py', 'o.py'], ['A.py'], ['o.py'])).toEqual(['z.py'])
  expect(fueraDeAlcance([], ['z.py'], ['*'], [])).toEqual([])
})

test('dos agentes en la misma carpeta: sin archivos se turnan; con archivos distintos trabajan a la vez', async ($, on) => {
  base(on)
  let activos = 0
  let maximo = 0
  on('process.spawn', async function* (_$: any) {
    activos++
    maximo = Math.max(maximo, activos)
    await new Promise(r => setTimeout(r, 120))
    activos--
    yield { stream: 'stdout', text: 'ok' }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  const lanzar = (archivos?: string[][]) =>
    $.tool.call({
      tool: 'mcp__centro-agentes__delegar_varios',
      input: { tareas: [0, 1].map(i => ({ categoria: 'x', trabajador: 'claude', tarea: `t${i}`, cwd: 'C:/proyecto', ...(archivos ? { archivos: archivos[i] } : {}) })) },
    })
  const turno = out(await lanzar())
  expect(maximo).toBe(1)
  expect(turno.resultados.some((r: any) => r.carpeta_compartida?.esperoSeg !== undefined || r.carpeta_compartida)).toBe(true)
  maximo = 0
  await lanzar([['A.py'], ['B.py']])
  expect(maximo).toBe(2)
  maximo = 0
  await lanzar([['A.py'], ['A.py']])
  expect(maximo).toBe(1)
})

test('cerrojos: los archivos de otro agente cuentan como suyos aunque ya haya terminado cuando miro (sin falsos avisos)', async () => {
  const c = new Cerrojos()
  const a = await c.tomar('/r', ['A.py'])
  const b = await c.tomar('/r', ['B.py'])
  a()
  expect(c.deOtros('/r', b.id, b.desde)).toEqual(['A.py'])
  const tarde = await c.tomar('/r', ['C.py'])
  b()
  tarde()
  expect(c.deOtros('/r', b.id, b.desde)).toEqual(['A.py', 'C.py'])
  expect(c.deOtros('/otra', b.id, b.desde)).toEqual([])
})

import { estadoAgente, eventosEntre, faseDe, resumenDe, tarjetasDe, gruposDe, faseDeGrupo, rejilla, colocarGrupos, FASES_PLAN } from '../web/grafo-logica.js'
import { graficaAhorro, graficaNotas, graficaTiempo, graficaTokens } from './graficas'
import { paginaCentro } from './vista'

const trab = (id: string, quien: string, sub: number, estado: string, extra: object = {}) => ({ id, trabajador: quien, categoria: 'c', tarea: 'x', estado, inicio: 1000, subtarea: sub, ...extra }) as any

test('la fase del grafo sale del plan y de los trabajos: reposo, plan, reparto, trabajo, fallo, verificar, juntar y listo', () => {
  const subs = (...e: string[]) => ({ subtareas: e.map((estado, i) => ({ n: i + 1, titulo: 't', estado })) })
  expect(faseDe({ plan: null, trabajos: [], ahora: 5000 }).indice).toBe(-1)
  expect(faseDe({ plan: subs('pendiente', 'pendiente'), trabajos: [], ahora: 5000 }).indice).toBe(1)
  expect(faseDe({ plan: subs('en curso', 'en curso'), trabajos: [trab('a', 'opencode:m', 1, 'corriendo'), trab('b', 'hermes:m', 2, 'corriendo')], ahora: 2000 }).indice).toBe(2)
  expect(faseDe({ plan: subs('en curso', 'en curso'), trabajos: [trab('a', 'opencode:m', 1, 'corriendo'), trab('b', 'hermes:m', 2, 'corriendo')], ahora: 30_000 }).indice).toBe(3)
  const fallo = [trab('e', 'ollama:m', 2, 'error', { ms: 2000 }), trab('f', 'hermes:m', 2, 'corriendo', { inicio: 4000 })]
  expect(faseDe({ plan: subs('en curso', 'en curso'), trabajos: fallo, ahora: 8000 }).indice).toBe(4)
  expect(faseDe({ plan: subs('en curso'), trabajos: [trab('a', 'opencode:m', 1, 'listo', { ms: 5000 })], ahora: 60_000 }).indice).toBe(5)
  expect(faseDe({ plan: subs('hecha', 'pendiente'), trabajos: [trab('a', 'opencode:m', 1, 'listo', { ms: 5000, puntaje: 9 })], ahora: 60_000 }).indice).toBe(6)
  expect(faseDe({ plan: subs('hecha', 'hecha'), trabajos: [], ahora: 60_000 }).indice).toBe(7)
})

test('los eventos del grafo salen de comparar dos lecturas: encargo, cambio de modelo, resultado, nota y cierre; sin lectura previa, ninguno', () => {
  const antes: any = { plan: { subtareas: [{ n: 1, titulo: 't', estado: 'en curso' }, { n: 2, titulo: 't', estado: 'pendiente' }] }, trabajos: [trab('a', 'opencode:m', 1, 'corriendo'), trab('e', 'ollama:m', 2, 'corriendo')] }
  const despues: any = {
    plan: { subtareas: [{ n: 1, titulo: 't', estado: 'hecha', quien: 'jefe' }, { n: 2, titulo: 't', estado: 'en curso' }] },
    trabajos: [trab('a', 'opencode:m', 1, 'listo', { ms: 5000, puntaje: 9 }), trab('e', 'ollama:m', 2, 'error', { ms: 1000 }), trab('f', 'hermes:m', 2, 'corriendo', { inicio: 3000 })],
  }
  expect(eventosEntre(null, despues)).toEqual([])
  const tipos = eventosEntre(antes, despues).map(e => `${e.tipo}:${e.agente ?? e.subtarea}`)
  expect(tipos).toContain('resultado:opencode')
  expect(tipos).toContain('nota:opencode')
  expect(tipos).toContain('resultado:ollama')
  expect(tipos).toContain('encargo:hermes')
  expect(tipos).toContain('cambio:hermes')
  expect(tipos).toContain('cierre:1')
  const e = estadoAgente({ ...despues, ahora: 2000, agentes: [{ nombre: 'codex', ok: false, nota: 'sin sesión' }] }, 'ollama')
  expect(e).toMatchObject({ activo: false, falla: true })
  expect(estadoAgente({ ...despues, ahora: 2000, agentes: [{ nombre: 'codex', ok: false, nota: 'sin sesión' }] }, 'codex').apartado).toBe('sin sesión')
})

test('las gráficas nuevas dibujan con datos y se quedan en blanco con mensaje sin ellos, y la página junta todo sin dejar cerrar el script', () => {
  const trabajos = [
    trab('a', 'opencode:m', 1, 'listo', { ms: 9000, puntaje: 9, tokensIn: 2000, tokensOut: 100 }),
    trab('b', 'ollama:m', 2, 'error', { inicio: 2000, ms: 3000, tokensIn: 50, tokensOut: 0 }),
    trab('c', 'hermes:m', 2, 'listo', { inicio: 5000, ms: 7000, puntaje: 4, tokensIn: 9000, tokensOut: 400 }),
  ]
  for (const svg of [graficaTokens(trabajos), graficaTiempo(trabajos, 20_000), graficaNotas(trabajos), graficaAhorro(trabajos)]) expect(svg).toContain('<svg')
  expect(graficaNotas(trabajos)).toContain('mínimo para pasar')
  expect(graficaTokens([])).toContain('aún no hay')
  const html = paginaCentro({
    clave: 'k', chat: 'c', jefe: 'OpenCode', plan: { objetivo: '</script><b>x', subtareas: [{ n: 1, titulo: 't', estado: 'hecha' }] }, trabajos, agentes: [], modelos: {}, rendimiento: [], ahorro: 0.1,
    cancelables: [{ id: 'a', titulo: 'x' }], relanzables: [], version: '1', extra: '<svg id="extra"></svg>', ahora: 20_000,
  })
  expect(html).toContain('id="grafo-montaje"')
  expect(html).toContain('<svg id="extra"></svg>')
  expect(html).toContain('/grafo.js')
  expect(html).toContain('Cancelar x')
  expect(html).not.toContain('</script><b>x')
  expect(html.match(/<\/script>/g)?.length).toBe(2)
})

test('las cards: una por trabajo, en orden cronológico, y el modelo con : y / separado bien del agente', () => {
  const d: any = {
    ahora: 30_000,
    plan: { subtareas: [{ n: 1, titulo: 'primera', estado: 'en curso' }, { n: 2, titulo: 'segunda', estado: 'pendiente' }] },
    trabajos: [
      trab('b', 'opencode:qwen3:8b/instruct', 2, 'corriendo', { inicio: 5000 }),
      trab('a', 'ollama:llama3', 1, 'corriendo', { inicio: 1000 }),
    ],
  }
  const tarjetas = tarjetasDe(d)
  expect(tarjetas.map(t => t.id)).toEqual(['a', 'b'])
  expect(tarjetas[0]).toMatchObject({ id: 'a', agente: 'ollama', modelo: 'llama3', subtarea: 1, titulo: 'primera', estado: 'corriendo', alarma: '', segundos: 29, skills: false })
  expect(tarjetas[1]).toMatchObject({ id: 'b', agente: 'opencode', modelo: 'qwen3:8b/instruct', subtarea: 2, titulo: 'segunda', segundos: 25 })
  const fin: any = { ahora: 30_000, plan: { subtareas: [] }, trabajos: [trab('c', 'hermes:m', 9, 'listo', { inicio: 1000, ms: 6500, salida: 'uno\n\ndos   \ntres\ncuatro', skills: ['x'], tokensIn: 10, tokensOut: 5, puntaje: 8 })] }
  const c = tarjetasDe(fin)[0]
  expect(c.segundos).toBe(7)
  expect(c.lineas).toEqual(['dos', 'tres', 'cuatro'])
  expect(c.skills).toBe(true)
  expect(c.tokensIn).toBe(10)
  expect(c.tokensOut).toBe(5)
  expect(c.puntaje).toBe(8)
  expect(c.titulo).toBe('')
})

test('las cards: de los trabajos terminados solo salen los 20 más recientes, y los que están corriendo siempre entran', () => {
  const terminados = Array.from({ length: 30 }, (_, i) => trab(`t${i}`, 'ollama:m', 1, 'listo', { inicio: i * 1000, ms: 500 }))
  const d: any = { ahora: 60_000_000, trabajos: [...terminados, trab('viva', 'hermes:m', 2, 'corriendo', { inicio: 50_000_000 })] }
  const tarjetas = tarjetasDe(d)
  expect(tarjetas.length).toBe(21)
  expect(tarjetas.filter(t => t.estado === 'corriendo').map(t => t.id)).toEqual(['viva'])
  const ids = tarjetas.filter(t => t.estado === 'listo').map(t => t.id)
  expect(ids.length).toBe(20)
  expect(ids).toContain('t10')
  expect(ids).toContain('t29')
  expect(ids).not.toContain('t9')
  expect(tarjetas.map(t => t.id)).toEqual([...ids, 'viva'])
})

test('las cards: alarma de silencio pasado el umbral y sin alarma si el trabajo acaba de hablar', () => {
  const callado: any = { ahora: 120_000, esperaSilencioMs: 60_000, trabajos: [trab('a', 'opencode:m', 1, 'corriendo', { inicio: 1000, ultimaActividad: 1000 })] }
  expect(tarjetasDe(callado)[0].alarma).toBe('silencio')
  // Y cuenta cuánto lleva callado (no cuánto lleva trabajando): 119 s desde su última actividad, y 0 si ya terminó.
  expect(tarjetasDe(callado)[0].callado).toBe(119)
  expect(tarjetasDe({ ahora: 120_000, trabajos: [trab('a', 'opencode:m', 1, 'listo', { inicio: 1000, ms: 900 })] } as any)[0].callado).toBe(0)
  const fresco: any = { ahora: 120_000, esperaSilencioMs: 60_000, trabajos: [trab('a', 'opencode:m', 1, 'corriendo', { inicio: 1000, ultimaActividad: 100_000 })] }
  expect(tarjetasDe(fresco)[0].alarma).toBe('')
  const porDefecto: any = { ahora: 120_000, trabajos: [trab('a', 'opencode:m', 1, 'corriendo', { inicio: 1000 })] }
  expect(tarjetasDe(porDefecto)[0].alarma).toBe('silencio')
  const terminado: any = { ahora: 120_000, esperaSilencioMs: 60_000, trabajos: [trab('a', 'opencode:m', 1, 'listo', { inicio: 1000, ms: 900 })] }
  expect(tarjetasDe(terminado)[0].alarma).toBe('')
})

test('las cards: la pregunta o el permiso pendientes ponen su alarma, y mandan sobre el silencio', () => {
  const d: any = {
    ahora: 100_000,
    pendientes: [{ id: 'a', tipo: 'pregunta', texto: '¿sigo?' }, { id: 'b', tipo: 'permiso', texto: '¿puedo tocar esto?' }],
    trabajos: [
      trab('a', 'opencode:m', 1, 'corriendo', { inicio: 1000, ultimaActividad: 1000 }),
      trab('b', 'ollama:m', 2, 'corriendo', { inicio: 1000, ultimaActividad: 1000 }),
      trab('c', 'hermes:m', 3, 'listo', { inicio: 1000, ms: 900 }),
    ],
  }
  const tarjetas = tarjetasDe(d)
  expect(tarjetas.find(t => t.id === 'a')?.alarma).toBe('pregunta')
  expect(tarjetas.find(t => t.id === 'b')?.alarma).toBe('permiso')
  expect(tarjetas.find(t => t.id === 'c')?.alarma).toBe('')
})

test('las cards: el resumen cuenta activos, alarmas, el reparto por agente y los ids con alarma', () => {
  const tarjetas: any = [
    { id: 'a', agente: 'opencode', estado: 'corriendo', alarma: 'pregunta' },
    { id: 'b', agente: 'opencode', estado: 'corriendo', alarma: '' },
    { id: 'c', agente: 'ollama', estado: 'corriendo', alarma: 'silencio' },
    { id: 'd', agente: 'hermes', estado: 'listo', alarma: '' },
  ]
  const r = resumenDe(tarjetas)
  expect(r.activos).toBe(3)
  expect(r.alarmas).toBe(2)
  expect(r.porAgente).toEqual({ opencode: 2, ollama: 1 })
  expect(r.conAlarma).toEqual(['a', 'c'])
  expect(resumenDe([])).toEqual({ activos: 0, alarmas: 0, porAgente: {}, conAlarma: [] })
})

import { CATEGORIAS, ESPERA_RESPUESTA_MS, PROTOCOLO_AGENTE, abiertas, leerLineas, permitidaSiempre, respuestaDe, resultadoParaAgente, type Consulta } from './consultas'

test('consultas: leerLineas se queda solo con las líneas que son un objeto JSON', () => {
  const jsonl = [JSON.stringify({ id: 'a' }), '', '   ', 'esto no es json', '[1, 2]', '"texto"', JSON.stringify({ id: 'b' })].join('\n')
  expect(leerLineas<{ id: string }>(jsonl).map(o => o.id)).toEqual(['a', 'b'])
  expect(leerLineas(jsonl).length).toBe(2)
  expect(leerLineas('').length).toBe(0)
})

test('consultas: abiertas solo devuelve lo que no tiene respuesta, ordenado, y quita el permiso ya concedido', () => {
  const consultas = [
    { id: 'p1', trabajo: 't1', tipo: 'permiso', texto: '¿borro todo?', categoria: 'destructivo', en: 1000 },
    { id: 'p2', trabajo: 't2', tipo: 'permiso', texto: '¿instalo el paquete?', categoria: 'instalar', en: 2000 },
    { id: 'q1', trabajo: 't3', tipo: 'pregunta', texto: '¿sigo?', en: 3000 },
    { id: 'q2', trabajo: 't4', tipo: 'pregunta', texto: '¿qué uso?', categoria: 'instalar', en: 4000 },
    { id: 'p3', trabajo: 't5', tipo: 'permiso', texto: '¿copio el archivo?', categoria: 'instalar', en: 5000 },
    { id: 'p1', trabajo: 't6', tipo: 'pregunta', texto: 'repetida', en: 6000 },
  ].map(o => JSON.stringify(o)).join('\n')
  const respuestas = [
    JSON.stringify({ id: 'q1', decision: 'texto', texto: 'sí', en: 3100 }),
    JSON.stringify({ id: 'p3', decision: 'aprobar', en: 5100 }),
  ].join('\n')

  // q1 y p3 ya tienen respuesta; p2 está permitido; p1 (destructivo) y q2 (pregunta) se quedan.
  const pend = abiertas(consultas, respuestas, '["instalar"]')
  expect(pend.map(c => c.id)).toEqual(['p1', 'q2'])
  expect(pend[0].texto).toBe('¿borro todo?')
  expect(pend.map(c => c.en)).toEqual([1000, 4000])
  // Sin el archivo de permisos, el permiso de instalar vuelve a preguntar.
  expect(abiertas(consultas, respuestas).map(c => c.id)).toEqual(['p1', 'p2', 'q2'])
  // Lo destructivo no se concede nunca, aunque el usuario lo haya puesto.
  expect(abiertas(consultas, respuestas, '["instalar","destructivo"]').map(c => c.id)).toEqual(['p1', 'q2'])
})

test('consultas: gana la primera respuesta y los permisos solo valen con un array JSON', () => {
  const respuestas = [
    JSON.stringify({ id: 'x', decision: 'texto', texto: 'primera', en: 1 }),
    JSON.stringify({ id: 'x', decision: 'aprobar', en: 2 }),
  ].join('\n')
  expect(respuestaDe(respuestas, 'x')?.texto).toBe('primera')
  expect(respuestaDe(respuestas, 'y')).toBe(undefined)
  expect(permitidaSiempre('["instalar","red"]', 'instalar')).toBe(true)
  expect(permitidaSiempre('["instalar"]', 'red')).toBe(false)
  expect(permitidaSiempre('{roto', 'instalar')).toBe(false)
  expect(permitidaSiempre('', 'instalar')).toBe(false)
  expect(permitidaSiempre('[]', 'instalar')).toBe(false)
  expect(permitidaSiempre('{"a":1}', 'instalar')).toBe(false)
  expect(permitidaSiempre('["instalar"]', undefined)).toBe(false)
  expect(permitidaSiempre('["destructivo"]', 'destructivo')).toBe(false)
})

test('consultas: lo que se le devuelve al agente según lo que respondió el usuario', () => {
  const permiso: Consulta = { id: 'p', trabajo: 't', tipo: 'permiso', texto: '¿borro?', categoria: 'destructivo', en: 1 }
  const pregunta: Consulta = { id: 'q', trabajo: 't', tipo: 'pregunta', texto: '¿sigo?', en: 1 }
  expect(resultadoParaAgente(permiso, { id: 'p', decision: 'aprobar', en: 2 }, false)).toBe('APROBADO por el usuario. Puedes continuar.')
  expect(resultadoParaAgente(permiso, { id: 'p', decision: 'siempre', en: 2 }, false)).toBe('APROBADO por el usuario. Puedes continuar.')
  expect(resultadoParaAgente(permiso, { id: 'p', decision: 'denegar', en: 2 }, false)).toBe('DENEGADO por el usuario. No lo hagas: busca otra forma o termina explicando qué quedó sin hacer.')
  expect(resultadoParaAgente(permiso, { id: 'p', decision: 'denegar', texto: 'es importante', en: 2 }, false)).toBe('DENEGADO por el usuario. No lo hagas: busca otra forma o termina explicando qué quedó sin hacer.\nMotivo del usuario: es importante')
  expect(resultadoParaAgente(pregunta, { id: 'q', decision: 'texto', texto: 'usa la otra ruta', en: 2 }, false)).toBe('RESPUESTA DEL USUARIO: usa la otra ruta')
  expect(resultadoParaAgente(pregunta, { id: 'q', decision: 'aprobar', en: 2 }, false)).toBe('RESPUESTA DEL USUARIO: sí.')
  expect(resultadoParaAgente(pregunta, { id: 'q', decision: 'denegar', en: 2 }, false)).toBe('RESPUESTA DEL USUARIO: no.')
  expect(resultadoParaAgente(permiso, undefined, true)).toBe('SIN RESPUESTA a tiempo: se da por DENEGADO. No lo hagas: sigue por lo más seguro o termina explicando qué quedó sin hacer.')
  expect(resultadoParaAgente(pregunta, undefined, true)).toBe('SIN RESPUESTA a tiempo. Sigue por lo más seguro, anota tu suposición en tu resultado final y continúa.')
  expect(resultadoParaAgente(pregunta, undefined, false)).toBe('Esperando respuesta del usuario.')
})

test('consultas: el protocolo del agente explica las herramientas y las categorías', () => {
  expect(PROTOCOLO_AGENTE).toContain('preguntar')
  expect(PROTOCOLO_AGENTE).toContain('pedir_permiso')
  for (const c of CATEGORIAS) expect(PROTOCOLO_AGENTE).toContain(c)
  expect(CATEGORIAS).toEqual(['comando', 'instalar', 'red', 'escribir-fuera', 'destructivo', 'otro'])
  expect(ESPERA_RESPUESTA_MS).toBe(900_000)
  expect(PROTOCOLO_AGENTE.includes('\n')).toBe(false)
})

// ===== NUEVO: tests para grafo-logica.js (gruposDe, faseDeGrupo, rejilla, colocarGrupos) =====

const trabN = (id: string, quien: string, sub: number, estado: string, extra: object = {}) => ({
  id,
  trabajador: quien,
  categoria: 'c',
  tarea: 'x',
  estado,
  inicio: 1000,
  subtarea: sub,
  ...extra,
}) as any

test('gruposDe: un grupo por plan; los trabajos con plan van a su grupo y los que no lo traen al actual; plan anterior con mismo objetivo no se duplica; anteriores sin trabajos corriendo atenuados, actual siempre activo; orden: actual, activos, atenuados por ultima; tarjetas con alarma', () => {
  const ahora = 100_000
  const d = {
    ahora,
    plan: { objetivo: 'Objetivo A', subtareas: [{ n: 1, titulo: 't1', estado: 'en curso' }, { n: 2, titulo: 't2', estado: 'pendiente' }] },
    planes: [
      { objetivo: 'Objetivo B', subtareas: [{ n: 1, titulo: 't1', estado: 'hecha' }] },
      { objetivo: 'Objetivo A', subtareas: [{ n: 1, titulo: 't1', estado: 'pendiente' }] }, // mismo objetivo que actual -> no duplica
    ],
    trabajos: [
      trabN('t1', 'opencode:m', 1, 'corriendo', { inicio: 90_000, ultimaActividad: 10_000, plan: 'Objetivo A' }), // callado hace 90 s
      trabN('t2', 'ollama:m', 2, 'listo', { inicio: 80_000, ms: 5000, plan: 'Objetivo A', puntaje: 8 }),
      trabN('t3', 'hermes:m', 1, 'listo', { inicio: 70_000, ms: 3000, plan: 'Objetivo B' }),
      trabN('t4', 'aider:m', 3, 'corriendo', { inicio: 60_000, plan: 'Objetivo C' }), // plan nuevo solo en trabajo
      trabN('t5', 'claude:m', 1, 'listo', { inicio: 50_000, ms: 2000 }), // sin plan -> va al actual
    ],
    esperaSilencioMs: 60_000,
    pendientes: [],
  }

  const grupos = gruposDe(d)

  // 3 grupos: Objetivo A (actual), Objetivo B (anterior con trabajo), Objetivo C (solo en trabajo)
  expect(grupos.length).toBe(3)

  // Grupo 0: actual
  const gA = grupos[0]
  expect(gA.id).toBe('Objetivo A')
  expect(gA.actual).toBe(true)
  expect(gA.activo).toBe(true)
  expect(gA.subtareas.length).toBe(2)
  expect(gA.trabajos.length).toBe(3) // t1, t2, t5
  expect(gA.tarjetas.length).toBe(3)
  expect(gA.hechas).toBe(0)
  expect(gA.total).toBe(2)
  expect(gA.corriendo).toBe(1)
  expect(gA.fase.nombre).toBe('En proceso') // hay corriendo > 6s

  // Grupo 1: Objetivo B (tiene trabajo listo, no corriendo -> atenuado)
  const gB = grupos.find(g => g.id === 'Objetivo B')!
  expect(gB.id).toBe('Objetivo B')
  expect(gB.actual).toBe(false)
  expect(gB.activo).toBe(false)
  expect(gB.trabajos.length).toBe(1)
  expect(gB.hechas).toBe(1)
  expect(gB.total).toBe(1)

  // Grupo 2: Objetivo C (tiene trabajo corriendo -> activo)
  const gC = grupos.find(g => g.id === 'Objetivo C')!
  expect(gC.id).toBe('Objetivo C')
  expect(gC.actual).toBe(false)
  expect(gC.activo).toBe(true)
  expect(gC.trabajos.length).toBe(1)
  expect(gC.subtareas.length).toBe(0) // no se conocen subtareas

  // Orden: actual (A), luego activos (C), luego atenuados (B) por ultima desc
  expect(grupos.map(g => g.id)).toEqual(['Objetivo A', 'Objetivo C', 'Objetivo B'])

  // Cada grupo trae tarjetas con alarma
  expect(gA.tarjetas.some(c => c.alarma)).toBe(true) // t1 corriendo con silencio
  expect(gB.tarjetas.every(c => !c.alarma)).toBe(true) // terminados sin alarma
})

test('gruposDe: sin plan actual, trabajos sin plan van a grupo (sin plan)', () => {
  const ahora = 100_000
  const d = {
    ahora,
    plan: null,
    planes: [],
    trabajos: [
      trabN('t1', 'opencode:m', 1, 'corriendo', { inicio: 90_000 }),
      trabN('t2', 'ollama:m', 1, 'listo', { inicio: 80_000, ms: 5000, puntaje: 7 }),
    ],
    esperaSilencioMs: 60_000,
    pendientes: [],
  }

  const grupos = gruposDe(d)
  expect(grupos.length).toBe(1)
  expect(grupos[0].id).toBe('(sin plan)')
  expect(grupos[0].actual).toBe(false)
  expect(grupos[0].activo).toBe(true) // tiene trabajo corriendo
  expect(grupos[0].trabajos.length).toBe(2)
})

test('faseDeGrupo: los 7 casos y progreso hechas/total', () => {
  const ahora = 100_000
  const baseGrupo = (subtareas, trabajos) => ({
    subtareas,
    trabajos,
    hechas: subtareas.filter(s => s.estado === 'hecha').length,
    total: subtareas.length,
  })

  // 1. Planeación: sin trabajos
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'pendiente' }], []), ahora)).toEqual({ indice: 0, nombre: 'Planeación' })

  // 2. Reparto: un trabajo corriendo recién lanzado (< 6s, ninguno terminado)
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'en curso' }], [trabN('t1', 'opencode:m', 1, 'corriendo', { inicio: 99_000 })]), ahora)).toEqual({ indice: 1, nombre: 'Reparto' })

  // 3. En proceso: trabajo corriendo desde hace 20s
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'en curso' }], [trabN('t1', 'opencode:m', 1, 'corriendo', { inicio: 80_000 })]), ahora)).toEqual({ indice: 2, nombre: 'En proceso' })

  // 4. Verificación: todos listos sin nota
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'en curso' }], [trabN('t1', 'opencode:m', 1, 'listo', { inicio: 80_000, ms: 5000 })]), ahora)).toEqual({ indice: 3, nombre: 'Verificación' })

  // 5. Auditoría: mezcla listos con y sin nota
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'en curso' }, { n: 2, estado: 'en curso' }], [
    trabN('t1', 'opencode:m', 1, 'listo', { inicio: 80_000, ms: 5000, puntaje: 8 }),
    trabN('t2', 'ollama:m', 2, 'listo', { inicio: 85_000, ms: 3000 }),
  ]), ahora)).toEqual({ indice: 4, nombre: 'Auditoría' })

  // 6. Juntar: solo quedan subtareas sin trabajos (nadie las delegó)
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'hecha' }, { n: 2, estado: 'pendiente' }], [
    trabN('t1', 'opencode:m', 1, 'listo', { inicio: 80_000, ms: 5000, puntaje: 8 }),
  ]), ahora)).toEqual({ indice: 5, nombre: 'Juntar' })

  // 7. En proceso: subtarea con trabajos no está hecha (falló o sacó poca nota)
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'hecha' }, { n: 2, estado: 'en curso' }], [
    trabN('t1', 'opencode:m', 1, 'listo', { inicio: 80_000, ms: 5000, puntaje: 8 }),
    trabN('t2', 'ollama:m', 2, 'listo', { inicio: 85_000, ms: 3000, puntaje: 3 }),
  ]), ahora)).toEqual({ indice: 2, nombre: 'En proceso' })

  // 8. Informe: todas hechas
  expect(faseDeGrupo(baseGrupo([{ n: 1, estado: 'hecha' }, { n: 2, estado: 'hecha' }], [
    trabN('t1', 'opencode:m', 1, 'listo', { inicio: 80_000, ms: 5000, puntaje: 8 }),
    trabN('t2', 'ollama:m', 2, 'listo', { inicio: 85_000, ms: 3000, puntaje: 9 }),
  ]), ahora)).toEqual({ indice: 6, nombre: 'Informe' })

  // Progreso
  const g = baseGrupo([{ n: 1, estado: 'hecha' }, { n: 2, estado: 'pendiente' }, { n: 3, estado: 'en curso' }], [])
  expect(faseDeGrupo(g, ahora).indice).toBe(0) // Planeación (sin trabajos)
  expect(g.hechas).toBe(1)
  expect(g.total).toBe(3)
})

test('rejilla: 1 item, 2 items en 2 columnas, 5 items en 3 columnas con alturas distintas, vacía; sin solapes', () => {
  // 1 item
  const r1 = rejilla([{ w: 100, h: 50 }])
  expect(r1.posiciones.length).toBe(1)
  expect(r1.posiciones[0]).toEqual({ x: 16, y: 72 }) // margen + cabecera + margen
  expect(r1.w).toBeGreaterThanOrEqual(240) // anchoMinimo
  expect(r1.h).toBe(56 + 16 + 50 + 16)

  // 2 items en 2 columnas
  const r2 = rejilla([{ w: 100, h: 50 }, { w: 120, h: 60 }], { columnas: 2, cabecera: 0, margen: 10, hueco: 10 })
  expect(r2.posiciones.length).toBe(2)
  expect(r2.posiciones[0]).toEqual({ x: 10, y: 10 })
  expect(r2.posiciones[1]).toEqual({ x: 120, y: 10 }) // 10 + 100 + 10
  // Sin solape
  expect(r2.posiciones[0].x + 100).toBeLessThanOrEqual(r2.posiciones[1].x)

  // 5 items en 3 columnas con alturas distintas
  const items = [
    { w: 100, h: 50 },
    { w: 80, h: 70 },
    { w: 120, h: 40 },
    { w: 90, h: 60 },
    { w: 110, h: 55 },
  ]
  const r3 = rejilla(items, { columnas: 3, cabecera: 0, margen: 10, hueco: 10 })
  expect(r3.posiciones.length).toBe(5)
  // Filas: 0,1,2 en fila 0; 3,4 en fila 1
  // Altura fila 0 = max(50, 70, 40) = 70
  // Altura fila 1 = max(60, 55) = 60
  expect(r3.posiciones[0]).toEqual({ x: 10, y: 10 })
  expect(r3.posiciones[1]).toEqual({ x: 120, y: 10 }) // 10 + 100 + 10
  expect(r3.posiciones[2]).toEqual({ x: 240, y: 10 }) // 120 + 110 (la columna 2 mide lo que su caja mayor, 110) + 10
  expect(r3.posiciones[3]).toEqual({ x: 10, y: 90 }) // 10 + 70 + 10
  expect(r3.posiciones[4]).toEqual({ x: 120, y: 90 })

  // Vacía
  const r0 = rejilla([])
  expect(r0.posiciones).toEqual([])
  expect(r0.w).toBe(240)
  expect(r0.h).toBe(56 + 16)
})

test('colocarGrupos: con 1, 2, 3 y 6 grupos no se solapan, ninguno toca el círculo de Claude, ninguno en sector norte, activo más cerca que atenuado, determinista', () => {
  const radio = 110
  const margenCaja = 60

  // Helper para verificar
  const verificar = (grupos) => {
    const res = colocarGrupos(grupos, { radio })
    const { posiciones, caja } = res

    // Mismo número de posiciones
    expect(posiciones.length).toBe(grupos.length)

    // Determinista: segunda llamada igual
    const res2 = colocarGrupos(grupos, { radio })
    expect(res2.posiciones.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) }))).toEqual(
      posiciones.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) }))
    )

    // Caja contiene el círculo de Claude
    expect(caja.x0).toBeLessThanOrEqual(-radio - margenCaja)
    expect(caja.y0).toBeLessThanOrEqual(-radio - margenCaja)
    expect(caja.x1).toBeGreaterThanOrEqual(radio + margenCaja)
    expect(caja.y1).toBeGreaterThanOrEqual(radio + margenCaja)

    // Ningún grupo toca el círculo (distancia del rectángulo al centro > radio)
    for (const p of posiciones) {
      const g = grupos.find(x => x.id === p.id)
      const w = g.w, h = g.h
      // Distancia del rectángulo al origen
      const dx = Math.max(Math.abs(p.x) - w / 2, 0)
      const dy = Math.max(Math.abs(p.y) - h / 2, 0)
      const distRect = Math.sqrt(dx * dx + dy * dy)
      expect(distRect).toBeGreaterThan(radio)

      // No en sector norte (±40° alrededor de -90° = 270°)
      const ang = Math.atan2(p.y, p.x) * 180 / Math.PI
      const diffNorte = Math.abs((ang + 90 + 180) % 360 - 180)
      expect(diffNorte).toBeGreaterThanOrEqual(40)
    }

    // Sin solapes entre grupos (con separación 24)
    for (let i = 0; i < posiciones.length; i++) {
      for (let j = i + 1; j < posiciones.length; j++) {
        const a = posiciones[i], b = posiciones[j]
        const ga = grupos.find(x => x.id === a.id)
        const gb = grupos.find(x => x.id === b.id)
        const ax0 = a.x - ga.w / 2 - 24, ay0 = a.y - ga.h / 2 - 24
        const ax1 = a.x + ga.w / 2 + 24, ay1 = a.y + ga.h / 2 + 24
        const bx0 = b.x - gb.w / 2 - 24, by0 = b.y - gb.h / 2 - 24
        const bx1 = b.x + gb.w / 2 + 24, by1 = b.y + gb.h / 2 + 24
        expect(ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0).toBe(false)
      }
    }

    return res
  }

  // 1 grupo
  verificar([{ id: 'A', w: 200, h: 150, activo: true }])

  // 2 grupos
  verificar([
    { id: 'A', w: 200, h: 150, activo: true },
    { id: 'B', w: 180, h: 140, activo: false },
  ])

  // 3 grupos
  verificar([
    { id: 'A', w: 200, h: 150, activo: true },
    { id: 'B', w: 180, h: 140, activo: true },
    { id: 'C', w: 160, h: 130, activo: false },
  ])

  // 6 grupos de distintos tamaños
  verificar([
    { id: 'A', w: 200, h: 150, activo: true },
    { id: 'B', w: 180, h: 140, activo: true },
    { id: 'C', w: 220, h: 160, activo: true },
    { id: 'D', w: 150, h: 120, activo: false },
    { id: 'E', w: 170, h: 130, activo: false },
    { id: 'F', w: 190, h: 145, activo: false },
  ])

  // Activo más cerca que atenuado (comparar distancias al centro)
  const resMixto = verificar([
    { id: 'Activo1', w: 200, h: 150, activo: true },
    { id: 'Activo2', w: 200, h: 150, activo: true },
    { id: 'Atenuado1', w: 200, h: 150, activo: false },
    { id: 'Atenuado2', w: 200, h: 150, activo: false },
  ])
  const distActivos = resMixto.posiciones.filter(p => p.id.startsWith('Activo')).map(p => Math.sqrt(p.x * p.x + p.y * p.y))
  const distAtenuados = resMixto.posiciones.filter(p => p.id.startsWith('Atenuado')).map(p => Math.sqrt(p.x * p.x + p.y * p.y))
  expect(Math.min(...distActivos)).toBeLessThan(Math.max(...distAtenuados))
})
