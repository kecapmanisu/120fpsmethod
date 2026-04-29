const PAYLOAD = 268435457; // 0x10000001

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

if (selectBtn && fileInput) {
  selectBtn.addEventListener('click', () => {
    fileInput.click();
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
      appendLog('> Siap diproses.');
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
    if (!selectedFile) {
      setStatus('> Pilih video dengan resolusi maksimal 1080p terlebih dahulu.');
      return;
    }

    if (!isResolutionAllowed) {
      setStatus('> Video ditolak. Hanya resolusi maksimal 1080p yang boleh diproses.');
      return;
    }

    appendLog('> System standing by...', true);
    appendLog('> Scanning MP4 ...');

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const view = new DataView(arrayBuffer);

      const elstMagic = [0x65, 0x6c, 0x73, 0x74];
      let elstIndex = -1;

      for (let i = 0; i < data.length - 4; i++) {
        if (
          data[i] === elstMagic[0] &&
          data[i + 1] === elstMagic[1] &&
          data[i + 2] === elstMagic[2] &&
          data[i + 3] === elstMagic[3]
        ) {
          elstIndex = i;
          break;
        }
      }

      if (elstIndex === -1) {
        throw new Error('file tidak ditemukan. File mungkin bukan MP4 valid.');
      }

      appendLog('> ditemukan.');

      const payloadOffset = elstIndex + 8;
      view.setUint32(payloadOffset, PAYLOAD, false);

      appendLog('> successfully.');
      appendLog('> Membuat file output...');

      const blob = new Blob([arrayBuffer], {
        type: selectedFile.type || 'video/mp4',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const originalName = selectedFile.name.replace(/\.[^/.]+$/, '');

      a.href = url;
      a.download = `${originalName}_Ojeeh&KecapManis.mp4`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);

      appendLog('> Download dimulai.');
      appendLog('> Selesai.');
    } catch (err) {
      appendLog(`> ERROR: ${err.message}`);
    }
  });
}