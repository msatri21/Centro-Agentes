// Comprueba que los módulos de hooks/ que Node carga DIRECTAMENTE (el servidor MCP de OpenCode como jefe, las terminales del tablero
// y los scripts de mcp/) se pueden importar. El plugin acepta importaciones sin extensión ('./catalogo') y Node no: un `import ... from './x'`
// de valores dentro de estos archivos rompe el servidor MCP y las terminales sin que `claude plugin test` lo note.
// Uso: node mcp/prueba-importaciones.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// register.tsx y vista.ts no se cargan con Node (solo con el plugin); estos sí.
const modulos = ['nucleo', 'extras', 'catalogo', 'tareas', 'consultas', 'cerebro']
let hechas = 0
for (const nombre of modulos) {
  const archivo = path.join(raiz, 'hooks', `${nombre}.ts`)
  if (!fs.existsSync(archivo)) continue
  const m = await import(pathToFileURL(archivo).href)
  assert.ok(Object.keys(m).length > 0, `${nombre}.ts se importó pero no exporta nada`)
  hechas++
  console.log('✓', `hooks/${nombre}.ts se importa con Node`)
  // Un import de valores sin extensión rompería la carga: se comprueba también por texto, para dar un mensaje claro.
  const sinExtension = fs.readFileSync(archivo, 'utf8').split(/\r?\n/).filter(l => /^import\s+(?!type\b).*\sfrom\s+'\.\.?\//.test(l) && !/\.(ts|js|mjs)'/.test(l))
  assert.deepEqual(sinExtension, [], `${nombre}.ts importa valores sin extensión: ${sinExtension.join(' | ')}`)
}
console.log(`\n${hechas} módulos se cargan con Node.`)
