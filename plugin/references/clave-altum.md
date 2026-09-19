# La clave de Altum de cada persona

**Una sola clave personal por persona sirve para todos sus proyectos.** No se pide a un administrador ni se repite por proyecto. Sin ella, la persona no ve sus proyectos ni sus tareas de Altum (todo lo demás del proceso funciona igual).

**La clave nunca se escribe en el chat.** La persona la pega en su terminal; el comando la guarda en el Llavero de macOS y la carga en cada terminal nueva.

## Cuándo la pide el agente
- **Al instalar el plugin** (alguien dice "instala esta skill" con la URL del repositorio): es el último paso de la instalación.
- **En `/sn-setup`**, al preparar un proyecto.
- **En cualquier momento**: si falta la clave, el hook del plugin se lo recuerda al agente (como máximo una vez cada 12 h) para que lo ofrezca en una línea. Si la persona dice que no, se sigue sin Altum.

## Los 3 pasos

1. **Comprobar si ya la tiene:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" whoami` (o `node scripts/sn/sn-sync.mjs whoami` si el repo ya tiene el motor). Si responde con su nombre y sus proyectos, ya está: pasa al paso 3.
2. **Que la genere y la guarde:**
   - En Altum: **Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar**. Empieza por `sk_user_` y Altum la muestra una sola vez.
   - Dile: "no la pegues en el chat". Abre una pestaña de terminal y corre ahí `bash "${CLAUDE_PLUGIN_ROOT}/scripts/sn-clave-altum.sh"`. El comando la pide sin mostrarla, la guarda en el Llavero y agrega a `~/.zshrc` la línea que la carga.
   - No hace falta reiniciar nada: si la variable no está en el entorno (las apps de escritorio no leen `~/.zshrc`), el plugin busca la clave en el Llavero él mismo.
3. **Comprobar y seguir:** `… whoami` muestra nombre, empresa y **proyectos asignados**. Si este repositorio corresponde a uno de ellos y no está unido, ofrécele conectarlo con `sn-connect`. Si el proyecto no aparece, no está asignada a él: que el líder del proyecto la agregue en Altum (el acceso cambia al instante, sin regenerar la clave).

## Casos aparte
- **Varias empresas con su propio Altum:** `bash … sn-clave-altum.sh <empresa>` (una por empresa) y en el conector del repo `"key_env": "SN_ALTUM_KEY_<EMPRESA>"`.
- **CI y servidores:** clave de empresa (`sk_live_`, la crea un administrador en Configuración → Claves de API) como secreto: `gh secret set SN_ALTUM_KEY`.
- **No es macOS:** que agregue `export SN_ALTUM_KEY="…"` a su archivo de configuración de la terminal, fuera del chat.

## Errores frecuentes
| Dice | Qué pasó | Qué hacer |
|---|---|---|
| `falta la clave de Altum (…)` | No la guardó, o el Llavero no tiene esa entrada | Paso 2 |
| `404 … no existe, o tu clave personal no alcanza ese proyecto` | El `project_id` está mal, o no estás asignado a ese proyecto | Comprueba con `whoami` y pide al líder que te asigne |
| `401 clave de API inválida` | La regeneró (la anterior dejó de servir) o la copió incompleta | Repetir el paso 2 con la nueva |
| `403 no estás asignado a este proyecto` | Su clave es personal y no está en ese proyecto | Que el líder la asigne en Altum |
| Ve menos proyectos de los esperados | Solo ve los asignados | Igual que arriba |

**Si alguien pega una clave en el chat:** que la regenere en Altum de inmediato (la expuesta deja de servir) y repitan el paso 2.
