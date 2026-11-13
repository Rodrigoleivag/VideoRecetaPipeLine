/**
 * Proveedor Azure Speech (requiere AZURE_SPEECH_KEY y el SDK opcional).
 * El SDK entrega eventos de límite de palabra con desplazamiento de audio real.
 */

/**
 * @param {{ text: string, outFile: string, voice: string, rate: string, pitch: string, volume: string }} options
 * @returns {Promise<Array<{ text: string, start: number, end: number }>>}
 */
export async function synthesizeAzure(options) {
  const key = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION
  if (!key || !region) {
    throw new Error('Azure requiere AZURE_SPEECH_KEY y AZURE_SPEECH_REGION en .env')
  }

  let sdk
  try {
    sdk = await import('microsoft-cognitiveservices-speech-sdk')
  } catch {
    throw new Error('El proveedor azure necesita el SDK: npm install microsoft-cognitiveservices-speech-sdk')
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region)
  speechConfig.speechSynthesisVoiceName = options.voice
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm

  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null)
  const words = []
  synthesizer.wordBoundary = (_sender, event) => {
    words.push({ text: event.text, audioOffset: event.audioOffset, duration: 0 })
  }

  const ssml = buildSsml(options)
  const result = await new Promise((resolve, reject) => {
    synthesizer.speakSsmlAsync(ssml, (value) => resolve(value), (error) => reject(new Error(String(error))))
  })
  synthesizer.close()

  if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
    throw new Error(`Azure no completó la síntesis: ${result.errorDetails ?? result.reason}`)
  }

  const { writeFile } = await import('node:fs/promises')
  const wavFile = options.outFile.replace(/\.mp3$/, '.wav')
  await writeFile(wavFile, Buffer.from(result.audioData))

  const ordered = words
    .map((word, index) => {
      const start = word.audioOffset / 1e7
      const next = words[index + 1]
      const end = next ? next.audioOffset / 1e7 : start + 0.35
      return { text: word.text, start, end }
    })
    .filter((word, index) => index === 0 || word.start >= words[index - 1].audioOffset / 1e7)

  options.onWav?.(wavFile)
  return ordered
}

/**
 * Construye el SSML con prosodia de tono y velocidad.
 * @param {{ text: string, voice: string, rate: string, pitch: string, volume: string }} options
 */
function buildSsml({ text, voice, rate, pitch, volume }) {
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<speak version="1.0" xml:lang="es-ES"><voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escape(text)}</prosody></voice></speak>`
}
