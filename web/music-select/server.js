#!/usr/bin/env node
/**
 * Landing web para selección de música antes de renderizar
 * Se ejecuta como: node server.js <slug>
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

const slug = process.argv[2];
if (!slug) {
  console.error('Uso: node server.js <slug>');
  process.exit(1);
}

const paths = {
  music: resolve(ROOT, 'work', slug, 'music'),
  musicChoice: resolve(ROOT, 'work', slug, 'music.json'),
  script: resolve(ROOT, 'work', slug, 'script.json'),
};

// Cargar guion para mostrar info
let script = null;
try {
  script = JSON.parse(readFileSync(paths.script, 'utf8'));
} catch {
  script = { title: slug, scenes: [] };
}

// Cargar música ya elegida si existe
let chosenMusic = null;
try {
  chosenMusic = JSON.parse(readFileSync(paths.musicChoice, 'utf8'));
} catch {}

/**
 * POST /api/music/candidates
 * Obtiene candidatos de música para la receta
 */
app.post('/api/music/candidates', async (req, res) => {
  try {
    // Ejecutar búsqueda de música via CLI
    const result = await runCli('music', [slug, '--list-only']);
    const lines = result.stdout.trim().split('\n').filter(l => l.trim());
    const candidates = [];
    
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\.\s+(.+?)\s+—\s+(.+?)\s+·\s+(\d+):(\d+)\s+·\s+(.+?)\s+·\s+(.+)$/);
      if (match) {
        candidates.push({
          index: parseInt(match[1]),
          title: match[2].trim(),
          artist: match[3].trim(),
          duration: `${match[4]}:${match[5].padStart(2, '0')}`,
          genre: match[6].trim(),
          provider: match[7].trim(),
        });
      }
    }
    
    res.json({ candidates, chosen: chosenMusic?.track?.title || null });
  } catch (error) {
    console.error('Error getting candidates:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/music/preview
 * Previsualiza una pista
 */
app.post('/api/music/preview', async (req, res) => {
  const { index } = req.body;
  try {
    await runCli('music', [slug, '--choose', String(index + 1)]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/music/choose
 * Guarda la selección y lanza render
 */
app.post('/api/music/choose', async (req, res) => {
  const { index } = req.body;
  try {
    // Elegir la música
    await runCli('music', [slug, '--choose', String(index + 1)]);
    
    // Lanzar render en background
    const renderProcess = spawn('node', ['src/cli.js', 'render', slug, '--no-music'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    });
    renderProcess.unref();
    
    res.json({ ok: true, message: 'Render iniciado en background' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/status
 * Estado del render
 */
app.get('/api/status', async (req, res) => {
  try {
    const outputFile = resolve(ROOT, 'out', `${slug}.mp4`);
    const stats = await import('fs').then(fs => fs.promises.stat(outputFile).catch(() => null));
    res.json({ 
      done: !!stats,
      size: stats?.size || 0,
      path: outputFile,
    });
  } catch {
    res.json({ done: false });
  }
});

function runCli(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['src/cli.js', command, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `Exit code ${code}`));
    });
  });
}

const PORT = 3456;
app.listen(PORT, () => {
  console.log(`🎵 Music Selector para "${script.title}"`);
  console.log(`   Abre: http://localhost:${PORT}`);
  console.log(`   Slug: ${slug}`);
});

export default app;