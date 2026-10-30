import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { construir, huellaDeModelos, caducado, modeloOllamaDe, leerOllamaShow } from '../hooks/catalogo.ts'

export const ARCHIVO = 'catalogo.json'
export const MODELS_DEV = 'https://models.dev/api.json'

export function rutaCatalogo(casa = os.homedir()) {
  return path.join(casa, '.centro-agentes', ARCHIVO)
}

export function leerCatalogo(casa = os.homedir()) {
  try {
    const valor = JSON.parse(fs.readFileSync(rutaCatalogo(casa), 'utf8'))
    return valor?.version === 2 ? valor : undefined
  } catch { return undefined }
}

function ejecutarReal(comando, args, { timeoutMs }) {
  return new Promise(resolve => execFile(comando, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10_000_000 }, (error, stdout, stderr) => {
    resolve({ codigo: error ? (Number.isInteger(error.code) ? error.code : null) : 0, stdout: stdout ?? '', stderr: stderr || error?.message || '' })
  }))
}

async function descargarReal(url, { timeoutMs, maxBytes }) {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`)
  const lector = respuesta.body?.getReader()
  if (!lector) throw new Error('respuesta sin contenido')
  const partes = []
  let total = 0
  while (true) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await lector.cancel(); throw new Error(`respuesta supera ${maxBytes} bytes`) }
    partes.push(Buffer.from(value))
  }
  return Buffer.concat(partes).toString('utf8')
}

const agentes = ['ollama', 'opencode', 'hermes', 'aider', 'codex', 'claude']
const fechaDe = ahora => new Date(ahora).toISOString().slice(0, 10)
async function concurrencia(items, limite, fn) {
  let siguiente = 0
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (siguiente < items.length) await fn(items[siguiente++])
  }))
}

async function guardar(casa, catalogo) {
  const destino = rutaCatalogo(casa), temporal = `${destino}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`
  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(temporal, `${JSON.stringify(catalogo, null, 2)}\n`)
    // El temporal único evita que sesiones concurrentes publiquen contenido parcial o se pisen.
    for (let intento = 0; ; intento++) {
      try { fs.renameSync(temporal, destino); return undefined } catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || intento >= 9) throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
  } catch (error) {
    return `No se pudo guardar el catálogo: ${error.message}`
  } finally {
    try { fs.unlinkSync(temporal) } catch (error) { if (error.code !== 'ENOENT') {} }
  }
}

export async function actualizar({ casa = os.homedir(), modelos, enLinea = true, forzar = false, ahora = Date.now(), ejecutar = ejecutarReal, descargar = descargarReal } = {}) {
  try {
    const completos = Object.fromEntries(agentes.map(a => [a, Array.isArray(modelos?.[a]) ? modelos[a] : []]))
    const huella = huellaDeModelos(completos), existente = leerCatalogo(casa)
    const fallo = existente?.fuentes?.some(f => !f.ok) === true
    const edad = existente ? ahora - Date.parse(existente.generado) : Infinity
    if (!forzar && existente && !caducado(existente, ahora, huella) && (!fallo || edad < 60 * 60 * 1000)) return { catalogo: existente, actualizado: false, motivo: 'vigente' }
    let motivo = 'nuevo'
    if (forzar) motivo = 'forzado'
    else if (existente && existente.huella !== huella) motivo = 'otros modelos'
    else if (existente && fallo) motivo = 'reintento'
    else if (existente) motivo = 'caducado'

    const fuentes = [], ollama = {}, modelosOllama = [...new Set(agentes.flatMap(a => completos[a].map(m => modeloOllamaDe(a, m)).filter(x => x !== undefined)))]
    if (modelosOllama.length) {
      let fallidos = 0, razon = ''
      await concurrencia(modelosOllama, 4, async nombre => {
        try {
          const resultado = await ejecutar('ollama', ['show', nombre], { timeoutMs: 40000 })
          if (resultado.codigo !== 0) { fallidos++; razon ||= resultado.stderr || `código ${resultado.codigo ?? 'desconocido'}`; return }
          ollama[nombre] = leerOllamaShow(resultado.stdout)
        } catch (error) { fallidos++; razon ||= error?.message ?? String(error) }
      })
      // La fuente solo cuenta como fallida si NO se pudo leer ninguno (Ollama apagado o sin instalar): eso se reintenta pronto.
      // Un modelo suelto que no existe en este equipo (p. ej. un respaldo local sin descargar) queda como nota y no obliga a rehacerlo todo cada hora.
      fuentes.push({ nombre: 'ollama', ok: fallidos < modelosOllama.length, fecha: fechaDe(ahora), ...(fallidos ? { nota: `${fallidos} modelo(s) fallaron: ${razon}` } : {}) })
    }

    let modelsDev
    if (completos.opencode.length) {
      let falloRed
      if (enLinea) {
        try {
          const json = JSON.parse(await descargar(MODELS_DEV, { timeoutMs: 60000, maxBytes: 30_000_000 }))
          if (!json?.opencode?.models || typeof json.opencode.models !== 'object' || Array.isArray(json.opencode.models)) throw new Error('no existe opencode.models')
          modelsDev = json
          fuentes.push({ nombre: 'models.dev', ok: true, fecha: fechaDe(ahora) })
        } catch (error) { falloRed = error?.message ?? String(error) }
      }
      if (!modelsDev) {
        let cache
        try {
          const json = JSON.parse(fs.readFileSync(path.join(casa, '.cache', 'opencode', 'models.json'), 'utf8'))
          if (json?.opencode?.models && typeof json.opencode.models === 'object' && !Array.isArray(json.opencode.models)) cache = json
        } catch {}
        if (cache) {
          // La caché conserva capacidad útil sin red, pero su antigüedad se señala al consumidor.
          modelsDev = cache
          fuentes.push({ nombre: 'models.dev', ok: !enLinea, fecha: fechaDe(ahora), nota: `usada la caché local de OpenCode (puede estar desactualizada)${falloRed ? `; falló la consulta en línea: ${falloRed}` : ''}` })
        } else fuentes.push({ nombre: 'models.dev', ok: false, fecha: fechaDe(ahora), nota: falloRed ? `no se obtuvo models.dev ni caché local: ${falloRed}` : 'no se obtuvo models.dev ni caché local' })
      }
    }
    const catalogo = construir(completos, { ollama, modelsDev }, ahora, fuentes)
    const problemaEscritura = await guardar(casa, catalogo)
    return { catalogo, actualizado: true, motivo: problemaEscritura ? `${motivo}; ${problemaEscritura}` : motivo }
  } catch (error) {
    const fechaSegura = Number.isFinite(ahora) ? ahora : Date.now()
    const catalogo = construir(Object.fromEntries(agentes.map(a => [a, Array.isArray(modelos?.[a]) ? modelos[a] : []])), {}, fechaSegura, [])
    return { catalogo, actualizado: true, motivo: `No se pudo actualizar el catálogo: ${error?.message ?? String(error)}` }
  }
}

async function main(argv) {
  const [orden, ...args] = argv
  const opcion = nombre => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined }
  const casa = opcion('--casa') ? path.resolve(opcion('--casa')) : os.homedir()
  if (orden === 'leer') return leerCatalogo(casa) ?? { existe: false }
  if (orden !== 'actualizar') throw new Error('Uso: node mcp/catalogo.mjs actualizar [--forzar] [--sin-linea] [--casa <carpeta>] | leer [--casa <carpeta>]')
  const entrada = JSON.parse(fs.readFileSync(0, 'utf8'))
  // Acepta el objeto de modelos directo ({ ollama: [...], ... }) o envuelto en { modelos: ... }.
  const resultado = await actualizar({ casa, modelos: entrada?.modelos ?? entrada ?? {}, forzar: args.includes('--forzar'), enLinea: !args.includes('--sin-linea') })
  return { ok: true, actualizado: resultado.actualizado, motivo: resultado.motivo, modelos: resultado.catalogo.modelos.length, fuentes: resultado.catalogo.fuentes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r)), error => {
    console.log(JSON.stringify({ ok: false, mensaje: error?.message ?? String(error) }))
    process.exitCode = 1
  })
}
