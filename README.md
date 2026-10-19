# Centro de agentes MST

Plugin de Claude Code que convierte a Claude en **jefe** de un equipo de agentes con modelos **gratis en la nube**. Claude planifica, reparte las subtareas en paralelo, verifica cada resultado (nota 1-10) y rehace lo que no pasa. Todo se ve en vivo en un panel y en una web local.

Agentes: **OpenCode**, **Ollama**, **Hermes Agent**, **Aider**, **Codex** y, como último recurso (gasta de tu plan), **Claude headless**.

## Instalar

```bash
claude plugin marketplace add msatri21/Centro-Agentes
```

```bash
claude plugin install centro-agentes@centro-mst
```

Reabre las sesiones de Claude Code. En cualquier chat: `/mst` abre el panel y la web; `/mst <tarea>` pone al jefe a trabajar.

### Agentes (instala los que quieras; el centro salta los que falten)

| Agente | Instalación | Notas |
|---|---|---|
| Ollama | [ollama.com](https://ollama.com) y `ollama signin` | Los modelos `:cloud` del plan Free son gratis |
| OpenCode | `npm i -g opencode-ai` y el proveedor `ollama` en `~/.config/opencode/opencode.jsonc` (ver abajo) | Usa tu Ollama, sin clave |
| Hermes Agent | en `~/.hermes` (proveedor `ollama-local` en su `config.yaml`) | Usa tu Ollama, sin clave |
| Aider | `uv tool install aider-chat` en `~/.aider` | Usa tu Ollama, sin clave |
| Codex | `npm i -g @openai/codex` y `codex login` con tu cuenta de ChatGPT | Cupo gratis limitado de tu cuenta; si no hay sesión o se acaba, usa tu Ollama |
| Claude headless | ya viene con Claude Code | Solo si los gratis rinden claramente peor |

## Comandos

- `/mst [tarea]` — panel + web; con tarea, el jefe la reparte.
- `/mst-informe` — informe final del chat en Markdown.
- `/centro-web`, `/centro-panel`, `/centro-bench <tarea>`, `/centro-reset`.

## Cómo trabaja el jefe

- **Dependencias:** `planificar` acepta `{"3": [1, 2]}`; si mandas la 3 en el mismo `delegar_varios` que la 1 y la 2, arranca sola cuando esas terminan bien; si no, el centro la bloquea y avisa en `lanzar_ya`.
- **Copias aisladas:** con `aislar: true`, cada agente trabaja en un `git worktree` propio (rama `mst/...`); el resultado trae el comando para juntarlo.
- **Verificación automática:** con `verificar: "npm test"`, el centro ejecuta ese comando donde trabajó el agente y le pasa el resultado al jefe.
- **Skill `jefe-de-agentes`:** el mismo protocolo como skill, para entornos donde el modo jefe automático no se activa.
- **Subtareas del jefe:** las que hace Claude (juntar ramas, revisar) se cierran con `cerrar_subtarea`.
- Las copias sin cambios, o de un encargo que falló del todo, se borran solas.
- Todos los encargos piden respuesta en español.

## Ajustes

En la configuración del plugin: modelos de cada agente, tiempo máximo por tarea, proxy y certificado de empresa, presupuesto de tokens de Claude por chat, y un tema de [ntfy.sh](https://ntfy.sh) opcional para avisos al móvil.

## Web

`http://127.0.0.1:47321` (solo local, con clave). Un centro por chat, más la página **todos los chats**. Estilo basado en [anatomy](https://github.com/wheresryan22/anatomy) (MIT, ver `hooks/anatomy/LICENSE`).

## Desarrollo

Prueba rápida del servidor MCP (sin lanzar agentes): `node mcp/prueba-mcp.mjs`.

```bash
claude plugin test .
```

```bash
claude plugin validate .
```

## OpenCode como jefe (cuando se acaba Claude)

El centro también funciona como servidor MCP (`mcp/centro-mcp.mjs`), con las mismas herramientas: `planificar`, `delegar`, `delegar_varios`, `registrar_auditoria`, `cerrar_subtarea` y `ranking`, más `juntar_copias`, que junta de una vez las ramas de las copias aisladas del chat. Así OpenCode, con un modelo gratis de Ollama, puede hacer de jefe. Reutiliza el código del plugin (`hooks/nucleo.ts`, `hooks/extras.ts`) y necesita Node 24 o más reciente.

1. En `~/.config/opencode/opencode.jsonc`, añade el servidor:

   ```jsonc
   "mcp": {
     "centro-agentes": {
       "type": "local",
       "command": ["node", "<ruta>/centro-agentes/mcp/centro-mcp.mjs"],
       "enabled": true,
       "timeout": 900000
     }
   }
   ```

   `timeout` es en milisegundos y cubre también la ejecución: repartir y esperar a los agentes tarda minutos.
2. Copia `opencode/agents/jefe.md` y `opencode/commands/mst.md` de este repo a `~/.config/opencode/agents/` y `~/.config/opencode/commands/`: el agente `jefe` (modo `primary`, modelo `ollama/gpt-oss:120b-cloud`) lleva el protocolo, y `/mst` le pasa la tarea. Pon también `"model": "ollama/gpt-oss:120b-cloud"` en la config para no depender de OpenCode Zen.
3. Opcional, en `~/.centro-agentes/opencode-jefe.json`: `{ "ntfyTema": "...", "conClaude": false, "timeoutMin": 8 }`.

Uso: `opencode` en la carpeta del proyecto, cambia al agente **jefe** (tecla Tab) y escribe `/mst <tarea>`. La web es la misma (`http://127.0.0.1:47321`) y el chat aparece en **todos los chats** como `OpenCode jefe`. Con OpenCode como jefe, Claude headless no se usa salvo que pongas `"conClaude": true`, y las skills se ignoran.

## OpenCode con Ollama (gratis, sin clave)

En `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "gpt-oss:120b-cloud": {}, "beam:cloud": {}, "gemma4:31b-cloud": {},
        "nemotron-3-super:cloud": {}, "gpt-oss:20b-cloud": {}
      }
    }
  }
}
```
