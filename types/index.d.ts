export type Trabajador = 'ollama' | 'opencode' | 'hermes' | 'aider' | 'codex' | 'claude'

export type Trabajo = {
  id: string
  /** trabajador:modelo, o solo trabajador si usa el modelo por defecto */
  trabajador: string
  categoria: string
  tarea: string
  /** La instrucción completa que recibió el agente (hasta 1500 caracteres), para el detalle del tablero */
  instruccion?: string
  estado: 'corriendo' | 'listo' | 'error'
  /** Date.now() al arrancar, para mostrar cuánto lleva */
  inicio: number
  subtarea?: number
  ms?: number
  puntaje?: number
  /** Tokens que leyó el trabajador (contexto consumido) y que escribió */
  tokensIn?: number
  tokensOut?: number
  /** Ventana de contexto del modelo, si el CLI la informa */
  ventana?: number
  costo?: number
  /** Lo último que escribió el agente (en vivo mientras corre), para su terminal en el panel */
  salida?: string
  /** Skills que siguió el agente en este trabajo */
  skills?: string[]
  /** Cómo clasificó el centro la tarea y qué skills le añadió solo (para estudiar los falsos positivos) */
  clasificacion?: { clase: string; motivos: string[]; anadidas: string[]; apagada?: boolean }
  /** Última vez que llegó texto del agente (ms epoch) */
  ultimaActividad?: number
  /** Objetivo del plan al que pertenece este trabajo (agrupa los nodos del grafo) */
  plan?: string
  /** Dónde dejó el lanzador su log y su fin.json (carpeta e id de archivo), para reencontrar al agente tras una recarga */
  lanzador?: { carpeta: string; id: string; cwd?: string }
  /** Id del encargo asíncrono (eN) al que sirve este trabajo */
  encargo?: string
}

export type Subtarea = {
  n: number
  id?: string
  titulo: string
  estado: 'pendiente' | 'en_proceso' | 'realizado' | 'solucionado'
  /** Números de las subtareas que tienen que estar hechas antes de lanzar esta */
  espera?: number[]
  /** trabajador:modelo que la tiene o la hizo */
  quien?: string
  puntaje?: number
  manual?: boolean
}

export type Plan = { objetivo: string; tarea?: string; raiz?: string; subtareas: Subtarea[] }

declare module 'claude-code' {
  interface PluginState {
    'centro-agentes': {
      trabajos: Trabajo[]
      plan: Plan | null
      /** Planes anteriores del chat (el grafo los dibuja atenuados) */
      planes: Plan[]
    }
  }
}
