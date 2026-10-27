import { expect, test } from 'claude-code/testing'

import { AMARILLO_MS_POR_DEFECTO, MARGEN_AGENTE_VIVO_MS, agenteVivo, FALLOS_SEGUIDOS_ESCALA, INACTIVIDAD_MIN_POR_DEFECTO, LIMITE_ARCHIVOS_BORRADOS, LIMITE_ARCHIVOS_MODIFICADOS, MAX_PARALELO, REINTENTOS_ARRANQUE, Registro, Semaforo, choques, contarCambios, duracionCorta, esErrorDeArranque, esMasiva, filasVivas, inactivo, resumenEstado, textoAvisoGrupo, textoBarra, textoEstado, type Encargo, type TrabajoVivo } from './asincrono'

test('el semáforo da cuatro huecos, la quinta espera y liberar dos veces no cuela a dos', async () => {
  expect(MAX_PARALELO).toBe(4)
  const s = new Semaforo()
  const libres = await Promise.all([s.tomar(), s.tomar(), s.tomar(), s.tomar()])
  expect(s.enUso).toBe(4)
  expect(s.esperando).toBe(0)

  const quinta = s.tomar()
  expect(s.esperando).toBe(1)
  let entro = false
  void quinta.then(() => { entro = true })
  await Promise.resolve()
  expect(entro).toBe(false)

  libres[0]()
  const soltarQuinta = await quinta
  expect(entro).toBe(true)
  expect(s.enUso).toBe(4)
  expect(s.esperando).toBe(0)

  soltarQuinta()
  soltarQuinta()
  expect(s.enUso).toBe(3)
  for (const libre of libres.slice(1)) libre()
  expect(s.enUso).toBe(0)
})

test('el semáforo respeta el orden FIFO de la cola', async () => {
  const s = new Semaforo(1)
  const primero = await s.tomar()
  const orden: number[] = []
  const pendientes = [1, 2, 3].map(n => s.tomar().then(libre => { orden.push(n); return libre }))
  expect(s.esperando).toBe(3)

  primero()
  const l1 = await pendientes[0]
  l1()
  const l2 = await pendientes[1]
  l2()
  const l3 = await pendientes[2]
  l3()

  expect(orden).toEqual([1, 2, 3])
  expect(s.enUso).toBe(0)
  expect(s.esperando).toBe(0)
})

test('reconoce el fallo de arranque sin distinguir mayúsculas', () => {
  expect(REINTENTOS_ARRANQUE).toBe(2)
  expect(esErrorDeArranque('Standalone server exited before reporting readiness')).toBe(true)
  expect(esErrorDeArranque('STANDALONE SERVER EXITED BEFORE REPORTING READINESS: timeout')).toBe(true)
  expect(esErrorDeArranque('el Standalone server exited before reporting')).toBe(true)
  expect(esErrorDeArranque('Standalone server arrancó bien')).toBe(false)
  expect(esErrorDeArranque('')).toBe(false)
})

test('solo es masiva pasarse estrictamente de los límites, y el motivo dice cuál', () => {
  expect(esMasiva({ modificados: LIMITE_ARCHIVOS_MODIFICADOS, borrados: LIMITE_ARCHIVOS_BORRADOS })).toEqual({ masiva: false })
  expect(esMasiva({ modificados: 16, borrados: 0 })).toMatchObject({ masiva: true })
  expect(esMasiva({ modificados: 16, borrados: 0 }).motivo).toContain('modificados')
  expect(esMasiva({ modificados: 16, borrados: 0 }).motivo).toContain('16')
  expect(esMasiva({ modificados: 0, borrados: 6 })).toMatchObject({ masiva: true })
  expect(esMasiva({ modificados: 0, borrados: 6 }).motivo).toContain('borrados')
  expect(esMasiva({ modificados: 0, borrados: 6 }).motivo).toContain('6')
})

test('inactivo mide desde la última señal y solo pasa del límite', () => {
  expect(INACTIVIDAD_MIN_POR_DEFECTO).toBe(40)
  const t = { inicio: 1000, ultimaActividad: 5000 }
  expect(inactivo(t, 5000 + 40000, 40000)).toBe(false)
  expect(inactivo(t, 5001 + 40000, 40000)).toBe(true)
  expect(inactivo({ inicio: 0 }, 40000, 40000)).toBe(false)
  expect(inactivo({ inicio: 0 }, 40001, 40000)).toBe(true)
})

test('ids correlativos y grupo implícito en el propio id', () => {
  const r = new Registro()
  expect(r.nuevoGrupo()).toBe('g1')
  expect(r.nuevoGrupo()).toBe('g2')
  const e1 = r.nuevoEncargo({}, 100)
  const e2 = r.nuevoEncargo({ grupo: 'g1', subtarea: 2 }, 200)
  expect(e1).toMatchObject({ id: 'e1', grupo: 'e1', estado: 'en_cola', escalados: [], inicio: 100 })
  expect(e2).toMatchObject({ id: 'e2', grupo: 'g1', subtarea: 2, estado: 'en_cola' })
  expect('subtarea' in e1).toBe(false)
  expect(r.obtener('e3')).toBe(undefined)
  expect(r.todos().map(e => e.id)).toEqual(['e1', 'e2'])
})

test('un grupo está completo al acabar el último y solo avisa una vez', () => {
  const r = new Registro()
  const g = r.nuevoGrupo()
  const a = r.nuevoEncargo({ grupo: g, subtarea: 1 }, 0)
  const b = r.nuevoEncargo({ grupo: g, subtarea: 2 }, 0)
  expect(r.grupoCompleto('g9')).toBe(false)
  expect(r.grupoCompleto(g)).toBe(false)
  r.marcar(a.id, 'corriendo', {}, 500)
  expect(r.grupoCompleto(g)).toBe(false)
  expect(r.avisarGrupo(g)).toBe(false)

  r.marcar(a.id, 'terminado', { resultado: 'ok' }, 1000)
  expect(r.grupoCompleto(g)).toBe(false)
  expect(r.avisarGrupo(g)).toBe(false)

  r.marcar(b.id, 'fallido', {}, 2000)
  expect(r.grupoCompleto(g)).toBe(true)
  expect(r.avisarGrupo(g)).toBe(true)
  expect(r.avisarGrupo(g)).toBe(false)
  expect(r.delGrupo(g).map(e => [e.estado, e.fin])).toEqual([['terminado', 1000], ['fallido', 2000]])
})

test('escalar solo la primera vez por encargo y motivo', () => {
  const r = new Registro()
  const e = r.nuevoEncargo({}, 0)
  expect(r.escalar(e.id, 'timeout')).toBe(true)
  expect(r.escalar(e.id, 'timeout')).toBe(false)
  expect(r.escalar(e.id, 'sin cambios')).toBe(true)
  expect(r.escalar('e99', 'timeout')).toBe(false)
  expect(r.obtener(e.id)!.escalados).toEqual(['timeout', 'sin cambios'])
})

test('registrarFin cuenta fallos seguidos por subtarea y el éxito los reinicia', () => {
  const r = new Registro()
  expect(FALLOS_SEGUIDOS_ESCALA).toBe(2)
  expect(r.registrarFin(1, false)).toBe(1)
  expect(r.registrarFin(1, false)).toBe(FALLOS_SEGUIDOS_ESCALA)
  expect(r.registrarFin(2, false)).toBe(1)
  expect(r.registrarFin(1, true)).toBe(0)
  expect(r.registrarFin(1, false)).toBe(1)
  expect(r.registrarFin(undefined, false)).toBe(0)
  expect(r.registrarFin(undefined, true)).toBe(0)
})

test('resumenEstado cuenta segundos hasta el fin o hasta ahora y omite el resultado mientras corre', () => {
  const r = new Registro()
  const g = r.nuevoGrupo()
  const a = r.nuevoEncargo({ grupo: g, subtarea: 1 }, 1000)
  const b = r.nuevoEncargo({ grupo: g }, 1000)
  r.marcar(a.id, 'corriendo', { trabajoId: 't7' }, 2000)

  const [ra, rb] = resumenEstado([a, b], 4400)
  expect(ra).toEqual({ id: 'e1', grupo: 'g1', subtarea: 1, estado: 'corriendo', segundos: 3, trabajoId: 't7' })
  expect('resultado' in ra).toBe(false)
  expect(rb).toEqual({ id: 'e2', grupo: 'g1', estado: 'en_cola', segundos: 3 })

  r.marcar(a.id, 'terminado', { resultado: { ok: 1 } }, 3000)
  const [rt] = resumenEstado([a], 9999)
  expect(rt.segundos).toBe(2)
  expect(rt.resultado).toEqual({ ok: 1 })
})

test('cuenta name-status, incluyendo renombres con espacios y CRLF', () => {
  expect(contarCambios('M\tuno.ts\r\nA\tdos.ts\r\nD\ttres.ts\r\nR100\tviejo nombre.ts\tnuevo nombre.ts\r\nC75\ta b\tc d\r\n\r\n')).toEqual({ archivos: ['uno.ts', 'dos.ts', 'tres.ts', 'nuevo nombre.ts', 'c d'], modificados: 4, borrados: 1 })
  expect(contarCambios('')).toEqual({ archivos: [], modificados: 0, borrados: 0 })
})

test('encuentra choques estables sin distinguir mayúsculas ni separadores', () => {
  expect(choques([{ id: 'a', archivos: ['src\\X.ts', 'a'] }, { id: 'b', archivos: ['SRC/x.TS', 'b'] }, { id: 'c', archivos: ['a', 'src/x.ts'] }])).toEqual([
    { a: 'a', b: 'b', archivos: ['src\\X.ts'] }, { a: 'a', b: 'c', archivos: ['src\\X.ts', 'a'] }, { a: 'b', b: 'c', archivos: ['SRC/x.TS'] },
  ])
  expect(choques([{ id: 'a', archivos: ['x'] }, { id: 'b', archivos: ['y'] }])).toEqual([])
})

test('arma avisos de grupo con y sin escaladas', () => {
  const base = [{ id: 'e1', estado: 'terminado', resultado: { trabajador: 'opencode' } }]
  expect(textoAvisoGrupo('g1', base)).toContain('Terminó el grupo g1 (1 encargo(s)).')
  expect(textoAvisoGrupo('g1', base)).not.toContain('ESCALADA')
  const avisado = textoAvisoGrupo('g2', [
    { id: 'e1', estado: 'fallido', resultado: { trabajador: 'opencode', fuera_de_alcance: ['x'], escalar: ['masiva'], aviso_masiva: '16 archivos modificados', copia: { archivos: ['X'] } } },
    { id: 'e2', estado: 'terminado', resultado: { trabajador: 'codex', copia: { archivos: ['x'] } } },
  ])
  expect(avisado).toContain('Fallaron 1 encargo(s).')
  expect(avisado).toContain('ESCALADA (fuera de alcance): opencode')
  expect(avisado).toContain('ESCALADA (modificación masiva): opencode: 16 archivos modificados')
  expect(avisado).toContain('ESCALADA (choque de ramas): opencode y codex')
})

test('formatea duraciones cortas en los bordes', () => {
  expect(duracionCorta(0)).toBe('0 s')
  expect(duracionCorta(59_000)).toBe('59 s')
  expect(duracionCorta(60_000)).toBe('1 min')
  expect(duracionCorta(59 * 60_000)).toBe('59 min')
  expect(duracionCorta(60 * 60_000)).toBe('1 h 00 min')
  expect(duracionCorta(65 * 60_000)).toBe('1 h 05 min')
  expect(duracionCorta(Number.NaN)).toBe('0 s')
  expect(duracionCorta(-1)).toBe('0 s')
})

test('filas vivas filtra, ordena, mide señal y separa agente del modelo', () => {
  const trabajos: TrabajoVivo[] = [
    { id: 't2', trabajador: 'ollama:gpt-oss:20b-cloud', estado: 'corriendo', inicio: 200, ultimaActividad: 1000 },
    { id: 't1', trabajador: 'opencode:opencode/big-pickle', estado: 'corriendo', inicio: 100 },
    { id: 't3', trabajador: 'otro:model', estado: 'terminado', inicio: 0 },
  ]
  const filas = filasVivas(trabajos, 600_101)
  expect(filas.map(f => f.id)).toEqual(['t1', 't2'])
  expect(filas[0]).toMatchObject({ agente: 'opencode', modelo: 'big-pickle', sinSenalMs: AMARILLO_MS_POR_DEFECTO + 1, amarillo: true })
  expect(filas[1]).toMatchObject({ agente: 'ollama', modelo: 'gpt-oss:20b-cloud', sinSenalMs: 599_101, amarillo: false })
  expect(filasVivas([{ id: 'x', trabajador: 'a:m', estado: 'corriendo', inicio: 0 }], AMARILLO_MS_POR_DEFECTO)[0].amarillo).toBe(false)
})

test('texto de barra resume cola, grupos, paralelismo e inactividad', () => {
  const e = (id: string, grupo: string, estado: Encargo['estado']): Encargo => ({ id, grupo, estado, escalados: [], inicio: 0 })
  expect(textoBarra([], [], 0)).toBe('')
  const vivos: TrabajoVivo[] = [1, 2, 3].map(n => ({ id: `t${n}`, trabajador: `a${n}:m`, estado: 'corriendo', inicio: 0 }))
  expect(textoBarra(vivos, [], 1)).toBe('⚙ 3 trabajando')
  expect(textoBarra([], [e('q', 'q', 'en_cola')], 1)).toBe('⚙ en espera · 1 en cola')
  expect(textoBarra([], [e('a', 'g1', 'terminado'), e('b', 'g1', 'corriendo'), e('c', 'g2', 'en_cola'), e('d', 'g3', 'corriendo')], 1)).toContain('g1: 1/2 listos · g2: 0/1 listos · +1 grupos')
  expect(textoBarra([], [e('e3', 'e3', 'en_cola')], 1)).toBe('⚙ en espera · 1 en cola')
  expect(textoBarra([{ id: 't', trabajador: 'a:m', estado: 'corriendo', inicio: 0 }], [], AMARILLO_MS_POR_DEFECTO + 1)).toBe('⚠ 1 trabajando · ⚠ 1 sin señal')
})

test('textoEstado incluye el resumen y cada detalle; también expresa inactividad total', () => {
  const encargo = (id: string, grupo: string, estado: Encargo['estado']): Encargo => ({ id, grupo, estado, escalados: [], inicio: 0 })
  const texto = textoEstado([
    { id: 't', trabajador: 'opencode:vendor/modelo-x', estado: 'corriendo', inicio: 0, ultimaActividad: 0, subtarea: 7 },
  ], [encargo('e1', 'g1', 'terminado'), encargo('e2', 'g1', 'corriendo'), encargo('q', 'q', 'en_cola')], AMARILLO_MS_POR_DEFECTO + 1)
  expect(texto).toBe([
    'Centro de agentes: ⚠ 1 trabajando · 1 en cola · g1: 1/2 listos · ⚠ 1 sin señal',
    '● opencode · modelo-x · subtarea 7 · lleva 10 min · última señal hace 10 min ⚠ sin señal desde hace tiempo',
    'En cola: 1 (esperando hueco: máximo 4 agentes a la vez)',
    'Grupo g1: 1/2 listos',
    'Aviso: 1 agente(s) llevan más de 10 min sin dar señales; a los 40 min el jefe recibe una escalada.',
  ].join('\n'))
  expect(textoEstado([], [], 0)).toBe('Centro de agentes: nada trabajando')
})

test('el registro se guarda y se recupera tras una recarga: ids, grupos, avisos dados y fallos', () => {
  const a = new Registro()
  const g = a.nuevoGrupo()
  const e1 = a.nuevoEncargo({ grupo: g, subtarea: 3 }, 1000)
  const e2 = a.nuevoEncargo({ grupo: g }, 1000)
  a.marcar(e1.id, 'terminado', { trabajoId: 't1', resultado: { id: 't1' } }, 2000)
  a.marcar(e2.id, 'corriendo', {}, 1500)
  a.registrarFin(3, false)

  const b = new Registro()
  b.importar(JSON.parse(JSON.stringify(a.exportar())))
  expect(b.todos().map(e => [e.id, e.estado, e.trabajoId])).toEqual([['e1', 'terminado', 't1'], ['e2', 'corriendo', undefined]])
  // Los contadores siguen: ni el próximo encargo ni el próximo grupo repiten ids.
  expect(b.nuevoEncargo({}, 3000).id).toBe('e3')
  expect(b.nuevoGrupo()).toBe('g2')
  // El segundo fallo seguido de la subtarea 3 sigue contando desde el primero.
  expect(b.registrarFin(3, false)).toBe(2)
  // Un grupo ya avisado no se vuelve a avisar tras recargar.
  b.marcar('e2', 'terminado', {}, 4000)
  expect(b.avisarGrupo(g)).toBe(true)
  const c = new Registro()
  c.importar(JSON.parse(JSON.stringify(b.exportar())))
  expect(c.avisarGrupo(g)).toBe(false)
  // Sin datos guardados no cambia nada.
  c.importar(undefined)
  expect(c.todos()).toHaveLength(3)
})

test('un agente cuenta como vivo con pid.json sin fin.json y reciente; un pid viejo o con fin no frena nada', () => {
  const ahora = 10_000_000
  expect(agenteVivo({ inicio: ahora - 60_000 }, false, ahora)).toBe(true)
  expect(agenteVivo({ inicio: ahora - 60_000 }, true, ahora)).toBe(false)
  expect(agenteVivo({ inicio: ahora - MARGEN_AGENTE_VIVO_MS - 1 }, false, ahora)).toBe(false)
  expect(agenteVivo(undefined, false, ahora)).toBe(false)
  expect(agenteVivo({}, false, ahora)).toBe(false)
})
