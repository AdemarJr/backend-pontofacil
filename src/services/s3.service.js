// src/services/s3.service.js
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.AWS_BUCKET_NAME || 'pontofacil-fotos';

/** Credenciais reais (não placeholder do .env.example) */
function isS3Configured() {
  if (process.env.AWS_S3_ENABLED === 'false') return false;
  const ak = process.env.AWS_ACCESS_KEY_ID?.trim();
  const sk = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!ak || !sk) return false;
  if (/sua_access|your_access|changeme|example|placeholder/i.test(ak)) return false;
  if (ak.length < 16) return false;
  return true;
}

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

const MAX_INLINE_FOTO_BYTES = 5 * 1024 * 1024;

async function uploadFoto(base64String, tenantId, usuarioId) {
  // Remove prefixo data:image/...;base64,
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > MAX_INLINE_FOTO_BYTES) {
    const err = new Error('Foto excede o tamanho máximo permitido');
    err.status = 400;
    throw err;
  }

  // Sem S3: guarda a imagem no próprio registro (data URL) — adequado para dev; em produção use AWS
  if (!isS3Configured()) {
    return { key: null, url: base64String };
  }

  // Detecta formato da imagem
  const formato = base64String.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpeg';

  const timestamp = Date.now();
  const key = `fotos/${tenantId}/${usuarioId}/${timestamp}.${formato}`;

  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: `image/${formato}`,
    // Metadados para auditoria
    Metadata: {
      tenantId,
      usuarioId,
      timestamp: timestamp.toString(),
    },
    // Nunca público
    ACL: undefined,
  }));

  return { key, url: null }; // URL sempre gerada via signed URL
}

const MAX_COMPROVANTE_IMAGE = 5 * 1024 * 1024;
const MAX_COMPROVANTE_PDF = 8 * 1024 * 1024;
const MIME_COMPROVANTE = {
  'image/jpeg': { ext: 'jpg', tipo: 'imagem', max: MAX_COMPROVANTE_IMAGE },
  'image/png': { ext: 'png', tipo: 'imagem', max: MAX_COMPROVANTE_IMAGE },
  'image/webp': { ext: 'webp', tipo: 'imagem', max: MAX_COMPROVANTE_IMAGE },
  'application/pdf': { ext: 'pdf', tipo: 'pdf', max: MAX_COMPROVANTE_PDF },
};

/**
 * Atestado / comprovante em foto ou PDF (data URL base64).
 * @returns {{ key: string|null, url: string|null, mimeType: string, tipoArquivo: string }}
 */
async function uploadComprovante(dataUrl, tenantId, usuarioId) {
  const raw = String(dataUrl || '').replace(/\s/g, '');
  const m = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (!m) {
    const err = new Error('Envie o arquivo em base64 (data URL: data:image/...;base64,... ou application/pdf)');
    err.status = 400;
    throw err;
  }
  const mime = m[1].toLowerCase().split(';')[0].trim();
  const spec = MIME_COMPROVANTE[mime];
  if (!spec) {
    const err = new Error('Formato não permitido. Use JPG, PNG, WebP ou PDF.');
    err.status = 400;
    throw err;
  }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > spec.max) {
    const err = new Error(
      spec.tipo === 'pdf' ? 'PDF excede o tamanho máximo (8 MB)' : 'Imagem excede o tamanho máximo (5 MB)'
    );
    err.status = 400;
    throw err;
  }

  if (!isS3Configured()) {
    return {
      key: null,
      url: raw.length > 12 * 1024 * 1024 ? null : raw,
      mimeType: mime,
      tipoArquivo: spec.tipo,
    };
  }
  if (raw.length > 12 * 1024 * 1024) {
    const err = new Error('Arquivo muito grande para processar');
    err.status = 400;
    throw err;
  }

  const timestamp = Date.now();
  const key = `comprovantes/${tenantId}/${usuarioId}/${timestamp}.${spec.ext}`;
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mime,
      Metadata: { tenantId, usuarioId, tipo: 'comprovante_ausencia' },
    })
  );
  return { key, url: null, mimeType: mime, tipoArquivo: spec.tipo };
}

// Gera URL temporária (15 minutos) para exibição segura
async function gerarUrlAssinada(key, expiracaoSegundos = 900) {
  if (!key) return null;
  try {
    const s3 = getS3Client();
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return await getSignedUrl(s3, command, { expiresIn: expiracaoSegundos });
  } catch {
    return null;
  }
}

module.exports = { uploadFoto, uploadComprovante, gerarUrlAssinada, isS3Configured };
