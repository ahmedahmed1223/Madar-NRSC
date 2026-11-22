export interface GuestCheckResult {
  camera: boolean;
  microphone: boolean;
  light: boolean;
  uploadMbps: number;
}

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function hasAdequateLight(video: HTMLVideoElement): boolean {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 36;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !video.videoWidth) return false;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let luminosity = 0;
  for (let i = 0; i < data.length; i += 4) luminosity += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return luminosity / (data.length / 4) >= 45;
}

export async function testGuestDevices(video: HTMLVideoElement): Promise<Omit<GuestCheckResult, 'uploadMbps'>> {
  const result = { camera: false, microphone: false, light: false };
  if (!navigator.mediaDevices?.getUserMedia) return result;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    try {
      video.srcObject = stream;
      await video.play();
      for (let frame = 0; frame < 10 && !video.videoWidth; frame++) await wait(100);
      result.camera = video.videoWidth > 0;
      result.light = hasAdequateLight(video);
    } finally {
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
  } catch { /* Permissions may be granted for the microphone independently. */ }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      result.microphone = stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted);
    } finally { stream.getTracks().forEach(track => track.stop()); }
  } catch { /* A missing or blocked device remains failed in the result. */ }
  return result;
}

export async function measureGuestUpload(endpoint: string, token: string): Promise<number> {
  const sample = new Uint8Array(192 * 1024);
  const start = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'X-NRCS-Client': 'web', 'X-Madar-Intake': token, 'Content-Type': 'application/octet-stream' },
    body: sample, signal: AbortSignal.timeout(12_000),
  });
  const measured = await response.json();
  if (!response.ok || measured.bytes !== sample.byteLength) throw new Error('تعذر اختبار سرعة الرفع.');
  return Math.min(10_000, sample.byteLength * 8 / Math.max(10, performance.now() - start) / 1000);
}
