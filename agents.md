# AGENTS.md

## Proyecto

Plataforma personal de compartición de archivos mediante enlaces privados temporales.

## Objetivo

Construir un MVP funcional que permita:

- Subir archivos.
- Generar enlaces privados.
- Establecer expiración.
- Revocar acceso.
- Visualizar archivos compartidos.

## Stack obligatorio

Frontend:
- Next.js 15
- TypeScript
- Tailwind CSS

Backend:
- Cloudflare Workers

Storage:
- Cloudflare R2

Base de datos:
- Cloudflare D1

## Restricciones

- No implementar funcionalidades fuera del alcance MVP.
- No añadir autenticación social.
- No añadir pagos.
- No añadir chat.
- No añadir notificaciones.

## Seguridad

- Validar tamaño y tipo de archivo.
- Sanitizar entradas.
- No exponer rutas internas.
- No almacenar secretos en código.

## Definición de terminado

Una tarea se considera terminada cuando:

- Compila sin errores.
- Pasa lint.
- Pasa tests.
- Incluye instrucciones de despliegue.
- Incluye documentación mínima.

## Comandos

npm install
npm run dev
npm run lint
npm run build
npm run test