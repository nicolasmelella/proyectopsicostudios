#!/usr/bin/env bash
# Crea una base vacía en un Postgres local y corre 01 + 03 + pruebas.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./pruebas/correr_pruebas.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c 'drop database if exists psicostudios_prueba' -c 'create database psicostudios_prueba'
psql -q -d psicostudios_prueba -v ON_ERROR_STOP=1 \
  -f pruebas/simular_supabase.sql \
  -f supabase/01_base.sql \
  -f pruebas/probar.sql \
  -f pruebas/probar_mercadopago.sql \
  -f pruebas/probar_calendario.sql \
  -f pruebas/probar_pedidos.sql \
  -f pruebas/probar_comprobantes.sql \
  -f pruebas/probar_avisos.sql \
  -f pruebas/probar_semana.sql \
  -f pruebas/probar_cobros.sql \
  -f pruebas/probar_comentarios.sql \
  -f pruebas/probar_tablero.sql \
  -f pruebas/probar_equipo.sql \
  -f pruebas/probar_permisos.sql \
  -f pruebas/probar_cancelar_pedido.sql \
  -f pruebas/probar_pagos_completos.sql
node --experimental-strip-types --no-warnings pruebas/probar_funciones.mjs
node --experimental-strip-types --no-warnings pruebas/probar_envio_avisos.mjs
node --experimental-strip-types --no-warnings pruebas/probar_equipo_admin.mjs
