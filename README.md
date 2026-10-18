# Centro de agentes MST

Plugin de Claude Code que convierte a Claude en **jefe** de un equipo de agentes con modelos **gratis en la nube**. Claude planifica, reparte las subtareas en paralelo, verifica cada resultado (nota 1-10) y rehace lo que no pasa. Todo se ve en vivo en un panel y en una web local.

Agentes: **OpenCode**, **Ollama**, **Hermes Agent**, **Aider** y, como último recurso (gasta de tu plan), **Claude headless**.

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
| OpenCode | `npm i -g opencode-ai` | Modelos `opencode/*-free` |
| Hermes Agent | en `~/.hermes` (proveedor `ollama-local` en su `config.yaml`) | Usa tu Ollama, sin clave |
| Aider | `uv tool install aider-chat` en `~/.aider` | Usa tu Ollama, sin clave |
| Claude headless | ya viene con Claude Code | Solo si los gratis rinden claramente peor |

## Comandos

- `/mst [tarea]` — panel + web; con tarea, el jefe la reparte.
- `/mst-informe` — informe final del chat en Markdown.
- `/centro-web`, `/centro-panel`, `/centro-bench <tarea>`, `/centro-reset`.

## Cómo trabaja el jefe

- **Dependencias:** `planificar` acepta `{"3": [1, 2]}`; el centro no deja lanzar la 3 hasta que la 1 y la 2 estén hechas y avisa en `lanzar_ya`.
- **Copias aisladas:** con `aislar: true`, cada agente trabaja en un `git worktree` propio (rama `mst/...`); el resultado trae el comando para juntarlo.
- **Verificación automática:** con `verificar: "npm test"`, el centro ejecuta ese comando donde trabajó el agente y le pasa el resultado al jefe.
- **Skill `jefe-de-agentes`:** el mismo protocolo como skill, para entornos donde el modo jefe automático no se activa.
- Todos los encargos piden respuesta en español.

## Ajustes

En la configuración del plugin: modelos de cada agente, tiempo máximo por tarea, proxy y certificado de empresa, presupuesto de tokens de Claude por chat, y un tema de [ntfy.sh](https://ntfy.sh) opcional para avisos al móvil.

## Web

`http://127.0.0.1:47321` (solo local, con clave). Un centro por chat, más la página **todos los chats**. Estilo basado en [anatomy](https://github.com/wheresryan22/anatomy) (MIT, ver `hooks/anatomy/LICENSE`).

## Desarrollo

```bash
claude plugin test .
```

```bash
claude plugin validate .
```
