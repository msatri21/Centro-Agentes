import { aplicar, archivoNuevo, normalizar, resumen } from './tareas'

// Conserva el archivo entre llamadas para probar el mismo protocolo que usa el proceso real.
export function scriptFalso(on: any, opciones: { falla?: any; codigo?: number; agente?: (e: any, archivo: any) => { texto?: string; codigo?: number } } = {}) {
  let archivo: any
  let lanzamientos = 0
  on('process.spawn', async function* (_$: any, e: any) {
    lanzamientos++
    const orden = e.argv[2]
    let r: any
    if (opciones.falla && orden === 'aplicar') r = opciones.falla
    else if (opciones.codigo && orden === 'aplicar') r = { ok: false, codigo: 'script', mensaje: `código ${opciones.codigo}` }
    else if (orden === 'aplicar') {
      const n = normalizar(archivo ?? archivoNuevo(e.argv[4], '2026-01-01'), '2026-01-01')
      r = aplicar(n.archivo, JSON.parse(e.input), '2026-01-01')
      if (r.ok) {
        archivo = r.archivo
        if (r.cambios[0]?.startsWith('crea')) r = { ...r, creado: true, gitignore: { accion: 'sin_git' } }
      }
    } else if (orden === 'leer') r = archivo ? { existe: true, archivo: normalizar(archivo, '2026-01-01').archivo, avisos: [] } : { existe: false, archivo: archivoNuevo(e.argv[4], '2026-01-01'), avisos: [] }
    else if (orden === 'resumen') r = archivo ? { existe: true, ...resumen(normalizar(archivo, '2026-01-01').archivo), avisos: [] } : { existe: false }
    else {
      const agente = opciones.agente?.(e, archivo) ?? {}
      yield { stream: 'stdout', text: agente.texto ?? '{"type":"text","part":{"text":"hecho"}}' }
      return { value: { code: agente.codigo ?? 0, signal: null } }
    }
    yield { stream: 'stdout', text: `${JSON.stringify(r)}\n` }
    return { value: { code: opciones.codigo && orden === 'aplicar' ? 1 : 0, signal: null } }
  })
  return {
    get archivo() { return archivo },
    set archivo(v: any) { archivo = v },
    get lanzamientos() { return lanzamientos },
  }
}
