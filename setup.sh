#!/usr/bin/env bash
# Prepara el entorno: edge-tts, tipografía de subtítulos y permisos del CLI.
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ Comprobando Node"
node --version

echo "▶ Creando entorno de Python para edge-tts y miniatura"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet --upgrade edge-tts pillow

echo "▶ Descargando tipografías"
mkdir -p assets/fonts music
if [ ! -f assets/fonts/Montserrat-SemiBold.ttf ]; then
  curl -fsSL -o assets/fonts/Montserrat-SemiBold.ttf \
    "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-SemiBold.ttf" \
    || echo "  (no se pudo descargar Montserrat; se usará la fuente del sistema)"
fi
if [ ! -f assets/fonts/Montserrat-SemiBoldItalic.ttf ]; then
  curl -fsSL -o assets/fonts/Montserrat-SemiBoldItalic.ttf \
    "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-SemiBoldItalic.ttf" \
    || echo "  (no se pudo descargar Montserrat Italic)"
fi
if [ ! -f assets/fonts/Anton-Regular.ttf ]; then
  curl -fsSL -o assets/fonts/Anton-Regular.ttf \
    "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" \
    || echo "  (no se pudo descargar ANTON; se usará respaldo)"
fi

echo "▶ Preparando configuración local"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  creado .env (rellena las claves que quieras usar)"
fi

chmod +x bin/voicereceta

echo "▶ Diagnóstico"
node src/cli.js doctor
