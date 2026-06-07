# ShareVault Lite

MVP personal para compartir archivos mediante enlaces privados temporales. El proyecto esta dividido en:

- `apps/web`: interfaz Next.js 15 con TypeScript y Tailwind CSS.
- `apps/worker`: API en Cloudflare Workers con Cloudflare R2 para archivos y D1 para metadatos.

## Alcance MVP

- Subir archivos validados por tamano y tipo.
- Generar enlaces privados temporales.
- Establecer expiracion por 1 h, 24 h, 3 dias o 7 dias.
- Revocar acceso.
- Eliminar enlaces y archivos asociados.
- Visualizar archivos compartidos desde la pagina `/share/:token`.

No incluye autenticacion social, pagos, chat ni notificaciones.

## Requisitos

- Node.js 20 o superior.
- Cuenta de Cloudflare con Workers, R2 y D1 habilitados.

## Desarrollo local

```bash
npm install
npm run dev
```

La API local queda en `http://localhost:8787` y guarda datos temporales en `apps/worker/.local`. La web queda normalmente en `http://localhost:3000`.

`npm run dev` levanta API y web juntas. Si necesitas procesos separados, usa `npm run dev:api-local` y `npm run dev:web`.

`npm run dev:api-local` usa un servidor local compatible con el Worker para probar el MVP sin depender de R2/D1 reales. `npm run dev:worker` queda disponible para probar con Wrangler y recursos de Cloudflare.

### Variables de entorno (web)

Copia `apps/web/.env.example` a `apps/web/.env.local`:

| Variable | Descripcion |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | URL del Worker/API (`http://localhost:8787` en local) |
| `NEXT_PUBLIC_ADMIN_API_KEY` | Clave admin enviada como `Authorization: Bearer ...` |

En local, el servidor embebido usa `dev-admin-key` por defecto si no defines otra clave.

### Variables de entorno (worker)

| Variable | Descripcion |
| --- | --- |
| `PUBLIC_BASE_URL` | URL publica del frontend usada para construir `shareUrl` |
| `CORS_ORIGIN` | Origen permitido en produccion (localhost siempre permitido en dev) |
| `ADMIN_API_KEY` | Secreto para endpoints administrativos |
| `MAX_UPLOAD_BYTES` | Limite configurable (maximo 25 MB) |

Para validar el flujo local principal con la API encendida:

```bash
npm run smoke:local
```

## Verificacion

```bash
npm run lint
npm run build
npm run test
```

## Despliegue

1. Crear recursos Cloudflare:

```bash
npx wrangler d1 create sharevault-lite
npx wrangler r2 bucket create sharevault-lite-files
```

2. Copiar el `database_id` generado en `apps/worker/wrangler.toml` (reemplaza el UUID de desarrollo).

3. Configurar variables en `apps/worker/wrangler.toml`:

- `PUBLIC_BASE_URL`: URL del frontend desplegado (ej. `https://app.tudominio.com`).
- `CORS_ORIGIN`: mismo origen del frontend.

4. Configurar el secreto admin del Worker:

```bash
cd apps/worker
npx wrangler secret put ADMIN_API_KEY
```

5. Aplicar la migracion:

```bash
npx wrangler d1 migrations apply sharevault-lite --remote
```

6. Desplegar el Worker:

```bash
npm run deploy --workspace @sharevault/worker
```

7. Configurar el frontend:

- `NEXT_PUBLIC_API_BASE_URL`: URL del Worker desplegado.
- `NEXT_PUBLIC_ADMIN_API_KEY`: misma clave definida como secreto en el Worker.

8. Desplegar el frontend Next.js en el proveedor elegido.

## Seguridad

- Endpoints administrativos (`POST /api/files`, `GET /api/shares`, revocar, eliminar) requieren `Authorization: Bearer <ADMIN_API_KEY>`.
- `GET /api/health` y `GET /share/:token` permanecen publicos para visitantes.
- CORS restringido por `CORS_ORIGIN`; no se usa `*` en produccion.
- El Worker valida tamano y tipo MIME antes de guardar en R2.
- Los nombres de archivo se sanitizan antes de persistirlos.
- Los enlaces usan tokens aleatorios y no exponen claves internas de R2.
- Los secretos no se guardan en el repositorio.
