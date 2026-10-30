// Запись с микрофона в WAV, который принимает голосовая модель Meta: моно, 16 бит, 16 кГц.
// MediaRecorder отдаёт сжатый webm/mp4; раскодируем его через Web Audio и пересчитываем частоту сами —
// так результат одинаковый в Chrome, Safari и Firefox, а на сервер уходит ровно тот формат, что нужен.
// Отдельно — «измеритель»: тот же анализатор громкости без записи, для волн при распознавании браузером.

export const TARGET_RATE = 16_000
// Сколько дописываем после нажатия «стоп», чтобы не отрезать конец фразы.
export const TAIL_MS = 400

export interface Meter {
  /** Громкость 0..1 для живого индикатора. */
  level: () => number
  stop: () => void
}

export interface Recorder extends Meter {
  stop: () => void
  finish: () => Promise<Blob>
  cancel: () => void
}

type Ctx = AudioContext
type CtxCtor = new (opts?: AudioContextOptions) => Ctx

function audioContextCtor(): CtxCtor | null {
  const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function canMeter(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!audioContextCtor()
}

export function canRecord(): boolean {
  return canMeter() && typeof MediaRecorder !== 'undefined'
}

function pickMime(): string | undefined {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return types.find((t) => MediaRecorder.isTypeSupported?.(t))
}

async function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
}

/** Анализатор громкости на потоке микрофона. stop() отпускает и поток, и аудиоконтекст. */
function attachMeter(stream: MediaStream): Meter {
  const Ctor = audioContextCtor()!
  const ctx = new Ctor()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  let stopped = false
  return {
    level: () => {
      if (stopped) return 0
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) {
        const x = (v - 128) / 128
        sum += x * x
      }
      // Подавление шума в браузере делает сигнал тихим: усиливаем, чтобы индикатор жил от обычной речи.
      return Math.min(1, Math.sqrt(sum / buf.length) * 7)
    },
    stop: () => {
      if (stopped) return
      stopped = true
      stream.getTracks().forEach((t) => t.stop())
      source.disconnect()
      void ctx.close().catch(() => {})
    },
  }
}

/** Только громкость, без записи: волны при распознавании силами браузера, который свой уровень не отдаёт. */
export async function startMeter(): Promise<Meter> {
  return attachMeter(await openMic())
}

/** Начинает запись. finish() → WAV; stop() — просто отпустить микрофон (для Meter-совместимости). */
export async function startRecording(): Promise<Recorder> {
  const stream = await openMic()
  const mime = pickMime()
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const meter = attachMeter(stream)

  recorder.start(250)
  const cancel = () => {
    if (recorder.state !== 'inactive') recorder.stop()
    meter.stop()
  }
  return {
    level: meter.level,
    stop: cancel,
    cancel,
    finish: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = async () => {
          meter.stop()
          try {
            resolve(await toWav(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })))
          } catch (err) {
            reject(err)
          }
        }
        recorder.onerror = () => {
          meter.stop()
          reject(new Error('recorder'))
        }
        if (recorder.state === 'inactive') recorder.onstop(new Event('stop'))
        // Кодек отдаёт звук с задержкой: без паузы хвост последнего слова («…теряю») терялся.
        else setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), TAIL_MS)
      }),
  }
}

/** Сжатая запись → моно PCM 16 кГц → WAV. */
export async function toWav(blob: Blob): Promise<Blob> {
  const Ctor = audioContextCtor()
  if (!Ctor) throw new Error('no-audio-context')
  const ctx = new Ctor()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close().catch(() => {})
  }
  const mono = downmix(decoded)
  const samples = resample(mono, decoded.sampleRate, TARGET_RATE)
  return new Blob([encodeWav(samples, TARGET_RATE)], { type: 'audio/wav' })
}

export function downmix(buffer: AudioBuffer): Float32Array {
  const n = buffer.length
  const out = new Float32Array(n)
  const channels = buffer.numberOfChannels
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) out[i] += data[i] / channels
  }
  return out
}

/** Линейная интерполяция: для речи достаточно, а работает без OfflineAudioContext (его нет в части браузеров). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const length = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const bytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + bytes)
  const view = new DataView(buffer)
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // моно
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, bytes, true)
  let offset = 44
  for (const s of samples) {
    const v = Math.max(-1, Math.min(1, s))
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    offset += 2
  }
  return buffer
}
