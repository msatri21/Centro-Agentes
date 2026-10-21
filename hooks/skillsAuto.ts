// Qué skill de ponytail le toca a una tarea delegada, decidido por el centro y no por la memoria de Claude:
//   escribir código → ponytail (con el mapa del código) · auditar un cambio → ponytail-review · auditar un repo → ponytail-audit · texto → ninguna.
// El criterio es amplio a propósito: ante la duda se considera código, porque una skill de más estorba menos que una que falta.

export type ClaseTarea = 'escritura' | 'auditoria' | 'auditoria-repo' | 'texto'
export type EntradaTarea = { categoria?: string; tarea?: string; archivos?: string[]; aislar?: boolean; verificar?: string }

// Sin mayúsculas ni tildes, para que "Corrígelo" y "corrigelo" valgan igual.
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Verbos exactos (no raíces): "crea" cuenta, "creación" no, y "revisa el cambio" sigue siendo una revisión.
const VERBOS_ESCRIBIR = /\b(implementa|implementar|implementen|escribe|escribir|crea|crear|creen|agrega|agregar|agreguen|anade|anadir|corrige|corregir|arregla|arreglar|refactoriza|refactorizar|modifica|modificar|cambia|cambiar|programa|programar|desarrolla|desarrollar|construye|construir|elimina|eliminar|borra|borrar|migra|migrar|optimiza|optimizar|renombra|renombrar|mueve|mover|actualiza|actualizar|add|create|fix|implement|write|refactor|change|update|build|remove|rename|migrate)\b/
const VERBOS_AUDITAR = /\b(audit\w*|revis\w*|review\w*|inspeccion\w*|evalu\w*)\b/
const REPO_ENTERO = /(todo el (repo|repositorio|proyecto|codigo)|repositorio (completo|entero)|codebase|base de codigo|auditoria (general|completa)|whole repo|entire repo)/
const CATEGORIA_CODIGO = /(codigo|code|prog|desarroll|bug|fix|refactor|test|prueba|script|api|backend|frontend|css|html|funcion|modulo|componente|feature|implement|compil|lint|sql|migrac|codif|software|app)/
const EXTENSION = /\.(js|jsx|mjs|cjs|ts|tsx|py|go|rs|rb|java|kt|php|swift|cs|c|cpp|h|sh|ps1|sql|html|css|scss|vue|svelte|json|ya?ml|toml)\b/
const PALABRAS_CODIGO = /\b(funcion\w*|clase\w*|metodo\w*|endpoint\w*|componente\w*|modulo\w*|libreria\w*|dependencia\w*|bug\w*|error(es)?|excepcion\w*|refactor\w*|test\w*|pruebas?|compil\w*|lint\w*|commit\w*|rama|git|script\w*|api|query|sql|esquema|migracion\w*|css|html|boton\w*|formulario\w*|pantalla\w*|interfaz|variable\w*|parametro\w*|import\w*|backend|frontend|servicio\w*|pr|pull request|diff|parche\w*|codigo|code|repo|repositorio)\b/
const TRAE_CODIGO = /(`[^`]+`|=>|\(\)|\{\s*\})/

export type Clasificacion = { clase: ClaseTarea; motivos: string[]; pideCambios: boolean }

export function clasificarTarea(e: EntradaTarea): Clasificacion {
  const original = String(e.tarea ?? '')
  const cat = norm(String(e.categoria ?? ''))
  const texto = norm(original)
  const senales: string[] = []
  if (e.archivos?.length) senales.push('declara archivos')
  if (e.aislar) senales.push('copia aislada')
  if (e.verificar?.trim()) senales.push('lleva un comando de verificación')
  if (CATEGORIA_CODIGO.test(cat)) senales.push('categoría de código')
  if (EXTENSION.test(texto)) senales.push('nombra archivos de código')
  if (PALABRAS_CODIGO.test(texto)) senales.push('vocabulario de código')
  if (TRAE_CODIGO.test(original)) senales.push('trae código')

  const audita = VERBOS_AUDITAR.test(cat) || VERBOS_AUDITAR.test(texto)
  const escribe = VERBOS_ESCRIBIR.test(texto)
  // "Revisa y corrige" escribe código: solo es auditoría si no pide cambiar nada.
  // Sin ninguna señal de código, "revisa el informe de ventas" es texto: solo una categoría de auditoría o review lo hace auditoría.
  if (audita && !escribe && (senales.length || /audit|review|calidad/.test(cat)))
    return { clase: REPO_ENTERO.test(`${cat} ${texto}`) || /\brepo\b/.test(cat) ? 'auditoria-repo' : 'auditoria', motivos: ['audita o revisa', ...senales], pideCambios: escribe }
  if (senales.length) return { clase: 'escritura', motivos: senales, pideCambios: escribe }
  return { clase: 'texto', motivos: [], pideCambios: escribe }
}

// Una petición vaga ("agrega la posibilidad de aplicar un cupón") no trae vocabulario de programación, pero si pide cambios y el agente
// va a trabajar en una carpeta con código, es código. Lo sabe quien llama (p. ej. porque el mapa del código no sale vacío).
export function conCarpeta(r: Clasificacion, carpetaConCodigo: boolean): Clasificacion {
  return r.clase === 'texto' && r.pideCambios && carpetaConCodigo ? { ...r, clase: 'escritura', motivos: ['pide cambios en una carpeta con código'] } : r
}

// Las skills que lleva cada clase de tarea (el centro solo añade las que estén instaladas).
export function skillsAutomaticas(clase: ClaseTarea): string[] {
  if (clase === 'escritura') return ['ponytail']
  if (clase === 'auditoria') return ['ponytail-review']
  if (clase === 'auditoria-repo') return ['ponytail-audit']
  return []
}

// Las que, además, llevan el mapa del código de la carpeta de trabajo (ponytail-review no: revisa un cambio concreto).
export const CON_MAPA = ['ponytail', 'ponytail-audit']
