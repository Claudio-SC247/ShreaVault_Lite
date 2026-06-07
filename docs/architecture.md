# Arquitectura del MVP

ShareVault Lite es una plataforma personal para compartir archivos mediante enlaces privados temporales. El MVP se limita a subir archivos, generar enlaces privados, definir expiracion, revocar acceso y visualizar archivos compartidos.

## Arbol de carpetas

```text
proyecto/
+-- apps/
|   +-- web/
|   |   +-- src/
|   |   |   +-- app/
|   |   |   |   +-- globals.css
|   |   |   |   +-- layout.tsx
|   |   |   |   +-- page.tsx
|   |   |   |   +-- share/
|   |   |   |       +-- [token]/
|   |   |   |           +-- page.tsx
|   |   |   +-- components/
|   |   |   |   +-- share-vault-app.tsx
|   |   |   |   +-- share-viewer.tsx
|   |   |   +-- lib/
|   |   |       +-- share.ts
|   |   |       +-- share.test.ts
|   |   +-- .env.example
|   |   +-- eslint.config.mjs
|   |   +-- next.config.ts
|   |   +-- package.json
|   |   +-- postcss.config.mjs
|   |   +-- tailwind.config.ts
|   |   +-- tsconfig.json
|   +-- worker/
|       +-- migrations/
|       |   +-- 0001_init.sql
|       +-- src/
|       |   +-- index.ts
|       |   +-- auth.ts
|       |   +-- cors.ts
|       |   +-- rate-limit.ts
|       |   +-- storage.ts
|       |   +-- validation.ts
|       |   +-- validation.test.ts
|       +-- eslint.config.mjs
|       +-- package.json
|       +-- tsconfig.json
|       +-- wrangler.toml
+-- docs/
|   +-- architecture.md
+-- agents.md
+-- package.json
+-- package-lock.json
+-- README.md
```

## Componentes

- Web app: Next.js 15 con TypeScript y Tailwind CSS. Es la interfaz operativa del MVP.
- API: Cloudflare Worker. Expone endpoints HTTP para archivos, enlaces, revocacion y descarga.
- Storage: Cloudflare R2. Guarda el binario de cada archivo usando una clave interna no expuesta.
- Base de datos: Cloudflare D1. Guarda metadatos, token privado, expiracion, estado de revocacion y clave R2.

## Modelo de datos

### Tabla `shares`

| Campo | Tipo | Reglas | Uso |
| --- | --- | --- | --- |
| `id` | `TEXT` | Primary key, UUID | Identificador interno del enlace |
| `token` | `TEXT` | Unico, aleatorio | Token privado usado en `/share/:token` |
| `file_name` | `TEXT` | Sanitizado | Nombre visible del archivo |
| `mime_type` | `TEXT` | Validado contra lista permitida | Tipo de contenido al servir el archivo |
| `size` | `INTEGER` | Mayor a 0, maximo 25 MB | Tamano del archivo |
| `object_key` | `TEXT` | No se expone al cliente | Ruta interna del objeto en R2 |
| `expires_at` | `INTEGER` | Timestamp Unix en ms | Fecha limite de acceso |
| `revoked_at` | `INTEGER NULL` | Null si esta activo | Marca de revocacion manual |
| `created_at` | `INTEGER` | Timestamp Unix en ms | Auditoria basica |
| `downloaded_at` | `INTEGER NULL` | Timestamp Unix en ms | Ultima visualizacion/descarga |

### Estado derivado

El estado no se persiste como columna para evitar inconsistencias:

- `active`: `revoked_at IS NULL` y `expires_at > now`.
- `expired`: `revoked_at IS NULL` y `expires_at <= now`.
- `revoked`: `revoked_at IS NOT NULL`.

### Objeto en R2

```text
shares/{shareId}/{safeFileName}
```

La clave R2 queda solo en D1. El cliente nunca recibe rutas internas de almacenamiento.

## Flujo de usuario

### Subir y compartir archivo

1. El usuario abre la app web.
2. Selecciona un archivo.
3. Selecciona una expiracion: 1 h, 24 h, 3 dias o 7 dias.
4. La web envia `multipart/form-data` al Worker.
5. El Worker valida tamano, tipo MIME y expiracion.
6. El Worker sanitiza el nombre del archivo.
7. El Worker guarda el binario en R2.
8. El Worker guarda los metadatos en D1.
9. El Worker devuelve el enlace privado.
10. La web muestra el enlace y refresca la lista.

### Visualizar archivo compartido

1. Una persona abre `/share/:token` en el frontend Next.js.
2. La pagina obtiene el archivo desde `GET /share/:token` del Worker (sin exponer `object_key`).
3. El Worker busca el token en D1 y valida expiracion/revocacion.
4. El Worker obtiene el objeto desde R2 y lo devuelve con headers seguros.
5. El frontend muestra vista previa para PDF, imagenes y texto; otros tipos ofrecen descarga.

### Eliminar enlace

1. El usuario confirma eliminacion en la lista.
2. La web llama `DELETE /api/shares/:id` con auth admin.
3. El Worker borra el objeto en R2 y la fila en D1.
4. La web refresca la lista.

### Revocar enlace

1. El usuario presiona revocar en la lista.
2. La web llama al endpoint de revocacion.
3. El Worker actualiza `revoked_at`.
4. La web refresca la lista.
5. Cualquier intento posterior de abrir el enlace devuelve `410 Gone`.

### Listar enlaces

1. La web llama `GET /api/shares?limit=50&cursor=<created_at>` con auth admin.
2. El Worker devuelve una pagina ordenada por `created_at DESC` y `nextCursor` si hay mas resultados.
3. El Worker calcula el estado derivado.
4. La web muestra archivo, tamano, expiracion, estado y acciones; permite cargar mas.

## Endpoints

### Autenticacion admin

Endpoints administrativos requieren:

```http
Authorization: Bearer <ADMIN_API_KEY>
```

Endpoints publicos: `GET /api/health`, `GET /share/:token`.

### `GET /api/health`

Comprueba que el Worker responde.

Respuesta `200`:

```json
{
  "ok": true
}
```

### `POST /api/files`

Crea un enlace privado temporal para un archivo. Requiere auth admin.

Request:

- `Content-Type: multipart/form-data`
- `file`: archivo obligatorio.
- `expiresInHours`: numero entre `1` y `168`.

Validaciones:

- Archivo no vacio.
- Tamano maximo: 25 MB.
- MIME permitido: PDF, DOCX, ZIP, JPEG, PNG, WEBP y texto plano.
- Expiracion entre 1 hora y 7 dias.
- Nombre de archivo sanitizado.

Respuesta `201`:

```json
{
  "share": {
    "id": "uuid",
    "fileName": "contrato.pdf",
    "mimeType": "application/pdf",
    "size": 120000,
    "expiresAt": "2026-06-04T01:00:00.000Z",
    "createdAt": "2026-06-03T01:00:00.000Z",
    "revokedAt": null,
    "status": "active",
    "shareUrl": "https://app.example.com/share/private-token"
  }
}
```

Errores:

- `401`: credenciales admin ausentes o invalidas.
- `400`: archivo invalido, tipo no permitido o expiracion invalida.
- `429`: rate limit excedido.
- `500`: error inesperado al persistir en R2 o D1.

### `GET /api/shares`

Lista enlaces con paginacion por cursor (`created_at`). Requiere auth admin.

Query params:

- `limit`: 1-100, default 50.
- `cursor`: timestamp `created_at` del ultimo item de la pagina anterior.

Respuesta `200`:

```json
{
  "shares": [
    {
      "id": "uuid",
      "fileName": "contrato.pdf",
      "mimeType": "application/pdf",
      "size": 120000,
      "expiresAt": "2026-06-04T01:00:00.000Z",
      "createdAt": "2026-06-03T01:00:00.000Z",
      "revokedAt": null,
      "status": "active",
      "shareUrl": "https://app.example.com/share/private-token"
    }
  ],
  "nextCursor": 1717376400000
}
```

### `POST /api/shares/:id/revoke`

Revoca un enlace por su `id` interno. Requiere auth admin.

Respuesta `200`:

```json
{
  "revokedAt": "2026-06-03T02:00:00.000Z"
}
```

Errores:

- `401`: no autorizado.
- `404`: enlace no encontrado.

### `DELETE /api/shares/:id`

Elimina el registro en D1 y el objeto en R2. Requiere auth admin.

Respuesta `200`:

```json
{
  "deleted": true
}
```

Errores:

- `401`: no autorizado.
- `404`: enlace no encontrado.

### `GET /share/:token`

Endpoint publico del Worker que sirve el archivo si el token existe, no expiro y no fue revocado.

Respuesta `200`:

- Body: binario del archivo.
- Headers:
  - `content-type`: MIME persistido.
  - `content-disposition`: nombre sanitizado.
  - `cache-control: private, no-store`.
  - `etag`: ETag del objeto R2.

Errores:

- `404`: token inexistente o archivo no disponible.
- `410`: enlace expirado o revocado.
- `429`: rate limit excedido.

## Reglas de seguridad

- No guardar secretos en codigo ni en el repositorio.
- Proteger endpoints administrativos con `ADMIN_API_KEY` via header `Authorization: Bearer`.
- Restringir CORS con `CORS_ORIGIN`; localhost permitido en desarrollo local.
- No exponer `object_key`, bucket, rutas internas ni configuracion Cloudflare al cliente.
- Sanitizar nombres de archivo antes de persistirlos.
- Validar tamano y MIME antes de escribir en R2.
- Usar tokens aleatorios de alta entropia para enlaces privados.
- Usar `cache-control: no-store` para respuestas sensibles.
- Rate limiting basico por IP para rutas admin y visualizacion publica.

## Variables y bindings

### Web

| Variable | Descripcion |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | URL publica del Worker |
| `NEXT_PUBLIC_ADMIN_API_KEY` | Clave admin para operaciones de panel |

### Worker

| Binding/Variable | Tipo | Descripcion |
| --- | --- | --- |
| `DB` | D1 | Base de datos de metadatos |
| `BUCKET` | R2 | Bucket de archivos |
| `PUBLIC_BASE_URL` | Variable | URL publica del frontend para construir `shareUrl` |
| `CORS_ORIGIN` | Variable | Origen permitido en produccion |
| `ADMIN_API_KEY` | Secreto | Clave para endpoints administrativos |
| `MAX_UPLOAD_BYTES` | Variable opcional | Limite configurable sin superar 25 MB |

## Fuera de alcance del MVP

- Autenticacion social.
- Pagos.
- Chat.
- Notificaciones.
- Carpetas, equipos o permisos granulares.
- Antivirus o escaneo avanzado de contenido.
- Historial completo de auditoria.
