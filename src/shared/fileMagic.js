/**
 * Validação de tipo real por magic bytes (anti MIME spoofing).
 */

function detectBufferKind(buffer) {
  if (!buffer || buffer.length < 4) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  if (buffer.toString('ascii', 0, 5) === '%PDF-') {
    return 'pdf';
  }

  return null;
}

const MIME_TO_KIND = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const EXT_BY_KIND = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
};

/**
 * @returns {{ ok: true, kind: string, ext: string } | { ok: false, error: string }}
 */
function validarBufferContraMime(buffer, mimeType) {
  const expected = MIME_TO_KIND[String(mimeType || '').toLowerCase()];
  if (!expected) {
    return { ok: false, error: 'Tipo MIME não permitido' };
  }

  const detected = detectBufferKind(buffer);
  if (!detected) {
    return { ok: false, error: 'Conteúdo do arquivo não reconhecido ou corrompido' };
  }

  if (detected !== expected) {
    return {
      ok: false,
      error: 'O conteúdo do arquivo não corresponde ao formato informado',
    };
  }

  return { ok: true, kind: detected, ext: EXT_BY_KIND[detected] };
}

module.exports = { detectBufferKind, validarBufferContraMime, MIME_TO_KIND };
