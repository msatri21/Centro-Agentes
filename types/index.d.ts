export type Trabajador = 'ollama' | 'opencode' | 'hermes' | 'aider' | 'codex' | 'claude'

export type Trabajo = {
  id: string
  /** trabajador:modelo, o solo trabajador si usa el modelo por defecto */
  trabajador: string
  categoria: string
  tarea: string
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
  /** Última vez que llegó texto del agente (ms epoch) */
  ultimaActividad?: number
}

export type Subtarea = {
  n: number
  titulo: string
  estado: 'pendiente' | 'en curso' | 'hecha'
  /** Números de las subtareas que tienen que estar hechas antes de lanzar esta */
  espera?: number[]
  /** trabajador:modelo que la tiene o la hizo */
  quien?: string
  puntaje?: number
}

export type Plan = { objetivo: string; subtareas: Subtarea[] }

declare module 'claude-code' {
  interface PluginState {
    'centro-agentes': {
      trabajos: Trabajo[]
      plan: Plan | null
    }
  }
}
