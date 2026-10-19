// Simulación en bucle del centro trabajando: un chat inventado ("demo-bucle") que repite una historia completa
// (plan, reparto, un fallo con relevo, notas, una subtarea rehecha y "Todo listo") para ver cómo se comporta el grafo.
// No lanza ningún agente ni gasta nada. Uso: node mcp/demo-bucle.mjs   (Ctrl+C para parar)
// La página sale en la web de siempre: http://127.0.0.1:47321/?t=<clave>&s=demo-bucle
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { paginaCentro } from '../hooks/vista.ts'

const CASA = path.join(os.homedir(), '.centro-agentes')
const ID = 'demo-bucle'
const DIR = path.join(CASA, 'chats', ID)
const clave = (() => {
  try {
    return fs.readFileSync(path.join(CASA, 'clave.txt'), 'utf8').trim()
  } catch {
    return ''
  }
})()
const CICLO = 56 // segundos que dura la historia antes de repetirse
const PASO_MS = 1500

const MODELOS = {
  opencode: ['ollama/gpt-oss:120b-cloud'], ollama: ['gpt-oss:120b-cloud'], hermes: ['ollama-local/gpt-oss:120b-cloud'],
  aider: ['ollama_chat/gemma4:31b-cloud'], codex: ['chatgpt', 'ollama/gpt-oss:120b-cloud'], claude: ['haiku'],
}
const AGENTES = [
  { nombre: 'opencode', ok: true, nota: '5 modelos' }, { nombre: 'ollama', ok: true, nota: '6 modelos' }, { nombre: 'hermes', ok: true, nota: '4 modelos' },
  { nombre: 'aider', ok: true, nota: '3 modelos' }, { nombre: 'codex', ok: false, nota: 'sin sesión · usa Ollama' }, { nombre: 'claude', ok: true, nota: '3 modelos' },
]
const SUBS = [
  { n: 1, titulo: 'Función cubo en productos.py' }, { n: 2, titulo: 'Resumen del README' }, { n: 3, titulo: 'Tests de la calculadora' },
  { n: 4, titulo: 'Función raíz con validación' }, { n: 5, titulo: 'Revisar y entregar', espera: [1, 2, 3, 4] },
]
// Trabajos de la historia: cuándo empiezan y terminan (en segundos de la historia), y la nota que recibe cada uno.
const HISTORIA = [
  { id: 'a', quien: 'opencode:ollama/gpt-oss:120b-cloud', sub: 1, ini: 6, fin: 17, nota: [21, 9], ti: 24000, to: 300, lineas: ['› editando productos.py', '› python test_calc.py', 'ok: 4 pass'] },
  { id: 'b', quien: 'ollama:gpt-oss:120b-cloud', sub: 2, ini: 6, fin: 10, error: true, ti: 100, to: 0, lineas: ['escribiendo…', '✗ 429: sin cupo'] },
  { id: 'e', quien: 'hermes:ollama-local/beam:cloud', sub: 2, ini: 11, fin: 24, nota: [28, 8], ti: 52000, to: 900, lineas: ['› relevo: subtarea 2', '› leyendo README.md', 'ok'] },
  { id: 'c', quien: 'aider:ollama_chat/gemma4:31b-cloud', sub: 3, ini: 6, fin: 19, nota: [23, 9], ti: 800, to: 90, lineas: ['› test_calc.py', 'Applied edit to test_calc.py', 'Tokens: 1.2k sent'] },
  { id: 'd', quien: 'aider:ollama_chat/gemma4:31b-cloud', sub: 4, ini: 20, fin: 27, nota: [30, 4], ti: 900, to: 80, lineas: ['› productos.py', 'Applied edit'] },
  { id: 'f', quien: 'opencode:ollama/gpt-oss:120b-cloud', sub: 4, ini: 34, fin: 42, nota: [46, 9], ti: 31000, to: 410, lineas: ['› rehaciendo raiz()', '› python test_calc.py', 'ok: 6 pass'] },
]
const CIERRE = 50 // el jefe cierra la subtarea 5

function estadoEn(t) {
  const ahora = Date.now()
  const base = ahora - t * 1000
  const trabajos = HISTORIA.filter(h => t >= h.ini).map(h => {
    const terminado = t >= h.fin
    const puntaje = h.nota && t >= h.nota[0] ? h.nota[1] : undefined
    const l = h.lineas
    const visibles = terminado ? l : l.slice(0, 1 + Math.min(l.length - 1, Math.floor((t - h.ini) / 3)))
    return {
      id: h.id, trabajador: h.quien, categoria: 'demo', tarea: SUBS[h.sub - 1].titulo, estado: terminado ? (h.error ? 'error' : 'listo') : 'corriendo',
      inicio: base + h.ini * 1000, ms: terminado ? (h.fin - h.ini) * 1000 : undefined, subtarea: h.sub, puntaje,
      tokensIn: terminado ? h.ti : undefined, tokensOut: terminado ? h.to : undefined, salida: visibles.join('\n'),
    }
  })
  const subtareas = SUBS.map(s => {
    const suyos = trabajos.filter(w => w.subtarea === s.n)
    const bueno = suyos.find(w => w.puntaje !== undefined && w.puntaje >= 6)
    const estado = s.n === 5 ? (t >= CIERRE ? 'hecha' : 'pendiente') : bueno ? 'hecha' : suyos.some(w => w.estado === 'corriendo') ? 'en curso' : 'pendiente'
    const ultimo = suyos[suyos.length - 1]
    return { ...s, estado, quien: s.n === 5 && estado === 'hecha' ? 'jefe' : bueno?.trabajador ?? ultimo?.trabajador, puntaje: bueno?.puntaje }
  })
  return { ahora, trabajos, plan: t >= 2 ? { objetivo: 'Calculadora completa hecha por varios agentes (demo)', subtareas } : null }
}

function escribir(t) {
  const { ahora, trabajos, plan } = estadoEn(t)
  const ahorro = trabajos.reduce((s, w) => s + ((w.tokensIn ?? 0) * 2 + (w.tokensOut ?? 0) * 10) / 1_000_000, 0)
  const corriendo = trabajos.filter(w => w.estado === 'corriendo')
  const html = paginaCentro({
    clave, chat: 'demo-bucle · simulación', jefe: 'Claude', plan, trabajos, agentes: AGENTES, modelos: MODELOS,
    rendimiento: [{ quien: 'opencode:gpt-oss:120b', media: 9, n: 14, segundos: 11 }, { quien: 'hermes:gpt-oss:120b', media: 8.5, n: 9, segundos: 38 }, { quien: 'aider:gemma4:31b', media: 6.5, n: 6, segundos: 14 }, { quien: 'ollama:gpt-oss:120b', media: 7, n: 4, segundos: 3 }],
    ahorro: ahorro + 1.8,
    cancelables: corriendo.map(w => ({ id: w.id, titulo: `${w.trabajador.split(':')[0]} · ${w.tarea.slice(0, 28)}` })), relanzables: [], version: 'demo', ahora,
  })
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(path.join(DIR, 'centro.html'), html)
  // El índice "todos los chats" lee esto para mostrar el progreso.
  fs.writeFileSync(path.join(DIR, 'estado.json'), JSON.stringify({ plan, trabajos, encargos: [], nombre: 'demo-bucle' }))
}

const inicio = Date.now()
console.log(`demo-bucle en marcha: http://127.0.0.1:47321/?t=${clave}&s=${ID}`)
setInterval(() => escribir(((Date.now() - inicio) / 1000) % CICLO), PASO_MS)
escribir(0)
