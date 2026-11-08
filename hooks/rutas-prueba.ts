// En Linux/macOS el motor resuelve una ruta de Windows (C:/...) como relativa y le antepone la carpeta actual.
// Quita ese prefijo (desde la letra de unidad) y normaliza las barras; en Windows no cambia nada.
export const rutaDePrueba = (p: unknown) => String(p).replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')
