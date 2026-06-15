const pageLinks = Array.from(document.querySelectorAll('[data-page-link]'));
const pageViews = Array.from(document.querySelectorAll('[data-page]'));

function showPage(pageName, shouldUpdateHash = true) {
  const targetPage = pageViews.find((page) => page.dataset.page === pageName);
  if (!targetPage) return;

  pageViews.forEach((page) => {
    page.classList.toggle('is-active', page === targetPage);
  });

  pageLinks.forEach((link) => {
    const isActive = link.dataset.pageLink === pageName;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (shouldUpdateHash) {
    history.replaceState(null, '', `#${pageName}`);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

pageLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.dataset.pageLink);
  });
});

const firstPage = window.location.hash.replace('#', '') || 'beranda';
showPage(firstPage, false);

window.addEventListener('hashchange', () => {
  const pageName = window.location.hash.replace('#', '') || 'beranda';
  showPage(pageName, false);
});

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

function timestamp() {
  return new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function appendLog(message, reset = false) {
  if (!statusEl) return;

  const line = `[${timestamp()}] > ${message}`;

  if (reset) {
    statusEl.textContent = line;
  } else {
    statusEl.textContent += `\n${line}`;
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

// ==================== KECAP MANIS MP4 Sample Table Method ====================
const FAKE_SAMPLE_SIZE = 8;
const FAKE_SAMPLE_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);
const VIDEO_TIMESCALE = 90000;
const VIDEO_DURATION = 2269500;
// Kamuri method အရ Media Time ကို 3000 အစား 0 သို့ ပြောင်းထားပါတယ်။
const VIDEO_EDIT_MEDIA_TIME = 0; 
const VIDEO_SAMPLE_DELTA = 1500;
const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta', 'ilst']);

function getBoxType(data, offset) {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3]
  );
}

function setBoxType(data, offset, type) {
  for (let i = 0; i < 4; i += 1) {
    data[offset + i] = type.charCodeAt(i);
  }
}

function assertUint32(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} fora do limite uint32: ${value}`);
  }
}

function readBox(view, data, offset, end, parentPath = '') {
  if (offset + 8 > end) {
    throw new Error('MP4 invalido: caixa incompleta.');
  }

  const smallSize = view.getUint32(offset, false);
  const type = getBoxType(data, offset + 4);
  let size = smallSize;
  let headerSize = 8;

  if (smallSize === 1) {
    if (offset + 16 > end) {
      throw new Error(`MP4 invalido: caixa ${type} incompleta.`);
    }

    const high = view.getUint32(offset + 8, false);
    const low = view.getUint32(offset + 12, false);
    size = high * 4294967296 + low;
    headerSize = 16;
  } else if (smallSize === 0) {
    size = end - offset;
  }

  if (size < headerSize || offset + size > end) {
    throw new Error(`MP4 invalido: tamanho incorreto na caixa ${type}.`);
  }

  return {
    type,
    offset,
    size,
    headerSize,
    contentStart: offset + headerSize,
    end: offset + size,
    path: parentPath ? `${parentPath}/${type}` : type,
    data,
    view,
    children: [],
    prefixStart: offset + headerSize,
    prefixEnd: offset + headerSize,
  };
}

function childStartForBox(box) {
  if (box.type === 'meta') {
    return box.contentStart + 4;
  }

  return box.contentStart;
}

function parseBoxes(data, view, start = 0, end = data.length, parentPath = '') {
  const boxes = [];
  let offset = start;

  while (offset + 8 <= end) {
    const box = readBox(view, data, offset, end, parentPath);

    if (CONTAINER_BOXES.has(box.type)) {
      const childStart = childStartForBox(box);
      if (childStart > box.end) {
        throw new Error(`MP4 invalido: container ${box.type} curto demais.`);
      }

      box.prefixStart = box.contentStart;
      box.prefixEnd = childStart;
      box.children = parseBoxes(data, view, childStart, box.end, box.path);
    }

    boxes.push(box);
    offset = box.end;
  }

  return boxes;
}

function findChild(box, type) {
  return box.children.find((child) => child.type === type) || null;
}

function findDescendant(box, path) {
  let current = box;
  for (const type of path) {
    current = findChild(current, type);
    if (!current) return null;
  }

  return current;
}

function findTopLevel(boxes, type) {
  return boxes.find((box) => box.type === type) || null;
}

function handlerTypeForTrak(trak) {
  const hdlr = findDescendant(trak, ['mdia', 'hdlr']);
  if (!hdlr || hdlr.offset + 20 > hdlr.end) {
    return null;
  }

  return getBoxType(hdlr.data, hdlr.offset + 16);
}

function parseStsz(stsz) {
  const sampleSize = stsz.view.getUint32(stsz.offset + 12, false);
  const count = stsz.view.getUint32(stsz.offset + 16, false);

  if (sampleSize) {
    return new Array(count).fill(sampleSize);
  }

  const tableStart = stsz.offset + 20;
  if (tableStart + count * 4 > stsz.end) {
    throw new Error('MP4 invalido: stsz menor que a quantidade de samples declarada.');
  }

  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    sizes.push(stsz.view.getUint32(tableStart + i * 4, false));
  }

  return sizes;
}

function parseStco(stco) {
  const count = stco.view.getUint32(stco.offset + 12, false);
  const tableStart = stco.offset + 16;

  if (tableStart + count * 4 > stco.end) {
    throw new Error('MP4 invalido: stco menor que a quantidade de chunks declarada.');
  }

  const offsets = [];
  for (let i = 0; i < count; i += 1) {
    offsets.push(stco.view.getUint32(tableStart + i * 4, false));
  }

  return offsets;
}

function parseStsc(stsc) {
  const count = stsc.view.getUint32(stsc.offset + 12, false);
  const tableStart = stsc.offset + 16;

  if (tableStart + count * 12 > stsc.end) {
    throw new Error('MP4 invalido: stsc menor que a quantidade de entradas declarada.');
  }

  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const offset = tableStart + i * 12;
    rows.push([
      stsc.view.getUint32(offset, false),
      stsc.view.getUint32(offset + 4, false),
      stsc.view.getUint32(offset + 8, false),
    ]);
  }

  return rows;
}

function makeBox(type, payload) {
  const size = 8 + payload.length;
  assertUint32(size, `${type}.size`);

  const box = new Uint8Array(size);
  const view = new DataView(box.buffer);
  view.setUint32(0, size, false);
  setBoxType(box, 4, type);
  box.set(payload, 8);
  return box;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  assertUint32(total, 'output_size');

  const output = new Uint8Array(total);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function boxBytes(box) {
  return box.data.slice(box.offset, box.end);
}

function boxPayload(box) {
  return box.data.slice(box.contentStart, box.end);
}

function buildMdhd(box) {
  const payload = boxPayload(box);
  const view = new DataView(payload.buffer);
  const version = payload[0];

  if (version !== 0) {
    throw new Error(`Versao mdhd nao suportada nesse metodo: ${version}.`);
  }

  view.setUint32(12, VIDEO_TIMESCALE, false);
  view.setUint32(16, VIDEO_DURATION, false);
  return makeBox('mdhd', payload);
}

function buildElst(box) {
  const payload = boxPayload(box);
  const view = new DataView(payload.buffer);
  const version = payload[0];
  const entryCount = view.getUint32(4, false);

  if (version !== 0 || entryCount < 1) {
    throw new Error('Esse metodo precisa de elst version 0 com pelo menos uma entrada.');
  }

  view.setUint32(12, VIDEO_EDIT_MEDIA_TIME, false);
  return makeBox('elst', payload);
}

function buildStts(realSampleCount, fakeSampleCount) {
  const payload = new Uint8Array(4 + 4 + 8 + 8);
  const view = new DataView(payload.buffer);

  view.setUint32(4, 2, false);
  view.setUint32(8, realSampleCount, false);
  view.setUint32(12, VIDEO_SAMPLE_DELTA, false);
  view.setUint32(16, fakeSampleCount, false); 
  view.setUint32(20, VIDEO_SAMPLE_DELTA, false);

  return makeBox('stts', payload);
}

function buildStsz(originalSizes, fakeSampleCount) {
  const totalSamples = originalSizes.length + fakeSampleCount;
  const payload = new Uint8Array(4 + 4 + 4 + totalSamples * 4);
  const view = new DataView(payload.buffer);

  view.setUint32(8, totalSamples, false);

  let offset = 12;
  originalSizes.forEach((size) => {
    view.setUint32(offset, size, false);
    offset += 4;
  });

  for (let i = 0; i < fakeSampleCount; i += 1) {
    view.setUint32(offset, FAKE_SAMPLE_SIZE, false);
    offset += 4;
  }

  return makeBox('stsz', payload);
}

function buildStsc(originalRows, originalChunkCount) {
  const rows = originalRows.map((row) => [...row]);
  const lastRow = rows[rows.length - 1];

  if (!lastRow || lastRow[1] !== 1) {
    rows.push([originalChunkCount + 1, 1, 1]);
  }

  const payload = new Uint8Array(4 + 4 + rows.length * 12);
  const view = new DataView(payload.buffer);

  view.setUint32(4, rows.length, false);

  let offset = 8;
  rows.forEach(([firstChunk, samplesPerChunk, sampleDescriptionIndex]) => {
    view.setUint32(offset, firstChunk, false);
    view.setUint32(offset + 4, samplesPerChunk, false);
    view.setUint32(offset + 8, sampleDescriptionIndex, false);
    offset += 12;
  });

  return makeBox('stsc', payload);
}

function buildStco(originalOffsets, delta, fakeOffset = null, fakeSampleCount = 0) {
  const count = originalOffsets.length + (fakeOffset === null ? 0 : fakeSampleCount);
  const payload = new Uint8Array(4 + 4 + count * 4);
  const view = new DataView(payload.buffer);

  view.setUint32(4, count, false);

  let tableOffset = 8;
  originalOffsets.forEach((offset) => {
    const shifted = offset + delta;
    assertUint32(shifted, 'stco.chunk_offset');
    view.setUint32(tableOffset, shifted, false);
    tableOffset += 4;
  });

  if (fakeOffset !== null) {
    assertUint32(fakeOffset, 'stco.fake_sample_offset');
    for (let i = 0; i < fakeSampleCount; i += 1) {
      view.setUint32(tableOffset, fakeOffset, false);
      tableOffset += 4;
    }
  }

  return makeBox('stco', payload);
}

function rebuildBox(box, replacements) {
  if (replacements.has(box)) {
    return replacements.get(box);
  }

  if (!box.children.length) {
    return boxBytes(box);
  }

  const parts = [box.data.slice(box.prefixStart, box.prefixEnd)];
  box.children.forEach((child) => {
    parts.push(rebuildBox(child, replacements));
  });

  return makeBox(box.type, concatBytes(parts));
}

function collectTrackStcoBoxes(moov) {
  const stcoBoxes = [];

  moov.children
    .filter((child) => child.type === 'trak')
    .forEach((trak) => {
      const stbl = findDescendant(trak, ['mdia', 'minf', 'stbl']);
      if (!stbl) return;

      const co64 = findChild(stbl, 'co64');
      if (co64) {
        throw new Error('Esse metodo ainda nao suporta MP4 com co64.');
      }

      const stco = findChild(stbl, 'stco');
      if (stco) {
        stcoBoxes.push(stco);
      }
    });

  return stcoBoxes;
}

function buildStcoReplacements(stcoBoxes, videoStco, delta, fakeOffset, fakeSampleCount) {
  const replacements = new Map();

  stcoBoxes.forEach((stco) => {
    replacements.set(
      stco,
      buildStco(parseStco(stco), delta, stco === videoStco ? fakeOffset : null, fakeSampleCount)
    );
  });

  return replacements;
}

function patchKecapManisSampleTableMethod(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const topLevel = parseBoxes(data, view);

  const ftyp = findTopLevel(topLevel, 'ftyp');
  const moov = findTopLevel(topLevel, 'moov');
  const mdat = findTopLevel(topLevel, 'mdat');

  if (!ftyp) {
    throw new Error('Caixa "ftyp" nao encontrada. O arquivo precisa ser MP4 valido.');
  }

  if (!moov) {
    throw new Error('Caixa "moov" nao encontrada. O arquivo precisa ter metadata MP4 completa.');
  }

  if (!mdat) {
    throw new Error('Caixa "mdat" nao encontrada. O arquivo precisa conter midia MP4.');
  }

  const videoTrak = moov.children.find((child) => child.type === 'trak' && handlerTypeForTrak(child) === 'vide');
  if (!videoTrak) {
    throw new Error('Track de video nao encontrada.');
  }

  const stbl = findDescendant(videoTrak, ['mdia', 'minf', 'stbl']);
  const mdhd = findDescendant(videoTrak, ['mdia', 'mdhd']);
  const elst = findDescendant(videoTrak, ['edts', 'elst']);
  const stts = stbl && findChild(stbl, 'stts');
  const stsc = stbl && findChild(stbl, 'stsc');
  const stsz = stbl && findChild(stbl, 'stsz');
  const stco = stbl && findChild(stbl, 'stco');

  if (!stbl || !mdhd || !elst || !stts || !stsc || !stsz || !stco) {
    throw new Error('MP4 sem as tabelas necessarias: mdhd, elst, stts, stsc, stsz e stco.');
  }

  const originalSizes = parseStsz(stsz);
  const realSampleCount = originalSizes.length;
  const fakeSampleCount = realSampleCount * 9; // rumus asli KECAP MANIS: sample asli x 9

  const originalStscRows = parseStsc(stsc);
  const originalChunkOffsets = parseStco(stco);
  const stcoBoxes = collectTrackStcoBoxes(moov);
  const preservedTopLevel = topLevel
    .filter((box) => !['ftyp', 'moov', 'mdat'].includes(box.type))
    .map(boxBytes);

  const fixedReplacements = new Map([
    [mdhd, buildMdhd(mdhd)],
    [elst, buildElst(elst)],
    [stts, buildStts(realSampleCount, fakeSampleCount)],
    [stsc, buildStsc(originalStscRows, originalChunkOffsets.length)],
    [stsz, buildStsz(originalSizes, fakeSampleCount)],
  ]);

  const placeholderReplacements = new Map(fixedReplacements);
  buildStcoReplacements(stcoBoxes, stco, 0, 0, fakeSampleCount).forEach((value, key) => {
    placeholderReplacements.set(key, value);
  });

  const moovPlaceholder = rebuildBox(moov, placeholderReplacements);
  const preservedBytes = concatBytes(preservedTopLevel);
  const oldMdatPayloadStart = mdat.contentStart;
  const oldMdatPayload = data.slice(mdat.contentStart, mdat.end);
  const newMdatPayloadStart = ftyp.size + moovPlaceholder.length + preservedBytes.length + 8;
  let delta = newMdatPayloadStart - oldMdatPayloadStart;
  let fakeOffset = newMdatPayloadStart + oldMdatPayload.length;

  let finalReplacements = new Map(fixedReplacements);
  buildStcoReplacements(stcoBoxes, stco, delta, fakeOffset, fakeSampleCount).forEach((value, key) => {
    finalReplacements.set(key, value);
  });

  let moovNew = rebuildBox(moov, finalReplacements);
  const recalculatedMdatPayloadStart = ftyp.size + moovNew.length + preservedBytes.length + 8;
  delta = recalculatedMdatPayloadStart - oldMdatPayloadStart;
  fakeOffset = recalculatedMdatPayloadStart + oldMdatPayload.length;

  finalReplacements = new Map(fixedReplacements);
  buildStcoReplacements(stcoBoxes, stco, delta, fakeOffset, fakeSampleCount).forEach((value, key) => {
    finalReplacements.set(key, value);
  });

  moovNew = rebuildBox(moov, finalReplacements);
  const mdatPayloadNew = concatBytes([oldMdatPayload, FAKE_SAMPLE_BYTES]);
  const mdatNew = makeBox('mdat', mdatPayloadNew);
  const output = concatBytes([boxBytes(ftyp), moovNew, preservedBytes, mdatNew]);

  return {
    output,
    realSamples: realSampleCount,
    fakeSamples: fakeSampleCount,
    fakeSampleSize: FAKE_SAMPLE_SIZE,
    fakeOffset,
    stcoDelta: delta,
  };
}
// ==================== End KECAP MANIS Method ====================

async function handleSelectedFile(file) {
  selectedFile = file || null;
  resetMeta();

  if (patchBtn) patchBtn.disabled = true;

  if (!selectedFile) {
    if (fileNameEl) fileNameEl.textContent = 'Belum ada file dipilih';
    setStatus(`[${timestamp()}] > Tidak ada video yang dipilih.`);
    return;
  }

  if (!selectedFile.type.startsWith('video/')) {
    selectedFile = null;
    if (fileNameEl) fileNameEl.textContent = 'Format file tidak didukung';
    appendLog('ERROR: Pilih file video yang valid.', true);
    return;
  }

  if (fileNameEl) fileNameEl.textContent = selectedFile.name;
  if (sizeValue) sizeValue.textContent = formatBytes(selectedFile.size);
  if (fpsValue) fpsValue.textContent = 'Auto';

  appendLog(`Video dipilih: ${selectedFile.name}`, true);
  appendLog(`Ukuran file: ${formatBytes(selectedFile.size)}`);
  appendLog('Membaca metadata video...');

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

    appendLog(`Resolusi: ${width}x${height}`);

    if (!isResolutionAllowed) {
      selectedFile = null;
      if (patchBtn) patchBtn.disabled = true;
      appendLog('ERROR: Kualitas video terlalu tinggi.');
      appendLog('Maksimal resolusi yang boleh diproses adalah 1080p.');
      appendLog('Video 2K atau 4K tidak diizinkan.');
      return;
    }

    if (patchBtn) patchBtn.disabled = false;

    appendLog('Resolusi valid: maksimal 1080p.');
    appendLog('Siap untuk patch KECAP MANIS.');
  } catch (err) {
    selectedFile = null;
    isResolutionAllowed = false;

    if (patchBtn) patchBtn.disabled = true;

    appendLog(`ERROR: ${err.message}`);
  }
}

if (selectBtn && fileInput) {
  selectBtn.addEventListener('click', () => {
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    selectBtn.addEventListener(eventName, (event) => {
      event.preventDefault();
      selectBtn.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    selectBtn.addEventListener(eventName, (event) => {
      event.preventDefault();
      selectBtn.classList.remove('is-dragover');
    });
  });

  selectBtn.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    handleSelectedFile(file);
  });
}

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    appendLog('Info: proses dilakukan 100% di browser, file tidak dikirim ke server.');
  });
}

if (fileInput) {
  fileInput.addEventListener('change', (event) => {
    handleSelectedFile(event.target.files[0] || null);
  });
}

if (patchBtn) {
  patchBtn.addEventListener('click', async () => {
    if (!selectedFile) {
      setStatus(`[${timestamp()}] > Pilih video dengan resolusi maksimal 1080p terlebih dahulu.`);
      return;
    }

    if (!isResolutionAllowed) {
      setStatus(`[${timestamp()}] > Video ditolak. Hanya resolusi maksimal 1080p yang boleh diproses.`);
      return;
    }

    appendLog('Sistem standby...', true);
    appendLog('Scanning struktur MP4 metode KECAP MANIS...');

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const patch = patchKecapManisSampleTableMethod(arrayBuffer);

      appendLog('Metode KECAP MANIS aktif.');
      appendLog('Tabel sample MP4 berhasil dibangun ulang.');
      appendLog(`Video samples: ${patch.realSamples} asli + ${patch.fakeSamples} paket 8-byte.`);
      appendLog('Membuat file output...');

      const blob = new Blob([patch.output], {
        type: selectedFile.type || 'video/mp4',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const originalName = selectedFile.name.replace(/\.[^/.]+$/, '');

      a.href = url;
      a.download = `${originalName}_KECAP_MANIS.mp4`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);

      appendLog('Download dimulai.');
      appendLog('Selesai.');
    } catch (err) {
      appendLog(`ERROR: ${err.message}`);
    }
  });
}
