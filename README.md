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
| OpenCode | `npm i -g opencode-ai` | Usa sus propios modelos gratuitos (`opencode/...-free`), sin clave y sin Ollama. Ollama es opcional (ver el final) |
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
- **Carpeta compartida:** sin `aislar`, varios agentes pueden trabajar en la misma carpeta y rama. Cada uno declara en `archivos` lo que puede tocar: los que tocan cosas distintas trabajan a la vez y los que chocan (o no declaran nada) se turnan. El resultado avisa en `fuera_de_alcance` si un agente tocó archivos que no eran suyos.
- **Verificación automática:** con `verificar: "npm test"`, el centro ejecuta ese comando donde trabajó el agente y le pasa el resultado al jefe.
- **Skill `jefe-de-agentes`:** el mismo protocolo como skill, para entornos donde el modo jefe automático no se activa.
- **Subtareas del jefe:** las que hace Claude (juntar ramas, revisar) se cierran con `cerrar_subtarea`.
- Las copias sin cambios, o de un encargo que falló del todo, se borran solas.
- Todos los encargos piden respuesta en español.

## Ajustes

En la configuración del plugin: modelos de cada agente, tiempo máximo por tarea, proxy y certificado de empresa, presupuesto de tokens de Claude por chat, y un tema de [ntfy.sh](https://ntfy.sh) opcional para avisos al móvil.

## Cómo arranca /mst y el cerebro global

1. **El enlace primero.** Al escribir `/mst <tarea>`, lo primero que ves es el enlace del centro de agentes de ese chat (y el jefe lo repite como su primer mensaje).
2. **Preguntas hasta tenerlo claro.** Antes de planificar, el jefe te pregunta (con la herramienta de preguntas de Claude Code, o en el chat) por el objetivo, el alcance, el estilo o la tecnología, las restricciones y cómo sabrás que está terminado. Cuando lo tiene claro, te resume lo que entendió y planifica. Lo que la tarea ya dice no se pregunta.
3. **El cerebro global** (`~/.centro-agentes/cerebro.json`) es compartido por todos los chats y por OpenCode como jefe. Cada vez que el jefe puntúa un trabajo se apunta qué se hizo, qué agente y modelo lo hicieron y qué nota sacó. Antes de preguntar, el jefe lo consulta con la herramienta `cerebro` (palabras clave de la tarea): le dice quién lo hizo mejor en casos parecidos y cuáles fueron. Y al repartir, si dejas trabajador y modelo vacíos, el centro empieza por quien sacó 7 o más en algo parecido (Claude headless solo si sacó 9 o más). Guarda las últimas 400 experiencias.

## Preguntas y permisos de los agentes

Los agentes trabajan en modo autónomo (`--yolo`), pero pueden pararse a preguntarte algo o a pedirte permiso sin gastar tokens de Claude:

- Cada agente trae dos herramientas MCP, `preguntar` y `pedir_permiso` (las sirve `mcp/centro-mcp.mjs`, la entrada `centro-agentes` de la config de OpenCode de la sección de abajo). El centro le pasa su identidad por entorno (`CENTRO_CHAT_DIR`, `CENTRO_TRABAJO`) y le añade a su encargo cuándo usarlas.
- La consulta se escribe en `consultas.jsonl` del chat y aparece en la web en **Esperan tu respuesta**, con la card del agente marcada como PREGUNTA o PERMISO. Contestas con los botones (o escribiendo) y la respuesta llega al agente por `respuestas.jsonl`. En pantallas grandes se contesta dentro del propio nodo agrandado del grafo; en el móvil, donde el grafo se esconde, queda el panel **Esperan tu respuesta**.
- **Permitir siempre en esta petición** aprueba esa categoría de permiso (`comando`, `instalar`, `red`, `escribir-fuera`, `otro`) para el resto del chat. Lo `destructivo` siempre se pregunta.
- Mientras una consulta espera, el centro no corta al agente por tardar ni por callar. Si pasan 15 min sin respuesta, un permiso se da por denegado y el agente sigue por lo más seguro.
- **OpenCode:** usa la entrada `centro-agentes` de su config (la de la sección de abajo).
- **Codex:** no hace falta configurar nada: el centro le pasa su servidor MCP en cada ejecución (`-c mcp_servers.centro...`), con la identidad reenviada y el tiempo de espera de herramientas ampliado a 20 min (por defecto son 60 s).
- **Hermes:** añade a su `config.yaml` (la que muestra `hermes config path`) esta entrada. Hermes no hereda el entorno, por eso cada variable va declarada, y `timeout` sube de 120 s a 20 min. Fuera del centro las herramientas existen pero avisan de que no están dentro del centro.
  ```yaml
  mcp_servers:
    centro-agente:
      command: node
      args: ["<ruta>/centro-agentes/mcp/centro-mcp.mjs"]
      timeout: 1200
      env:
        CENTRO_TRABAJADOR: "1"
        CENTRO_CHAT_DIR: "${CENTRO_CHAT_DIR}"
        CENTRO_TRABAJO: "${CENTRO_TRABAJO}"
        CENTRO_ESPERA_MS: "${CENTRO_ESPERA_MS}"
  ```
- Aider no usa MCP: solo cuenta la alarma de silencio.
- Pruébalo sin gastar nada: `node mcp/prueba-consultas.mjs` (de punta a punta) o `node mcp/demo-bucle.mjs` (la web con consultas que se pueden contestar). Con agentes de verdad (OpenCode con modelos gratuitos): `node mcp/prueba-en-vivo.mjs` lanza tandas de cinco agentes que preguntan y piden permiso, y tú contestas en la web; se para con Ctrl+C y borra lo que creó.

## Web

`http://127.0.0.1:47321` (solo local, con clave). Un centro por chat, más la página **todos los chats**. Es la misma página con Claude o con OpenCode de jefe:

- **El grafo grande**, en vivo con los datos reales: **Claude, el jefe, en el centro** y, alrededor, **un cuadrado punteado por plan** con los subagentes que trabajan en él. Sobre el borde de cada cuadrado va la línea de tiempo del plan (Planeación, Reparto, En proceso, Verificación, Auditoría, Juntar, Informe) y debajo del título se lee la fase, con el progreso de las subtareas en "En proceso". Cada subagente es un nodo pequeño con el nombre del agente y un punto de estado (trabajando, terminó en verde, falló en rojo); al hacer clic se agranda con el modelo, el tiempo, la nota y la última línea. Los nodos y los grupos se acomodan solos; el lienzo se mueve con el ratón y hace zoom con la rueda (**Ajustar** vuelve al encuadre). Los planes anteriores quedan atenuados y se reactivan si Claude vuelve a planificar con el mismo objetivo. Las partículas son lo que pasa de verdad (un encargo que sale, un resultado, una nota). Se actualiza cada 2 s sin recargar, así las animaciones no se cortan.
- **Alarmas en los nodos:** el nodo se agranda solo, el borde pulsa y aparece una insignia: `SILENCIO` (el agente lleva más de 60 s sin escribir), `PREGUNTA` o `PERMISO` (el agente espera tu respuesta o una autorización). El contador de arriba suma los agentes activos y las alarmas. Los agentes corren en modo autónomo (`--yolo`): solo preguntan cuando de verdad lo necesitan.
- **Gráficas del estilo anatomy** debajo: tokens por agente, rendimiento por modelo, línea de tiempo de los trabajos, notas del jefe y ahorro acumulado. Con Claude de jefe, además, la figura isométrica y la tarjeta de detalles.
- Subtareas, historial, botones de **Cancelar** y **Relanzar** (también con OpenCode de jefe: el servidor MCP lee las órdenes de la web y se las cuenta al jefe en su siguiente llamada, en `avisos_web`), y el aviso al terminar.
- En pantallas estrechas (móvil) el grafo se esconde y sale una fila por agente con su estado, modelo y última línea.

Estilo basado en [anatomy](https://github.com/wheresryan22/anatomy) (MIT, ver `hooks/anatomy/LICENSE`).

## Desarrollo

Prueba rápida del servidor MCP (sin lanzar agentes): `node mcp/prueba-mcp.mjs`.

Simulación en bucle (sin agentes ni gasto) para ver cómo se comporta el grafo: `node mcp/demo-bucle.mjs`, y abre el chat `demo-bucle` en la web.

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
       "timeout": 1200000
     }
   }
   ```

   `timeout` es en milisegundos y cubre también la ejecución: repartir y esperar a los agentes tarda minutos, y una consulta de un agente puede esperar hasta 15 min al usuario (por eso son 20 min).
2. Copia `opencode/agents/jefe.md` y `opencode/commands/mst.md` de este repo a `~/.config/opencode/agents/` y `~/.config/opencode/commands/`: el agente `jefe` (modo `primary`, modelo `opencode/deepseek-v4.1-flash-free`, uno de los gratuitos de OpenCode) lleva el protocolo, y `/mst` le pasa la tarea.
3. Opcional, en `~/.centro-agentes/opencode-jefe.json`: `{ "ntfyTema": "...", "conClaude": false, "timeoutMin": 8 }`.

Uso: `opencode` en la carpeta del proyecto, cambia al agente **jefe** (tecla Tab) y escribe `/mst <tarea>`. La web es la misma (`http://127.0.0.1:47321`) y el chat aparece en **todos los chats** como `OpenCode jefe`. Con OpenCode como jefe, Claude headless no se usa salvo que pongas `"conClaude": true`, y las skills se ignoran.

## OpenCode con Ollama (opcional)

Por defecto OpenCode usa sus propios modelos gratuitos y no necesita nada de esto. Si además quieres los modelos de Ollama, añade `ollama/<modelo>` a los modelos de OpenCode en los ajustes del plugin y, en `~/.config/opencode/opencode.jsonc`:

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
