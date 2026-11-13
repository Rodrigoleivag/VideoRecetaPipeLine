# VideoRecetaPipeLine

**Turn a recipe URL into a narrated, YouTube-ready video.**  
**Convierte una URL de receta en un vídeo narrado, listo para YouTube.**

A modular Node.js pipeline that extracts recipes from websites, generates narration scripts, finds food-related visuals, synthesizes voice-over, creates word-synchronized subtitles, selects music, and renders a finished video.

Un pipeline modular en Node.js que extrae recetas desde sitios web, genera guiones narrados, busca imágenes relacionadas con la gastronomía, sintetiza la voz, crea subtítulos sincronizados palabra por palabra, selecciona música y renderiza un vídeo terminado.

---

# English

## Features

- **Recipe extraction:** Reads recipe information from website structured data (`schema.org/Recipe`).
- **Script generation:** Creates narrated scripts using a template engine or an optional DeepSeek LLM integration.
- **Visual asset discovery:** Uses original recipe images when available and searches external image providers when needed.
- **Ingredient-aware image selection:** Uses ingredient names and cooking techniques to find relevant visuals.
- **AI-ready architecture:** Includes an optional AI video clips configuration, disabled by default.
- **Text-to-speech:** Supports Microsoft Edge TTS and Azure Speech.
- **Word-level synchronization:** Uses speech boundary timestamps to synchronize narration and subtitles.
- **Subtitle rendering:** Generates ASS subtitles with configurable typography and word highlighting.
- **Music discovery:** Searches Jamendo, Internet Archive and local music files.
- **Music preview and selection:** Allows users to listen to candidate tracks before rendering.
- **Audio processing:** Includes voice normalization, limiting, music fades and automatic music ducking.
- **YouTube assets:** Generates thumbnails and SEO-oriented video descriptions.
- **Caching:** Stores intermediate files to avoid repeating completed processing steps.

## Output specifications

| Component | Default configuration |
|---|---|
| Video resolution | 1920 × 1080 (Full HD) |
| Frame rate | 30 FPS |
| Video codec | H.264 (`libx264`) |
| Audio codec | AAC, 192 kbps |
| Audio sample rate | 48 kHz |
| Narration target | -16 LUFS |
| True peak limit | -1.5 dB |
| Subtitles | ASS, burned into video |
| Subtitle font | Montserrat SemiBold |
| Default voice | `es-ES-AlvaroNeural` |
| Default script duration | Approximately 4 minutes |

## Architecture

```text
VideoRecetaPipeLine/
│
├── bin/
│   └── voicereceta
│
├── config/
│   ├── pipeline.json
│   ├── voices.json
│   └── ingredients.json
│
├── assets/
│   └── fonts/
│
├── scripts/
│   ├── edge_tts_bridge.py
│   └── make_thumbnail.py
│
├── src/
│   ├── ai/              # Optional AI video integrations
│   ├── assets/          # Image discovery and processing
│   ├── music/           # Music search and selection
│   ├── recipe/          # Recipe extraction and parsing
│   ├── script/          # Narration script generation
│   ├── subs/            # Subtitle generation
│   ├── tts/             # Text-to-speech providers
│   ├── util/            # Shared utilities
│   └── video/           # Timeline and video rendering
│
├── web/
│   └── music-select/    # Browser-based music selector
│
├── work/                # Intermediate files and recipe cache
├── out/                 # Final rendered videos
│
├── .env.example
├── package.json
├── setup.sh
└── README.md
```

## Requirements

- Node.js 22 or newer.
- Python 3.
- FFmpeg and FFprobe.
- `curl`.
- Internet connection for recipe extraction, external images, TTS and online music catalogs.

The root Node.js project currently has no declared npm dependencies. Python packages and fonts are prepared by the setup script.

## Installation

Clone the repository and enter the project directory:

```bash
git clone <YOUR_REPOSITORY_URL>
cd VideoRecetaPipeLine
```

Run the setup script:

```bash
chmod +x setup.sh
./setup.sh
```

The setup script:

1. Checks the Node.js installation.
2. Creates a Python virtual environment in `.venv`.
3. Installs `edge-tts` and `pillow`.
4. Downloads the required fonts when they are missing.
5. Creates `.env` from `.env.example` if necessary.
6. Makes the CLI executable.
7. Runs the environment diagnostic.

**Important:** FFmpeg and FFprobe must be installed separately. The setup script does not install them.

## Configuration

Copy `.env.example` to `.env` if the setup script has not already created it.

Configure only the services you intend to use:

| Variable | Purpose | Required |
|---|---|---|
| `DEEPSEEK_API_KEY` | LLM-based script generation | Optional |
| `AZURE_SPEECH_KEY` | Azure Speech voice synthesis | Optional |
| `AZURE_SPEECH_REGION` | Azure Speech region | Optional |
| `JAMENDO_CLIENT_ID` | Jamendo music catalog | Optional |
| `PEXELS_API_KEY` | Pexels image provider | Optional |

Edge TTS works without an Azure key. Without a DeepSeek key, the pipeline can use its built-in template script generator.

Wikimedia Commons, Openverse, Foodish and Internet Archive integrations do not require the API keys listed above.

## Usage

Run the complete pipeline:

```bash
./bin/voicereceta run "https://example.com/recipe"
```

The pipeline performs the following stages:

1. Extract recipe information.
2. Generate the narration script.
3. Discover and download visual assets.
4. Synthesize voice-over.
5. Generate synchronized subtitles.
6. Search and select background music.
7. Render the final video.

### Individual commands

| Command | Description |
|---|---|
| `doctor` | Check environment and service availability |
| `extract <url>` | Extract recipe information |
| `script <url\|slug>` | Generate narration script |
| `assets <slug>` | Resolve and download images |
| `narrate <slug>` | Generate voice-over and subtitles |
| `voice list` | List available voices |
| `voice preview` | Preview a voice |
| `music <url\|slug>` | Search and select music |
| `render <slug>` | Render the final video |
| `fix-image <slug> <scene>` | Replace an image in a scene |
| `seo-desc <slug>` | Generate a YouTube SEO description |
| `thumbnail <slug>` | Generate a video thumbnail |

Examples:

```bash
./bin/voicereceta doctor
```

```bash
./bin/voicereceta extract "https://example.com/recipe"
```

```bash
./bin/voicereceta voice list
```

```bash
./bin/voicereceta music my-recipe --pick
```

```bash
./bin/voicereceta render my-recipe
```

### Common options

| Option | Description |
|---|---|
| `--voice <id>` | Select narration voice |
| `--preset <name>` | Voice preset: `estandar`, `grave`, `profundo`, `pausado`, `energico` |
| `--tone <name>` | Script tone: `cercano`, `divertido`, `elegante`, `directo` |
| `--minutes <n>` | Target script duration |
| `--script <provider>` | `template` or `llm` |
| `--music <query>` | Force a music search |
| `--choose <n>` | Select a music candidate by number |
| `--pick` | Interactively select music |
| `--no-music` | Render without background music |
| `--no-subs` | Disable subtitles |
| `--force` | Reprocess previously generated stages |
| `--refresh` | Download the recipe page again |
| `--verbose` | Enable detailed logs |

## Recipe extraction

The extractor reads structured recipe information from `schema.org/Recipe` JSON-LD data embedded in the source website.

It extracts, when available:

- Recipe title and description.
- Author and source website.
- Cuisine and category.
- Preparation and cooking times.
- Servings.
- Ingredients.
- Preparation steps.
- Original recipe images.

**Compatibility note:** The source website must expose readable `schema.org/Recipe` structured data and recipe instructions. Pages without this data or without readable preparation steps cannot be processed by the current extractor.

Recipe pages are cached under `work/_pages`. Use `--refresh` to download the page again.

## Image discovery

The image resolution system combines original recipe images with external image providers.

Configured providers:

- Foodish
- Wikimedia Commons
- Openverse
- Pexels

The system prioritizes ingredient-specific searches for ingredient scenes. Other scenes use the configured provider order.

Images are ranked using text relevance and food-related context. Irrelevant results are filtered when possible.

Downloaded images are converted to a consistent 1920 × 1080 JPEG format. If no suitable image is found, the pipeline can generate a text-based placeholder.

Image attribution information is stored in:

```text
work/<recipe-slug>/images/credits.json
work/<recipe-slug>/creditos.txt
```

## Voice and subtitles

The pipeline supports:

- Microsoft Edge TTS.
- Azure Speech.

The default configuration uses Edge TTS with the Spanish voice `es-ES-AlvaroNeural`.

Each scene is synthesized separately. Word boundary timestamps are used to align narration text with actual speech timing.

The alignment process handles differences between written and spoken forms, including numbers and compound expressions. When the provider does not return usable word boundaries, the system estimates timing proportionally and reports approximate alignment.

Audio is converted to 48 kHz mono PCM WAV for consistent processing.

Subtitles are generated in ASS format and burned into the final video. Their appearance, font, margins, line length and highlighted word color are configurable.

## Music selection and licensing

The music system searches:

1. The configured primary provider, normally Jamendo.
2. Jamendo.
3. Internet Archive.
4. Local music files.

It derives search queries from the recipe title, cuisine, category and ingredients. The system also uses configurable mood-to-genre mappings.

Users can preview candidate tracks and select one interactively or by number.

Music attribution is saved with the selected track and can be included in the YouTube description.

**Licensing warning:** Not every available track is suitable for commercial use or monetized YouTube videos. The pipeline ranks licenses and warns about potentially restricted tracks, but users must independently verify the exact license and attribution requirements before publishing or monetizing content.

## Browser-based music selector

A lightweight Python HTTP server provides a browser interface for previewing and selecting music.

Start it with:

```bash
python3 web/music-select/server.py <recipe-slug>
```

Open:

```text
http://localhost:3456
```

The interface retrieves music candidates, checks preview availability, allows playback and selection, and triggers the final rendering process.

## Output structure

Each recipe has its own workspace:

```text
work/<recipe-slug>/
├── recipe.json
├── script.json
├── scenes/
├── images/
├── audio/
├── clips/
├── music/
├── cache/
├── music.json
├── narration.wav
└── subtitles.ass
```

The final rendered video is saved as:

```text
out/<recipe-slug>.mp4
```

Additional generated assets can include:

- `thumbnail.jpg`
- `descripcion.txt`
- `descripcion_seo.txt`
- `creditos.txt`
- `visuals.mp4`

The workspace also contains intermediate files and cached assets used by the pipeline.

## Diagnostics

Run:

```bash
npm run doctor
```

The diagnostic checks Node.js, FFmpeg, FFprobe, Python, Edge TTS, fonts, optional API keys and selected external services.

---

# Español

## Características

- **Extracción de recetas:** obtiene información desde datos estructurados `schema.org/Recipe`.
- **Generación de guiones:** crea guiones narrados mediante plantillas o integración opcional con DeepSeek.
- **Búsqueda de imágenes:** aprovecha fotografías originales de la receta y proveedores externos.
- **Imágenes según ingredientes:** utiliza nombres de ingredientes y técnicas de cocina para buscar imágenes relevantes.
- **Arquitectura preparada para IA:** incluye configuración para clips de vídeo generados por IA, desactivada por defecto.
- **Texto a voz:** soporta Microsoft Edge TTS y Azure Speech.
- **Sincronización palabra por palabra:** utiliza marcas temporales de voz para sincronizar narración y subtítulos.
- **Subtítulos:** genera subtítulos ASS con tipografía configurable y resaltado de palabras.
- **Búsqueda musical:** consulta Jamendo, Internet Archive y archivos musicales locales.
- **Previsualización musical:** permite escuchar y seleccionar pistas antes del montaje.
- **Procesamiento de audio:** normalización de voz, limitación de picos, transiciones musicales y reducción automática de música durante la narración.
- **Recursos para YouTube:** genera miniaturas y descripciones optimizadas para SEO.
- **Caché:** conserva archivos intermedios para evitar repetir etapas ya procesadas.

## Especificaciones de salida

| Componente | Configuración predeterminada |
|---|---|
| Resolución | 1920 × 1080 (Full HD) |
| Fotogramas por segundo | 30 FPS |
| Códec de vídeo | H.264 (`libx264`) |
| Códec de audio | AAC, 192 kbps |
| Frecuencia de audio | 48 kHz |
| Sonoridad objetivo | -16 LUFS |
| Pico máximo | -1,5 dB |
| Subtítulos | ASS integrados en el vídeo |
| Tipografía | Montserrat SemiBold |
| Voz predeterminada | `es-ES-AlvaroNeural` |
| Duración del guion | Aproximadamente 4 minutos |

## Arquitectura

```text
VideoRecetaPipeLine/
│
├── bin/
│   └── voicereceta
│
├── config/
│   ├── pipeline.json
│   ├── voices.json
│   └── ingredients.json
│
├── assets/
│   └── fonts/
│
├── scripts/
│   ├── edge_tts_bridge.py
│   └── make_thumbnail.py
│
├── src/
│   ├── ai/              # Integraciones opcionales de vídeo con IA
│   ├── assets/          # Búsqueda y procesamiento de imágenes
│   ├── music/           # Búsqueda y selección musical
│   ├── recipe/          # Extracción y análisis de recetas
│   ├── script/          # Generación de guiones
│   ├── subs/            # Generación de subtítulos
│   ├── tts/             # Proveedores de texto a voz
│   ├── util/            # Utilidades compartidas
│   └── video/           # Timeline y renderizado
│
├── web/
│   └── music-select/    # Selector musical desde el navegador
│
├── work/                # Archivos intermedios y caché
├── out/                 # Vídeos finales
│
├── .env.example
├── package.json
├── setup.sh
└── README.md
```

## Requisitos

- Node.js 22 o superior.
- Python 3.
- FFmpeg y FFprobe.
- `curl`.
- Conexión a Internet para extraer recetas, buscar imágenes, utilizar TTS y consultar catálogos musicales.

El proyecto principal de Node.js no declara dependencias npm. Los paquetes de Python y las tipografías se preparan mediante el script de instalación.

## Instalación

Clonar el repositorio y entrar en el directorio:

```bash
git clone <YOUR_REPOSITORY_URL>
cd VideoRecetaPipeLine
```

Ejecutar el instalador:

```bash
chmod +x setup.sh
./setup.sh
```

El instalador:

1. Comprueba la instalación de Node.js.
2. Crea un entorno virtual de Python en `.venv`.
3. Instala `edge-tts` y `pillow`.
4. Descarga las tipografías necesarias cuando no están disponibles.
5. Crea `.env` a partir de `.env.example`, si no existe.
6. Habilita la ejecución del CLI.
7. Ejecuta el diagnóstico del entorno.

**Importante:** FFmpeg y FFprobe deben instalarse por separado. El instalador no los instala.

## Configuración

Si el instalador no creó el archivo `.env`, copia `.env.example` y configura los servicios que quieras utilizar:

| Variable | Propósito | Obligatoria |
|---|---|---|
| `DEEPSEEK_API_KEY` | Generación de guiones con LLM | No |
| `AZURE_SPEECH_KEY` | Síntesis de voz con Azure | No |
| `AZURE_SPEECH_REGION` | Región de Azure Speech | No |
| `JAMENDO_CLIENT_ID` | Catálogo musical Jamendo | No |
| `PEXELS_API_KEY` | Proveedor de imágenes Pexels | No |

Edge TTS funciona sin una clave de Azure. Si no se configura DeepSeek, se utiliza el generador de guiones basado en plantillas.

Wikimedia Commons, Openverse, Foodish e Internet Archive no necesitan las claves API indicadas anteriormente.

## Uso

Ejecutar el pipeline completo:

```bash
./bin/voicereceta run "https://example.com/recipe"
```

El proceso ejecuta las siguientes etapas:

1. Extrae la información de la receta.
2. Genera el guion narrado.
3. Busca y descarga recursos visuales.
4. Sintetiza la voz.
5. Genera subtítulos sincronizados.
6. Busca y permite seleccionar música de fondo.
7. Renderiza el vídeo final.

### Comandos individuales

| Comando | Descripción |
|---|---|
| `doctor` | Comprueba el entorno y los servicios |
| `extract <url>` | Extrae los datos de la receta |
| `script <url\|slug>` | Genera el guion |
| `assets <slug>` | Busca y descarga imágenes |
| `narrate <slug>` | Genera voz y subtítulos |
| `voice list` | Lista las voces disponibles |
| `voice preview` | Previsualiza una voz |
| `music <url\|slug>` | Busca y selecciona música |
| `render <slug>` | Renderiza el vídeo final |
| `fix-image <slug> <scene>` | Reemplaza una imagen de una escena |
| `seo-desc <slug>` | Genera una descripción SEO |
| `thumbnail <slug>` | Genera una miniatura |

Ejemplos:

```bash
./bin/voicereceta doctor
```

```bash
./bin/voicereceta extract "https://example.com/recipe"
```

```bash
./bin/voicereceta voice list
```

```bash
./bin/voicereceta music mi-receta --pick
```

```bash
./bin/voicereceta render mi-receta
```

### Opciones habituales

| Opción | Descripción |
|---|---|
| `--voice <id>` | Selecciona la voz del narrador |
| `--preset <name>` | Preset: `estandar`, `grave`, `profundo`, `pausado`, `energico` |
| `--tone <name>` | Tono: `cercano`, `divertido`, `elegante`, `directo` |
| `--minutes <n>` | Duración objetivo del guion |
| `--script <provider>` | `template` o `llm` |
| `--music <query>` | Fuerza una búsqueda musical |
| `--choose <n>` | Selecciona una pista por número |
| `--pick` | Permite seleccionar música interactivamente |
| `--no-music` | Genera el vídeo sin música |
| `--no-subs` | Desactiva los subtítulos |
| `--force` | Reprocesa etapas ya generadas |
| `--refresh` | Descarga nuevamente la página de la receta |
| `--verbose` | Activa registros detallados |

## Extracción de recetas

El extractor obtiene información desde los datos estructurados JSON-LD `schema.org/Recipe` que estén incorporados en la página de origen.

Cuando están disponibles, extrae:

- Nombre y descripción de la receta.
- Autor y sitio web de origen.
- Tipo de cocina y categoría.
- Tiempos de preparación y cocción.
- Porciones.
- Ingredientes.
- Pasos de preparación.
- Imágenes originales de la receta.

**Compatibilidad:** el sitio web debe exponer datos estructurados `schema.org/Recipe` legibles e instrucciones de preparación. Las páginas que no ofrecen esos datos o no contienen pasos legibles no pueden procesarse con el extractor actual.

Las páginas se almacenan en caché en `work/_pages`. Utiliza `--refresh` para volver a descargarlas.

## Búsqueda de imágenes

El sistema combina las imágenes originales de la receta con proveedores externos.

Proveedores configurados:

- Foodish.
- Wikimedia Commons.
- Openverse.
- Pexels.

Las escenas de ingredientes tienen prioridad de búsqueda específica por ingrediente. Para el resto de las escenas se utiliza el orden configurado en el pipeline.

Las imágenes se clasifican según la coincidencia con los términos de búsqueda y su contexto gastronómico. Se filtran resultados irrelevantes cuando es posible.

Las imágenes descargadas se convierten a formato JPEG de 1920 × 1080. Si no se encuentra una imagen adecuada, el pipeline puede generar una imagen de reemplazo con texto.

La información de atribución queda almacenada en:

```text
work/<recipe-slug>/images/credits.json
work/<recipe-slug>/creditos.txt
```

## Voz y subtítulos

El pipeline soporta:

- Microsoft Edge TTS.
- Azure Speech.

La configuración predeterminada utiliza Edge TTS con la voz española `es-ES-AlvaroNeural`.

Cada escena se sintetiza individualmente. Se utilizan las marcas temporales de las palabras entregadas por el proveedor de voz para sincronizar la narración con el texto.

El proceso contempla diferencias entre palabras escritas y pronunciadas, incluyendo números y expresiones compuestas. Si el proveedor no entrega marcas temporales utilizables, se estima la sincronización de manera proporcional y se informa cuando la alineación es aproximada.

El audio se convierte a WAV PCM mono de 48 kHz para mantener un formato uniforme.

Los subtítulos se generan en formato ASS y se integran directamente en el vídeo. La tipografía, márgenes, longitud de línea y color de resaltado son configurables.

## Música y licencias

El sistema consulta:

1. El proveedor principal configurado, normalmente Jamendo.
2. Jamendo.
3. Internet Archive.
4. Archivos musicales locales.

Las búsquedas se generan a partir del título, tipo de cocina, categoría e ingredientes. También existe una configuración de ambientes musicales asociados a distintos tipos de recetas.

El usuario puede escuchar previews y seleccionar una pista de forma interactiva o por número.

La atribución musical se guarda junto con la pista seleccionada y puede incluirse en la descripción de YouTube.

**Advertencia sobre licencias:** no todas las pistas disponibles son adecuadas para uso comercial o vídeos monetizados en YouTube. El pipeline ordena las licencias y advierte sobre posibles restricciones, pero el usuario debe verificar las condiciones exactas de cada pista y sus requisitos de atribución antes de publicar o monetizar el contenido.

## Selector musical web

El proyecto incluye un servidor HTTP liviano en Python para previsualizar y seleccionar música desde el navegador.

Ejecutar:

```bash
python3 web/music-select/server.py <recipe-slug>
```

Abrir:

```text
http://localhost:3456
```

La interfaz obtiene candidatos musicales, verifica la disponibilidad de los previews, permite escucharlos y seleccionar una pista. Después inicia el proceso de renderizado.

## Estructura de salida

Cada receta tiene su propio espacio de trabajo:

```text
work/<recipe-slug>/
├── recipe.json
├── script.json
├── scenes/
├── images/
├── audio/
├── clips/
├── music/
├── cache/
├── music.json
├── narration.wav
└── subtitles.ass
```

El vídeo final se guarda en:

```text
out/<recipe-slug>.mp4
```

Otros recursos generados pueden incluir:

- `thumbnail.jpg`
- `descripcion.txt`
- `descripcion_seo.txt`
- `creditos.txt`
- `visuals.mp4`

El espacio de trabajo también conserva archivos intermedios y recursos en caché utilizados durante el procesamiento.

## Diagnóstico

Ejecutar:

```bash
npm run doctor
```

El diagnóstico comprueba Node.js, FFmpeg, FFprobe, Python, Edge TTS, tipografías, claves API opcionales y disponibilidad de algunos servicios externos.

---

## License

This repository is currently marked as private in its package configuration. Add an explicit repository license before distributing or reusing the project under open-source terms.