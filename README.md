# softnexus-sdd-kit

Kit para trabajar **Spec Driven** en todos los proyectos de Softnexus con Claude Code.
Motor de specs: **OpenSpec**. Disciplina: **Superpowers** (TDD, debugging, verificación).
Capa propia: plugin **softnexus-sdd** — una sola puerta (`/sn`) que conduce todo el camino.

Especificación completa: `../METODOLOGIA-ESPECIFICACION.md` · Manual del equipo: `../MANUAL-NINOS.md`.

```
softnexus-sdd-kit/
├── .claude-plugin/marketplace.json   ← marketplace interno (subir a GitHub privado)
└── plugin/
    ├── skills/sn                  ← LA PUERTA: todo entra aquí (idea, bug, error, mejora, pedido)
    ├── skills/sn-status           ← ¿dónde voy? (estado derivado de los archivos)
    ├── skills/sn-help             ← ¿qué puedo hacer ahora? (ayuda según el momento)
    ├── skills/sn-request          ← pedir la firma del líder por git + mensaje para el chat
    ├── skills/sn-validate         ← (líder) validar a distancia, en carpeta aparte
    ├── skills/sn-items            ← ver/copiar/exportar historias con trazabilidad
    ├── skills/sn-connect          ← conectar sistemas de tareas y mensajería
    ├── scripts/validation-state.mjs ← estado de validaciones (local y pendientes remotas)
    ├── scripts/sn-sync.mjs + sync/ ← motor de sincronización (se copia a cada repo en scripts/sn/)
    ├── hooks/sync-trigger.mjs     ← sincroniza en segundo plano cuando cambian ítems o planos
    ├── hooks/altum-watch.mjs      ← vigila Altum mientras la sesión está abierta (sin n8n)
    ├── skills/sn-story         ← pedido vago → historia Given/When/Then
    ├── skills/sn-evidence        ← gates + escenario→prueba + capturas
    ├── skills/sn-ship         ← ramas, commits convencionales, PR
    ├── skills/sn-explain         ← microlección de 5 min
    ├── skills/sn-learn         ← error repetido → regla/test/hook
    ├── skills/sn-setup    ← deja un repo listo leyendo su código
    ├── skills/sn-split            ← solo proyectos existentes: reduce archivos heredados de más de 1000 líneas
    ├── hooks/guard.mjs            ← bloquea .env, force-push, DDL, migraciones, deploy manual, CI
    ├── hooks/file-size.mjs        ← bloquea archivos de más de 1000 líneas (aviso desde 800)
    └── plantillas/                ← AGENTS.md, CLAUDE.md, openspec/config.yaml, settings, PR template, historia
```

## Instalación (una vez por persona)

```bash
npm install -g @fission-ai/openspec@latest
claude plugin marketplace add <org>/softnexus-sdd-kit
claude plugin install softnexus-sdd@softnexus
claude plugin marketplace add obra/superpowers
claude plugin install superpowers@superpowers-dev
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
```

**Último paso: tu clave de Altum.** Al terminar la instalación, el agente la pide: la generas en Altum (**Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar**) y la guardas con `bash "${CLAUDE_PLUGIN_ROOT}/scripts/sn-clave-altum.sh"`, que la pide en la terminal **sin mostrarla** (nunca se pega en el chat). Es **una sola clave para todos tus proyectos**: después, el agente sabe quién eres y lista los proyectos que tienes asignados. Si no la guardas ahora, te la vuelve a ofrecer cuando uses cualquier comando. Detalle: `plugin/references/clave-altum.md`.

## Preparar un proyecto (una vez por repo)
En Claude Code, dentro del repo: `/sn-setup`. Lee el código, instala OpenSpec y escribe `AGENTS.md`, `DESIGN.md`, config y plantillas. El líder técnico revisa el PR.

## Uso diario

| Necesito… | Escribo |
|---|---|
| Traer cualquier cosa (idea, bug, error, mejora, correo del cliente) | `/sn <lo que sea>` |
| Saber en qué voy y qué sigue | `/sn-status` |
| No sé qué hacer / no recuerdo los comandos | `/sn-help` |
| Pedir la firma del líder (desde mi computador) | `/sn-request` |
| (Líder) Validar lo que me pidieron, desde el mío | `/sn-validate` |
| Ver o copiar historias y bugs (con sus commits) | `/sn-items` |
| Conectar Altum, GitHub/Orca, n8n o Matrix | `/sn-connect` |

Todo lo demás lo conduce `/sn`: tarjeta → historia → plano (OpenSpec) → **sello: aprobación** → construir → evidencia → commits/PR → **sello: revisión** en sesión nueva (`/code-review`) y prueba humana → archivar → microlección.
