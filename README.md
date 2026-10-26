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

## Skills opcionales: ponytail

El centro puede darles a los agentes que programan la skill [ponytail](https://github.com/DietrichGebert/ponytail) (MIT): pide el cambio más pequeño pero completo, que reutilicen lo que ya existe y que dejen una línea con lo que omitieron. No viene incluida; si la instalas, el centro la usa:

- **Instalación guiada.** Si falta, `/mst` avisa una sola vez con la lista exacta de lo que se descargaría y dónde. El plugin no descarga nada por su cuenta: dile a Claude "instala ponytail" (te enseña la lista y espera tu sí) o ejecuta tú `node mcp/instalar-ponytail.mjs --instalar` (sin `--instalar` solo muestra el plan).
  - **Se descarga** (solo de `raw.githubusercontent.com`, de `DietrichGebert/ponytail`, commit fijo `09c434a`, licencia MIT, 20 566 bytes en total): `skills/ponytail/SKILL.md`, `skills/ponytail-review/SKILL.md`, `skills/ponytail-audit/SKILL.md`, `hooks/ponytail-map.js` y `LICENSE`.
  - **Se escribe** en `~/.claude/skills/ponytail/`, `~/.claude/skills/ponytail-review/` y `~/.claude/skills/ponytail-audit/` (cada una con `SKILL.md`, `LICENSE` y `ORIGEN.md`) y en `~/.centro-agentes/ponytail/` (`ponytail-map.js`, `LICENSE` y `ORIGEN.md`). `ponytail-map.js` es un script local, sin red ni modelo, que lista las funciones y clases que ya hay en una carpeta.
  - **Garantías:** cada archivo se verifica (tamaño y SHA-1 de git, los que da GitHub para ese commit) antes de escribir nada, y si uno no coincide no se escribe ninguno. Lo descargado no se ejecuta. No se sobrescribe lo que ya exista (salvo con `--reemplazar`). Con `--solo-manual` se añade `disable-model-invocation: true` al encabezado de `ponytail`, para que Claude no la active solo en tus sesiones; el centro la sigue usando.
  - **A mano**, si lo prefieres: copia esos mismos archivos del repositorio a esas mismas carpetas.
- **El centro las añade solo**, según la clase de tarea, sin depender de que Claude se acuerde (ajuste `ponytailAutomatico`, activado por defecto): `ponytail` a toda tarea que escribe o cambia código, `ponytail-review` a las auditorías de un cambio y `ponytail-audit` a las de un repositorio entero. Solo las que estén instaladas, y solo a los agentes que leen skills (OpenCode, Codex y Hermes; Ollama y Aider quedan como están).
- **Cómo decide si es código:** mira la categoría, si la tarea nombra archivos de código o usa vocabulario de programación, y si el encargo declara `archivos`, `aislar` o `verificar`. Es amplio a propósito: ante la duda cuenta como código. Una tarea que audita sin pedir cambios es una auditoría (de un repo entero si dice "todo el repositorio" o su categoría es `auditoria-repo`); "revisa y corrige" es escritura.
- Con `ponytail` y `ponytail-audit` el encargo lleva además el mapa del código de la carpeta donde trabajará el agente (sin el script, sale sin mapa). `ponytail-review` no lo lleva: revisa un cambio concreto.
- El resultado de una tarea de código trae `auditar_con` y `aviso_auditoria`, para que el jefe la audite con `ponytail-review`. Para no añadir las skills a un encargo concreto: `sin_skills_automaticas: true`.
- Para afinar el clasificador, cada trabajo guarda lo que decidió el centro: la clase (`escritura`, `auditoria`, `auditoria-repo` o `texto`), los motivos y las skills que añadió. Se ve en el resultado de `delegar` (`clasificacion`) y en el nodo agrandado de la web (Clase, Skills y Por qué). Así un falso positivo se detecta comparando la clase con la tarea.

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

## Seguimiento de tareas: mst-tareas.json

El plan se guarda en `mst-tareas.json`, en la raíz de la carpeta del proyecto: la de la sesión o la que pases en `cwd`. Se crea con el primer `planificar` y lo leen igual Claude y OpenCode como jefe. Al lado queda `mst-tareas-cerradas.md`, el historial de las tareas que salen del archivo.

**Git lo ignora.** La primera vez que se crea el archivo, el centro añade la línea `mst-tareas*` al `.gitignore` del proyecto (lo crea si no existe) y no hace commit. Si `mst-tareas.json` ya estaba versionado, el resultado lo avisa en `archivo.gitignore.aviso` y no se toca: sácalo tú con `git rm --cached mst-tareas.json`.

**Formato en dos niveles.** Una tarea (`T2`) agrupa subtareas (`T2.1`, `T2.2`). Cada nivel tiene `id`, `titulo`, `estado`, `depende_de`, `enlaces`, `creada` y `cerrada`; la tarea añade `solucionada` y la lista `subtareas`. La raíz guarda `proyecto`, `formato`, `actualizado`, `siguiente_tarea`, `estados`, `reglas` y `tareas`:

```json
{
  "proyecto": "mi-web",
  "formato": "mst-tareas v1",
  "actualizado": "2026-10-23",
  "siguiente_tarea": 3,
  "estados": ["pendiente", "en_proceso", "realizado", "solucionado", "cerrado"],
  "reglas": ["..."],
  "tareas": [
    {
      "id": "T2",
      "titulo": "Revisar la portada",
      "estado": "en_proceso",
      "depende_de": [],
      "enlaces": [],
      "creada": "2026-10-22",
      "solucionada": null,
      "cerrada": null,
      "subtareas": [
        {
          "id": "T2.1",
          "titulo": "Listar los fallos",
          "estado": "solucionado",
          "depende_de": [],
          "enlaces": [],
          "creada": "2026-10-22",
          "cerrada": null
        }
      ]
    }
  ]
}
```

**Los cinco estados.** `pendiente`, `en_proceso`, `realizado`, `solucionado` y `cerrado`. Los mueve el centro o el jefe, nunca los agentes:

- Al delegar una subtarea, el centro la pasa a `en_proceso` (solo si seguía en `pendiente`); al recibir el resultado, a `realizado`, o de vuelta a `pendiente` si el encargo falló.
- El jefe la marca `solucionado` al auditarla con 6 o más con `registrar_auditoria`; con menos vuelve a `pendiente` para rehacerla. Las subtareas que hace él (juntar ramas, revisar el conjunto) las cierra con `cerrar_subtarea`.
- `cerrado` queda para las tareas que pasan al historial.

Los agentes no editan el archivo: si ven trabajo nuevo, lo apuntan al final de su respuesta en una sección «Propuestas:» y el jefe decide.

**Reglas.**

- **Una tarea solo es solucionada si todas sus subtareas lo son.** Su estado se deriva de ellas.
- **Dependencias solo entre subtareas** (`depende_de`); las tareas no admiten dependencias entre sí. Una subtarea no arranca hasta que las suyas estén solucionadas.
- **Como máximo 5 tareas solucionadas.** Al llegar la sexta, la más antigua (por fecha `solucionada` y, a igualdad, por número) pasa a `mst-tareas-cerradas.md`.
- **Los números no se reutilizan.** `siguiente_tarea` da el siguiente `T` y la fecha `solucionada` decide cuál es la más antigua al archivar.
- **Subtareas manuales** (`manuales` al planificar): no se delegan; las marca el jefe.
- **Las tareas solucionadas no se editan.** Reabrir una es decisión del jefe: si cumplía lo pedido, crea una tarea nueva; si no, usa `planificar { reabrir: ["T2.3"] }` para devolver a `pendiente` la subtarea que falló.
- **Los archivos hechos a mano** con menos campos se aceptan y se completan al leerlos: sin `siguiente_tarea` se reconstruye desde los ids y sin `solucionada` queda en `null`.

**Cómo se usa.** `planificar` crea la tarea (`objetivo` y `subtareas`) o reutiliza la que ya tenga ese título y no esté en el historial; `manuales` marca las que no se delegan; `tarea: "T2"` retoma una guardada; `agregar` y `ajustar` pulen el plan; `reabrir: ["T2.3"]` devuelve a pendiente la subtarea que falló; `cwd` elige la carpeta. `tareas_estado` devuelve el resumen corto sin leer el archivo entero. El jefe escribe un borrador en cuanto termina la entrevista y lo pule al repartir. Si un agente propone trabajo nuevo en «Propuestas:», el jefe decide si lo agrega como subtarea hermana o lo planifica como tarea nueva.

**Varios a la vez.** Varios chats o procesos pueden usar el mismo archivo: hay un cerrojo (`mst-tareas.json.lock`), la escritura es atómica (temporal y renombrado) y se guarda una copia `.bak`. Al reservar una subtarea solo pasa a `en_proceso` si sigue en `pendiente`, así dos encargos no toman la misma. Si el archivo no se puede leer o escribir, el plan sigue funcionando en memoria y el resultado lo dice en `aviso_archivo`.

## Catálogo de modelos

**Qué es.** Para cada modelo de cada agente, el centro guarda qué sabe hacer (ver imágenes, usar herramientas y razonar), su contexto y la fecha en que se comprobó. Lo usan el reparto y la web. Un dato desconocido nunca cuenta como que el modelo sepa hacerlo: se muestra como `?` y no pasa un filtro de capacidad.

**Cómo se arma.** Solo, en segundo plano al empezar cada sesión, sin hacer esperar al jefe:

- **Ollama:** con `ollama show` en vivo, para los modelos del agente `ollama` y los `ollama/`, `ollama_chat/` y `ollama-local/` de los demás.
- **OpenCode:** con la lista pública de models.dev; se guarda en el catálogo y no se vuelve a descargar mientras el catálogo siga vigente (24 h) y la lista de modelos no cambie. Sin red, usa la caché local de OpenCode y la fuente lo anota.
- **Claude y Codex:** con una tabla fija del plugin (`haiku`, `sonnet`, `opus` y `chatgpt`).

Se guarda en `~/.centro-agentes/catalogo.json`. Se rehace si pasan 24 h o si cambia la lista de modelos; si la última consulta falló, lo reintenta antes (una hora).

**Tareas con imágenes.** El centro detecta solo, por la tarea y su categoría, si habla de capturas, fotos, OCR, png/jpg... (no confunde "imagen de Docker") y entonces solo reparte a modelos que ven imágenes. Se fuerza con `necesita: ['imagen']` y se desactiva con `necesita: []`. Si ningún modelo conocido la tiene, no se lanza: el error dice cuántos se descartaron por no tenerla y cuántos por capacidad desconocida. Un modelo pedido a propósito en `modelo` se usa igual y el resultado trae `aviso_capacidad` con lo que el catálogo no confirma.

**Para consultarlo.** El jefe tiene la herramienta `modelos` (filtra por `agente` o `necesita` y devuelve capacidades, contexto, nota media y veces usado); tú tienes `/mst-modelos`. En la web, la sección **Modelos disponibles** muestra la misma tabla con un botón **Proponer** por modelo. También puedes proponerlo por chat ("prueba con..."): el jefe lo comprueba con `modelos`, lo pasa en el campo `modelo` de `delegar` en la próxima tarea que encaje y lo puntúa al auditar, para que el cerebro aprenda.

**Sin internet.** `catalogoEnLinea` (activo por defecto) controla la descarga de models.dev. Con `false` no se consulta internet: se usa la caché local de OpenCode si la hay y la fuente lo anota. En OpenCode como jefe va en `~/.centro-agentes/opencode-jefe.json` como `catalogoEnLinea`; el resto funciona igual, con el mismo `catalogo.json`.

## Ajustes

En la configuración del plugin: modelos de cada agente, tiempo máximo por tarea, proxy y certificado de empresa, presupuesto de tokens de Claude por chat, catálogo de modelos en línea (`catalogoEnLinea`, activo por defecto) y un tema de [ntfy.sh](https://ntfy.sh) opcional para avisos al móvil.

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

`http://127.0.0.1:47321` (solo local, con clave). Un centro por chat, más la página **todos los chats**. Desde ella (o desde el enlace "todos en un grafo" de cada chat) se abre un solo grafo con los planes de todos los chats activos en las últimas 24 h: cada cuadrado lleva el nombre de su chat, y las preguntas, permisos y el botón Cancelar llegan al chat de cada agente. Es la misma página con Claude o con OpenCode de jefe:

- **El grafo grande**, en vivo con los datos reales: **Claude, el jefe, en el centro** y, alrededor, **un cuadrado punteado por plan** con los subagentes que trabajan en él. Sobre el borde de cada cuadrado va la línea de tiempo del plan (Planeación, Reparto, En proceso, Verificación, Auditoría, Juntar, Informe) y debajo del título se lee la fase, con el progreso de las subtareas en "En proceso". Cada subagente es un nodo pequeño con el nombre del agente y un punto de estado (trabajando, terminó en verde, falló en rojo); al hacer clic se agranda con el modelo, el tiempo, la nota y la última línea. Los nodos y los grupos se acomodan solos; el lienzo se mueve con el ratón y hace zoom con la rueda (**Ajustar** vuelve al encuadre). Los planes anteriores quedan atenuados y se reactivan si Claude vuelve a planificar con el mismo objetivo. Las partículas son lo que pasa de verdad (un encargo que sale, un resultado, una nota). Se actualiza cada 2 s sin recargar, así las animaciones no se cortan.
- **Alarmas en los nodos:** el nodo se agranda solo, el borde pulsa y aparece una insignia: `SILENCIO` (el agente lleva más de 60 s sin escribir), `PREGUNTA` o `PERMISO` (el agente espera tu respuesta o una autorización). El contador de arriba suma los agentes activos y las alarmas. Los agentes corren en modo autónomo (`--yolo`): solo preguntan cuando de verdad lo necesitan.
- **Gráficas del estilo anatomy** debajo: tokens por agente, rendimiento por modelo, línea de tiempo de los trabajos, notas del jefe y ahorro acumulado. Con Claude de jefe, además, la figura isométrica y la tarjeta de detalles.
- Subtareas, historial, botones de **Cancelar** y **Relanzar** (también con OpenCode de jefe: el servidor MCP lee las órdenes de la web y se las cuenta al jefe en su siguiente llamada, en `avisos_web`), y el aviso al terminar.
- En pantallas estrechas (móvil) el grafo se esconde y sale una fila por agente con su estado, modelo y última línea.

Estilo basado en [anatomy](https://github.com/wheresryan22/anatomy) (MIT, ver `hooks/anatomy/LICENSE`).

## Desarrollo

Prueba rápida del servidor MCP (sin lanzar agentes): `node mcp/prueba-mcp.mjs`.

Archivo de tareas (creación, cerrojo, concurrencia, historial y archivos hechos a mano): `node mcp/prueba-tareas.mjs`.

Herramientas del jefe por MCP, con un OpenCode falso y sin gastar modelos: `node mcp/prueba-mcp-tareas.mjs`.

Simulación en bucle (sin agentes ni gasto) para ver cómo se comporta el grafo: `node mcp/demo-bucle.mjs`, y abre el chat `demo-bucle` en la web.

Catálogo de modelos: `hooks/catalogo*.test.ts` cubre las funciones, el reparto con capacidades, `/mst-modelos` y la tabla de la web. De punta a punta, sin red ni gastar modelos: `node mcp/prueba-catalogo.mjs` (actualizar y guardar), `node mcp/prueba-mcp-catalogo.mjs` (herramienta `modelos` del jefe, capacidades al delegar y propuestas de la web) y `node mcp/prueba-importaciones.mjs` (que los módulos que carga Node se puedan importar).

```bash
claude plugin test .
```

```bash
claude plugin validate .
```

## OpenCode como jefe (cuando se acaba Claude)

El centro también funciona como servidor MCP (`mcp/centro-mcp.mjs`), con las mismas herramientas: `planificar`, `tareas_estado`, `delegar`, `delegar_varios`, `registrar_auditoria`, `cerrar_subtarea`, `ranking`, `cerebro`, `modelos`, más `juntar_copias`, que junta de una vez las ramas de las copias aisladas del chat. Así OpenCode, con un modelo gratis de Ollama, puede hacer de jefe. Reutiliza el código del plugin (`hooks/nucleo.ts`, `hooks/extras.ts`) y necesita Node 24 o más reciente.

El plan funciona igual que con Claude de jefe: el mismo `mst-tareas.json`, las mismas reglas y el mismo historial. Sin `cwd`, la carpeta del proyecto es la carpeta desde la que OpenCode lanzó el servidor MCP (`process.cwd()`); pásalo en `planificar` y `tareas_estado` para usar otra.

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
