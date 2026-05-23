const KECAP_MATRIX_B_VALUE = 1; // Kecap patch: mvhd display matrix b -> 0x00000001

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

function getBoxType(data, offset) {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3]
  );
}

function readBox(view, data, offset, end) {
  if (offset + 8 > end) {
    throw new Error('MP4 invalid: box tidak lengkap.');
  }

  const smallSize = view.getUint32(offset, false);
  const type = getBoxType(data, offset + 4);
  let size = smallSize;
  let headerSize = 8;

  if (smallSize === 1) {
    if (offset + 16 > end) {
      throw new Error(`MP4 invalid: box tidak lengkap.`);
    }

    const high = view.getUint32(offset + 8, false);
    const low = view.getUint32(offset + 12, false);
    size = high * 4294967296 + low;
    headerSize = 16;
  } else if (smallSize === 0) {
    size = end - offset;
  }

  if (size < headerSize || offset + size > end) {
    throw new Error(`MP4 invalid: ukuran box salah.`);
  }

  return {
    type,
    offset,
    size,
    headerSize,
    contentStart: offset + headerSize,
    end: offset + size,
  };
}

function findBox(view, data, start, end, wantedType) {
  let offset = start;

  while (offset + 8 <= end) {
    const box = readBox(view, data, offset, end);
    if (box.type === wantedType) return box;
    offset = box.end;
  }

  return null;
}

function patchKecapMethod(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  const moov = findBox(view, data, 0, data.length, 'moov');
  if (!moov) {
    throw new Error('Box tidak ditemukan. File harus MP4 valid.');
  }

  const mvhd = findBox(view, data, moov.contentStart, moov.end, 'mvhd');
  if (!mvhd) {
    throw new Error('Box tidak ditemukan .');
  }

  const version = data[mvhd.contentStart];
  let matrixOffset;

  if (version === 0) {
    matrixOffset = mvhd.offset + 44;
  } else if (version === 1) {
    matrixOffset = mvhd.offset + 56;
  } else {
    throw new Error(`Versi tidak didukung.`);
  }

  const matrixBOffset = matrixOffset + 4;
  if (matrixBOffset + 4 > mvhd.end) {
    throw new Error('Box " terlalu pendek untuk mengubah display matrix.');
  }

  const previousValue = view.getInt32(matrixBOffset, false);
  view.setInt32(matrixBOffset, KECAP_MATRIX_B_VALUE, false);

  return {
    offset: matrixBOffset,
    previousValue,
    newValue: KECAP_MATRIX_B_VALUE,
  };
}

if (selectBtn && fileInput) {
  selectBtn.addEventListener('click', () => {
    fileInput.click();
  });
}

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    appendLog('> Website mode:tombol close tidak tersedia di browser.');
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
      appendLog('> Siap diproses dengan metode Kecap.');
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
    appendLog('> Scanning MP4  ...');

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const patch = patchKecapMethod(arrayBuffer);

      appendLog('> ditemukan.');
      appendLog(`> matrix`);
      appendLog(`> Offset patch: `);
      appendLog('> Membuat file output...');

      const blob = new Blob([arrayBuffer], {
        type: selectedFile.type || 'video/mp4',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const originalName = selectedFile.name.replace(/\.[^/.]+$/, '');

      a.href = url;
      a.download = `${originalName}_Ojeh_KecapV3.mp4`;

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
