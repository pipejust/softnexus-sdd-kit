# Pruebas del plugin

Cinco pruebas de punta a punta contra servidores falsos: no tocan Altum, GitHub ni Azure de verdad,
y no necesitan claves. Cada una crea lo suyo dentro de `pruebas/tmp/` (esa carpeta no se versiona).

```bash
bash pruebas/todas.sh
```

| Prueba | Qué cubre |
|---|---|
| `run.sh` | El motor de punta a punta: eventos, conectores REST, webhook, Matrix y GitHub Issues, cola de reintentos, motor del repositorio frente al del plugin, y las dos reglas de Windows (clave del sistema, sin consolas). |
| `altum-test.sh` | El conector nativo de Altum contra el contrato real: crear y actualizar tareas sin duplicar, estados, criterios de aceptación, tareas de reuniones (Acten), repositorios del proyecto, `conectar`, firma del líder y PR de GitHub y Azure DevOps. |
| `watch-test.sh` | El vigilante de Altum ligado a la sesión y la orientación al abrir una carpeta. |
| `proceso-test.sh` | Los rieles: formato corto, siguiente paso y reglas que el agente no puede saltarse. |
| `guard-test.sh` | El guard: qué comandos se bloquean y cuáles pasan (los casos están en `guard-cases.json`). |

Requisitos: `node`, `git`, `python3` y `curl`. Si una prueba falla por un puerto ocupado, corre
`pkill -f mock-server.mjs; pkill -f altum-mock.mjs` y vuelve a intentar.
