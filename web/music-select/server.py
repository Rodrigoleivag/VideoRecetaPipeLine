#!/usr/bin/env python3
"""
Landing web para selección de música antes de renderizar.
Uso: python server.py <slug> [--port PORT]
"""

import sys
import os
import json
import subprocess
import threading
import time
import re
import asyncio
import urllib.request
import urllib.error
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import mimetypes

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')

# ─── Configuración ───
if len(sys.argv) < 2:
    print("Uso: python server.py <slug> [--port PORT]")
    sys.exit(1)

SLUG = sys.argv[1]
PORT = 3456
if '--port' in sys.argv:
    PORT = int(sys.argv[sys.argv.index('--port') + 1])

ROOT = Path(__file__).parent.parent.parent
WORK_DIR = ROOT / 'work' / SLUG
PUBLIC_DIR = Path(__file__).parent / 'public'

# ─── Utilidades CLI ───
def run_cli(command, args, timeout=120):
    """Ejecuta el CLI y devuelve stdout."""
    cmd = ['node', 'src/cli.js', command, *args]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"CLI error ({result.returncode}): {result.stderr}")
    return result.stdout

def _track_is_available(track):
    """Comprueba si el audio existe sin descargar la canción completa."""
    url = track.get('previewUrl') or track.get('url')
    if not url:
        return False

    request = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0',
            'Range': 'bytes=0-0'
        }
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status in (200, 206)

    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return False
        return True

    except Exception:
        # Si hay un problema temporal de conexión, no descartamos la pista.
        return True

_MUSIC_CANDIDATES = {}

def get_music_candidates(slug):
    """Obtiene el catálogo y devuelve solamente pistas disponibles."""
    if slug not in _MUSIC_CANDIDATES:
        out = run_cli('music', [slug, '--json'])
        candidates = json.loads(out.strip().splitlines()[-1])

        available = []

        for index, track in enumerate(candidates):
            track['index'] = index

            if _track_is_available(track):
                available.append(track)
            else:
                print(
                    f"Pista descartada (audio no disponible): {track.get('title')}",
                    file=sys.stderr
                )

        _MUSIC_CANDIDATES[slug] = available

    return _MUSIC_CANDIDATES[slug]

def preview_track(slug, index):
    """Descarga la pista usando su URL directa, sin repetir búsquedas."""
    candidates = get_music_candidates(slug)

    if index < 0 or index >= len(candidates):
        return None

    track = candidates[index]
    preview_url = track.get('previewUrl') or track.get('url')

    if not preview_url:
        return None

    preview_dir = ROOT / 'work' / slug / 'cache' / 'music-preview'
    preview_dir.mkdir(parents=True, exist_ok=True)

    provider = re.sub(r'[^\\w.-]', '_', track.get('provider', 'track'))
    track_id = re.sub(r'[^\\w.-]', '_', str(track.get('id') or index))
    preview_file = preview_dir / f'{provider}-{track_id}.mp3'

    if preview_file.exists() and preview_file.stat().st_size > 0:
        return preview_file

    try:
        request = urllib.request.Request(
            preview_url,
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            with open(preview_file, 'wb') as output:
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)

        if preview_file.exists() and preview_file.stat().st_size > 0:
            return preview_file

    except Exception as e:
        print(f"Error descargando preview: {e}", file=sys.stderr)
        if preview_file.exists():
            preview_file.unlink()

    return None

def choose_and_render(slug, index):
    """Elige una pista visible respetando su índice original y lanza el render."""
    candidates = get_music_candidates(slug)

    if index < 0 or index >= len(candidates):
        raise ValueError('Índice de pista inválido')

    original_index = candidates[index]['index']

    run_cli('music', [slug, '--choose', str(original_index + 1)])

    subprocess.Popen(
        ['node', 'src/cli.js', 'render', slug, '--no-music'],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )

# ─── HTTP Handler ───
class MusicHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_GET(self):
        if self.path == '/api/music/candidates':
            self.send_json({'candidates': get_music_candidates(SLUG)})
        elif self.path.startswith('/api/music/preview'):
            qs = parse_qs(urlparse(self.path).query)
            index = int(qs.get('index', [0])[0])
            track_path = preview_track(SLUG, index)
            if track_path and track_path.exists():
                file_size = track_path.stat().st_size
                range_header = self.headers.get('Range')
                start, end = 0, file_size - 1
                status = 200

                if range_header:
                    try:
                        unit, value = range_header.split('=', 1)
                        if unit.strip() != 'bytes' or ',' in value:
                            raise ValueError('Unsupported range')

                        first, last = value.strip().split('-', 1)

                        if first:
                            start = int(first)
                            end = int(last) if last else file_size - 1
                        else:
                            suffix_length = int(last)
                            start = max(0, file_size - suffix_length)
                            end = file_size - 1

                        if start < 0 or start >= file_size or end < start:
                            raise ValueError('Invalid range')

                        end = min(end, file_size - 1)
                        status = 206
                    except (ValueError, TypeError):
                        self.send_response(416)
                        self.send_header('Content-Range', f'bytes */{file_size}')
                        self.end_headers()
                        return

                content_length = end - start + 1
                self.send_response(status)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(content_length))
                self.send_header('Accept-Ranges', 'bytes')

                if status == 206:
                    self.send_header(
                        'Content-Range',
                        f'bytes {start}-{end}/{file_size}'
                    )

                self.end_headers()

                try:
                    with open(track_path, 'rb') as audio_file:
                        audio_file.seek(start)
                        remaining = content_length

                        while remaining > 0:
                            chunk = audio_file.read(min(64 * 1024, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)

                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.send_error(404, 'Track not found')
        elif self.path == '/api/status':
            output = ROOT / 'out' / f'{SLUG}.mp4'
            done = output.exists() and output.stat().st_size > 100000
            self.send_json({'done': done, 'size': output.stat().st_size if done else 0})
        elif self.path == '/' or self.path == '/index.html':
            # Servir index.html con el slug reemplazado
            index_path = PUBLIC_DIR / 'index.html'
            if index_path.exists():
                content = index_path.read_text(encoding='utf-8')
                content = content.replace('{{SLUG}}', SLUG)
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(content.encode('utf-8'))
            else:
                self.send_error(404, 'index.html not found')
        else:
            # Servir archivos estáticos
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/music/choose':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode()
            data = json.loads(body)
            index = data.get('index', 0)
            try:
                threading.Thread(target=choose_and_render, args=(SLUG, index), daemon=True).start()
                self.send_json({'ok': True, 'message': 'Render iniciado en background'})
            except Exception as e:
                self.send_error(500, str(e))
        elif path == '/api/music/candidates':
            self.send_json({'candidates': get_music_candidates(SLUG)})
        elif path == '/api/music/preview':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode()
            data = json.loads(body)
            index = data.get('index', 0)
            track_path = preview_track(SLUG, index)
            if track_path and track_path.exists():
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(track_path.stat().st_size))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                with open(track_path, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, 'Track not found')
        else:
            self.send_error(404)

    def send_json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

# ─── Main ───
if __name__ == '__main__':
    print(f"🎵 Music Selector para \"{SLUG}\"")
    print(f"   Abre: http://localhost:{PORT}")
    print(f"   Slug: {SLUG}")
    print(f"   Directorio de trabajo: {WORK_DIR}")

    os.chdir(ROOT)
    server = HTTPServer(('', PORT), MusicHandler)
    print(f"🚀 Servidor iniciado en http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Servidor detenido")