import { reactive } from 'vue'

/**
 * Reads QR codes from the rear camera. Uses the native BarcodeDetector where it exists
 * (Chrome on Android) and falls back to jsQR, which is loaded only when first needed —
 * Safari has no BarcodeDetector.
 */

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<string[]>
}

const NativeDetector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector

/** Scanner state for the sync screen and the Debug app. */
export const scannerState = reactive({
  engine: '' as '' | 'BarcodeDetector' | 'jsQR',
  camera: 'idle' as 'idle' | 'starting' | 'active' | 'error',
  error: '',
  track: null as null | { label: string; width?: number; height?: number; facingMode?: string },
  startedAt: null as number | null,
  framesScanned: 0,
  codesRead: 0,
  /** Average decode time of the last frames (ms). */
  decodeMs: 0,
})

export const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** Whether the native detector exists and claims QR support. */
export async function nativeQrSupported(): Promise<boolean> {
  if (!NativeDetector) return false
  try {
    return (await NativeDetector.getSupportedFormats()).includes('qr_code')
  } catch {
    return false
  }
}

type Decode = (video: HTMLVideoElement) => Promise<string | null>

async function createDecoder(): Promise<Decode> {
  if (await nativeQrSupported()) {
    scannerState.engine = 'BarcodeDetector'
    const detector = new NativeDetector!({ formats: ['qr_code'] })
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
  }
  scannerState.engine = 'jsQR'
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return async (video) => {
    // Decoding a downscaled frame is several times faster and still reads a screen-sized code.
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

function describeError(e: unknown): string {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError') return 'Camera access was denied. Allow it in the browser or system settings.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device.'
  if (name === 'NotReadableError') return 'The camera is in use by another app.'
  return String((e as Error)?.message ?? e)
}

/**
 * Starts the camera into `video` and calls `onCode` for every QR code seen (repeats
 * included). Returns a stop function; the camera light goes off when it is called.
 */
export async function startScanner(video: HTMLVideoElement, onCode: (text: string) => void): Promise<() => void> {
  scannerState.camera = 'starting'
  scannerState.error = ''
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  } catch (e) {
    scannerState.camera = 'error'
    scannerState.error = describeError(e)
    throw new Error(scannerState.error, { cause: e })
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
    scannerState.camera = 'idle'
  }

  try {
    video.srcObject = stream
    video.setAttribute('playsinline', '')
    video.muted = true
    await video.play()
    const decode = await createDecoder()
    const settings = stream.getVideoTracks()[0]?.getSettings()
    scannerState.track = {
      label: stream.getVideoTracks()[0]?.label ?? '',
      width: settings?.width,
      height: settings?.height,
      facingMode: settings?.facingMode,
    }
    scannerState.camera = 'active'
    scannerState.startedAt = Date.now()

    const loop = async () => {
      while (!stopped) {
        if (video.readyState >= 2 && video.videoWidth) {
          const t0 = performance.now()
          let text: string | null = null
          try {
            text = await decode(video)
          } catch {
            // A frame that fails to decode is just skipped.
          }
          scannerState.decodeMs = Math.round(scannerState.decodeMs * 0.8 + (performance.now() - t0) * 0.2)
          scannerState.framesScanned++
          if (text && !stopped) {
            scannerState.codesRead++
            onCode(text)
          }
        }
        await new Promise((r) => requestAnimationFrame(r))
      }
    }
    void loop()
  } catch (e) {
    stop()
    scannerState.camera = 'error'
    scannerState.error = describeError(e)
    throw new Error(scannerState.error, { cause: e })
  }
  return stop
}
