const FFMPEG_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js';
const FFMPEG_CORE_PATH = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';
const OUTPUT_SUFFIX = '_Ojeeh&KecapManis';

const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const patchBtn = document.getElementById('patchBtn');
const statusEl = document.getElementById('status');

const fileNameEl = document.getElementById('fileName');
const resolutionValue = document.getElementById('resolutionValue');
const fpsValue = document.getElementById('fpsValue');
const bitrateValue = document.getElementById('bitrateValue');
const sizeValue = document.getElementById('sizeValue');
const closeBtn = document.getElementById('closeBtn');

let selectedFile = null;
let selectedVideoMeta = null;
let isResolutionAllowed = false;
let isProcessing = false;
let ffmpeg = null;
let ffmpegScriptPromise = null;

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function appendLog(message, reset = false) {
  if (!statusEl) return;

  if (reset) {
    statusEl.textContent = message;
  } else {
    statusEl.textContent += `\n${message}`;
  }

  statusEl.scrollTop = statusEl.scrollHeight;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '---';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatBitrate(bitsPerSecond) {
  if (!bitsPerSecond || bitsPerSecond <= 0) return '---';

  const mbps = bitsPerSecond / 1000000;
  return `${mbps.toFixed(mbps >= 10 ? 1 : 2)} Mbps`;
}

function resetMeta() {
  if (resolutionValue) resolutionValue.textContent = '---';
  if (fpsValue) fpsValue.textContent = '---';
  if (bitrateValue) bitrateValue.textContent = '---';
  if (sizeValue) sizeValue.textContent = '---';

  selectedVideoMeta = null;
  isResolutionAllowed = false;
}

function setProcessingState(active) {
  isProcessing = active;

  if (patchBtn) {
    patchBtn.disabled = active || !selectedFile || !isResolutionAllowed;
    patchBtn.textContent = active ? 'Processing with FFmpeg...' : 'Initialize Calibration';
  }

  if (selectBtn) {
    selectBtn.disabled = active;
  }
}

function isMax1080pResolution(width, height) {
  const maxSide = Math.max(width, height);
  const minSide = Math.min(width, height);

  // Maksimal 1080p:
  // Landscape sampai 1920x1080
  // Portrait sampai 1080x1920
  return maxSide <= 1920 && minSide <= 1080;
}

function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = video.duration;

      URL.revokeObjectURL(url);

      resolve({
        width,
        height,
        duration,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Metadata video tidak bisa dibaca.'));
    };

    video.src = url;
  });
}

function getBaseName(fileName) {
  return fileName.replace(/\.[^/.]+$/, '') || 'video';
}

function getExtension(fileName) {
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : 'mp4';
}

function loadScriptOnce(src) {
  if (ffmpegScriptPromise) return ffmpegScriptPromise;

  ffmpegScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);

    if (window.FFmpeg) {
      resolve(window.FFmpeg);
      return;
    }

    const script = existingScript || document.createElement('script');

    script.src = src;
    script.crossOrigin = 'anonymous';
    script.async = true;

    script.addEventListener('load', () => {
      if (window.FFmpeg) {
        resolve(window.FFmpeg);
      } else {
        reject(new Error('FFmpeg script sudah dimuat, tapi window.FFmpeg tetap tidak tersedia.'));
      }
    }, { once: true });

    script.addEventListener('error', () => {
      reject(new Error('Gagal memuat library FFmpeg dari CDN. Cek koneksi internet atau setting deployment.'));
    }, { once: true });

    if (!existingScript) {
      document.head.appendChild(script);
    }
  });

  return ffmpegScriptPromise;
}

async function getFFmpegApi() {
  if (window.FFmpeg && window.FFmpeg.createFFmpeg && window.FFmpeg.fetchFile) {
    return window.FFmpeg;
  }

  appendLog('> Memuat library FFmpeg...');

  const api = await loadScriptOnce(FFMPEG_LIBRARY_URL);

  if (!api || !api.createFFmpeg || !api.fetchFile) {
    throw new Error('Library FFmpeg belum berhasil dimuat. Pastikan CDN FFmpeg tidak diblokir.');
  }

  return api;
}

function cleanupFs(files) {
  if (!ffmpeg || !ffmpeg.isLoaded()) return;

  files.forEach((file) => {
    try {
      ffmpeg.FS('unlink', file);
    } catch (err) {
      // Abaikan file yang memang tidak ada di FFmpeg FS.
    }
  });
}

async function getFFmpeg() {
  const { createFFmpeg } = await getFFmpegApi();

  if (!ffmpeg) {

    ffmpeg = createFFmpeg({
      log: false,
      corePath: FFMPEG_CORE_PATH,
      logger: ({ type, message }) => {
        if (!isProcessing) return;

        const importantMessage =
          message.includes('Duration:') ||
          message.includes('time=') ||
          message.includes('video:') ||
          message.includes('error') ||
          message.includes('Error');

        if (importantMessage) {
          appendLog(`> ffmpeg ${type}: ${message}`);
        }
      },
      progress: ({ ratio }) => {
        if (!isProcessing || !Number.isFinite(ratio)) return;

        const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
        if (percent > 0 && percent < 100) {
          setStatus(`> FFmpeg processing... ${percent}%`);
        }
      },
    });
  }

  if (!ffmpeg.isLoaded()) {
    appendLog('> Memuat FFmpeg core...');
    appendLog('> Proses pertama bisa agak lama karena browser mengunduh WASM core.');
    await ffmpeg.load();
    appendLog('> FFmpeg core siap.');
  }

  return ffmpeg;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = fileName;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

async function processVideoWithFFmpeg(file) {
  const instance = await getFFmpeg();
  const { fetchFile } = await getFFmpegApi();

  const extension = getExtension(file.name);
  const inputName = `input_${Date.now()}.${extension}`;
  const outputName = `output_${Date.now()}.mp4`;
  const outputDownloadName = `${getBaseName(file.name)}${OUTPUT_SUFFIX}.mp4`;

  cleanupFs([inputName, outputName]);

  appendLog('> Menyalin video ke FFmpeg virtual FS...');
  instance.FS('writeFile', inputName, await fetchFile(file));

  appendLog('> Menjalankan FFmpeg re-encode 60 FPS MP4...');
  appendLog('> Codec: H.264 video + AAC audio.');

  await instance.run(
    '-i', inputName,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', 'fps=60,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputName
  );

  appendLog('> Membaca hasil FFmpeg...');
  const outputData = instance.FS('readFile', outputName);

  cleanupFs([inputName, outputName]);

  const blob = new Blob([outputData.buffer], {
    type: 'video/mp4',
  });

  downloadBlob(blob, outputDownloadName);
}

if (selectBtn && fileInput) {
  selectBtn.addEventListener('click', () => {
    if (!isProcessing) {
      fileInput.click();
    }
  });
}

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    appendLog('> Website mode: tombol close tidak tersedia di browser.');
  });
}

if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
    selectedFile = e.target.files[0] || null;

    resetMeta();

    if (patchBtn) patchBtn.disabled = true;

    if (!selectedFile) {
      if (fileNameEl) fileNameEl.textContent = 'No file selected';

      setStatus('> Tidak ada video yang dipilih.');
      return;
    }

    if (fileNameEl) fileNameEl.textContent = selectedFile.name;
    if (sizeValue) sizeValue.textContent = formatBytes(selectedFile.size);
    if (fpsValue) fpsValue.textContent = 'Auto';

    appendLog(`> Video dipilih: ${selectedFile.name}`, true);
    appendLog(`> Size: ${formatBytes(selectedFile.size)}`);
    appendLog('> Membaca metadata video...');

    try {
      selectedVideoMeta = await readVideoMetadata(selectedFile);

      const { width, height, duration } = selectedVideoMeta;
      isResolutionAllowed = isMax1080pResolution(width, height);

      if (resolutionValue) {
        resolutionValue.textContent = `${width}x${height}`;
      }

      if (duration && Number.isFinite(duration) && bitrateValue) {
        const bitrate = (selectedFile.size * 8) / duration;
        bitrateValue.textContent = formatBitrate(bitrate);
      }

      appendLog(`> Resolusi: ${width}x${height}`);

      if (!isResolutionAllowed) {
        selectedFile = null;

        if (patchBtn) patchBtn.disabled = true;

        appendLog('> ERROR: Kualitas video terlalu tinggi.');
        appendLog('> Maksimal resolusi yang boleh diproses adalah 1080p.');
        appendLog('> Video 2K atau 4K tidak diizinkan.');

        return;
      }

      if (patchBtn) patchBtn.disabled = false;

      appendLog('> Resolusi valid: maksimal 1080p.');
      appendLog('> Siap diproses dengan FFmpeg.');
    } catch (err) {
      selectedFile = null;
      isResolutionAllowed = false;

      if (patchBtn) patchBtn.disabled = true;

      appendLog(`> ERROR: ${err.message}`);
    }
  });
}

if (patchBtn) {
  patchBtn.addEventListener('click', async () => {
    if (isProcessing) return;

    if (!selectedFile) {
      setStatus('> Pilih video dengan resolusi maksimal 1080p terlebih dahulu.');
      return;
    }

    if (!isResolutionAllowed) {
      setStatus('> Video ditolak. Hanya resolusi maksimal 1080p yang boleh diproses.');
      return;
    }

    appendLog('> System standing by...', true);
    appendLog('> FFmpeg mode aktif.');
    appendLog('> Menyiapkan proses video...');

    setProcessingState(true);

    try {
      await processVideoWithFFmpeg(selectedFile);

      appendLog('> Download dimulai.');
      appendLog('> Selesai.');
    } catch (err) {
      appendLog(`> ERROR: ${err.message}`);
      appendLog('> Jika gagal karena WASM/SharedArrayBuffer, pastikan vercel.json ikut terdeploy dan CDN tidak diblokir.');
    } finally {
      setProcessingState(false);
    }
  });
}
