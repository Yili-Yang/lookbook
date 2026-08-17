// Sharing without a server: encode a look into the page URL, and render a
// still image people can post to Instagram / Stories / anywhere that wants a
// photo rather than a link. Social accounts are credited in the caption — the
// browser cannot post into Instagram or X for you without their OAuth APIs.

const SHARE_PROFILE_KEY = 'lookbook-share-profile';
const LOOK_HASH_PREFIX = '#look=';
// Soft ceiling so the shared URL stays under typical browser / messenger limits.
const SHARE_URL_SOFT_LIMIT = 12000;
const SHARE_EMBED_IMAGE_LIMIT = 55000;

function loadShareProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARE_PROFILE_KEY) || '{}');
    return {
      instagram: String(raw.instagram || '').replace(/^@/, '').trim(),
      x: String(raw.x || '').replace(/^@/, '').trim(),
    };
  } catch (e) {
    console.error('[share] loadShareProfile parse error:', e);
    return { instagram: '', x: '' };
  }
}

function saveShareProfile({ instagram = '', x = '' } = {}) {
  try {
    localStorage.setItem(SHARE_PROFILE_KEY, JSON.stringify({
      instagram: String(instagram || '').replace(/^@/, '').trim(),
      x: String(x || '').replace(/^@/, '').trim(),
    }));
    return true;
  } catch (e) {
    console.error('[share] saveShareProfile failed:', e);
    return false;
  }
}

function primaryShareHandle(profile = loadShareProfile()) {
  return profile.instagram || profile.x || '';
}

function shareCaption(look, profile = loadShareProfile()) {
  const lines = [look.title || 'Look'];
  const pieces = (look.pieces || [])
    .map(piece => [piece.brand, piece.name].filter(Boolean).join(' '))
    .filter(Boolean);
  if (pieces.length) lines.push(pieces.join(' · '));
  const handle = primaryShareHandle(profile);
  if (handle) lines.push(`@${handle}`);
  return lines.join('\n');
}

function lookSharePayload(look, profile = loadShareProfile()) {
  return {
    v: 1,
    t: look.title || '',
    n: look.notes || '',
    h: primaryShareHandle(profile),
    p: (look.pieces || []).map(piece => sharePiecePayload(piece)),
  };
}

function sharePiecePayload(piece) {
  const imageUrl = piece.imageUrl || '';
  let imageData = '';
  // Prefer the shop URL in the link so it stays short. Only embed a stored
  // photo when that is all we have (paste / upload with no product page).
  if (!imageUrl && piece.imageData && piece.imageData.length <= SHARE_EMBED_IMAGE_LIMIT) {
    imageData = piece.imageData;
  }
  return {
    name: piece.name || '',
    brand: piece.brand || '',
    price: piece.price || '',
    productUrl: piece.productUrl || '',
    imageUrl,
    imageData,
  };
}

function payloadToLook(payload) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.p)) return null;
  return {
    id: typeof uuid === 'function' ? uuid() : `shared-${Date.now()}`,
    title: String(payload.t || 'Shared look'),
    notes: String(payload.n || ''),
    starred: false,
    createdAt: Date.now(),
    sharedFrom: payload.h ? String(payload.h) : '',
    pieces: payload.p.map(piece => ({
      productUrl: piece.productUrl || '',
      imageUrl: piece.imageUrl || '',
      imageData: piece.imageData || '',
      name: piece.name || 'Untitled piece',
      brand: piece.brand || '',
      price: piece.price || '',
    })),
  };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function compressShareText(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') {
    return 'r' + bytesToBase64Url(bytes);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return 'g' + bytesToBase64Url(new Uint8Array(buffer));
}

async function decompressShareText(encoded) {
  const kind = encoded[0];
  const body = encoded.slice(1);
  const bytes = base64UrlToBytes(body);
  if (kind === 'r') return new TextDecoder().decode(bytes);
  if (kind !== 'g' || typeof DecompressionStream === 'undefined') {
    throw new Error('unsupported_share_payload');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function encodeLookShare(look, profile = loadShareProfile()) {
  let payload = lookSharePayload(look, profile);
  let encoded = await compressShareText(JSON.stringify(payload));

  // Drop embedded photos first if the link is still too long, then notes.
  if (encoded.length > SHARE_URL_SOFT_LIMIT) {
    payload = {
      ...payload,
      p: payload.p.map(piece => ({ ...piece, imageData: '' })),
    };
    encoded = await compressShareText(JSON.stringify(payload));
  }
  if (encoded.length > SHARE_URL_SOFT_LIMIT) {
    payload = { ...payload, n: '' };
    encoded = await compressShareText(JSON.stringify(payload));
  }
  return encoded;
}

async function decodeLookShare(encoded) {
  try {
    const json = await decompressShareText(encoded);
    return payloadToLook(JSON.parse(json));
  } catch (e) {
    console.error('[share] decodeLookShare failed:', e);
    return null;
  }
}

async function lookShareUrl(look, { origin = location.href } = {}) {
  const encoded = await encodeLookShare(look);
  const base = String(origin).split('#')[0].split('?')[0];
  return `${base}${LOOK_HASH_PREFIX}${encoded}`;
}

function readSharedLookHash(hash = location.hash) {
  if (!hash || !hash.startsWith(LOOK_HASH_PREFIX)) return '';
  return hash.slice(LOOK_HASH_PREFIX.length);
}

function clearSharedLookHash() {
  if (!location.hash.startsWith(LOOK_HASH_PREFIX)) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

function loadImageForShare(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('empty_image'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    // Data URLs never need CORS; stored photos are preferred for the card so
    // the canvas stays untainted and the download works everywhere.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.src = src.startsWith('data:') || typeof proxiedImageUrl !== 'function'
      ? src
      : proxiedImageUrl(src, { width: 900 });
  });
}

function drawContainedImage(ctx, img, x, y, width, height) {
  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = x + (width - drawW) / 2;
  const dy = y + (height - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function wrapShareText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Instagram-friendly 4:5 card with the look photos and an optional handle.
async function renderShareCardBlob(look, profile = loadShareProfile()) {
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f5f1ea';
  ctx.fillRect(0, 0, width, height);

  const pieces = look.pieces || [];
  const photoTop = 72;
  const photoHeight = 820;
  const gutter = 28;
  const side = 48;
  const count = Math.max(pieces.length, 1);
  const cellWidth = (width - side * 2 - gutter * (count - 1)) / count;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(side - 16, photoTop - 16, width - (side - 16) * 2, photoHeight + 32);

  for (let i = 0; i < pieces.length; i++) {
    const src = (typeof pieceImage === 'function' ? pieceImage(pieces[i]) : null)
      || pieces[i].imageData
      || pieces[i].imageUrl
      || '';
    const x = side + i * (cellWidth + gutter);
    ctx.fillStyle = '#efeae2';
    ctx.fillRect(x, photoTop, cellWidth, photoHeight);
    if (!src) continue;
    try {
      const img = await loadImageForShare(src);
      drawContainedImage(ctx, img, x + 18, photoTop + 18, cellWidth - 36, photoHeight - 36);
    } catch {
      // Leave the empty cell; the title and piece names still carry the look.
    }
  }

  const textLeft = side;
  const textWidth = width - side * 2;
  let textY = photoTop + photoHeight + 72;

  ctx.fillStyle = '#1a1a17';
  ctx.font = 'italic 54px Georgia, "Times New Roman", serif';
  for (const line of wrapShareText(ctx, look.title || 'Look', textWidth)) {
    ctx.fillText(line, textLeft, textY);
    textY += 62;
  }

  const pieceLine = pieces
    .map(piece => [piece.brand, piece.name].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('  ·  ');
  if (pieceLine) {
    textY += 12;
    ctx.fillStyle = '#6b6b63';
    ctx.font = '28px Inter, system-ui, sans-serif';
    for (const line of wrapShareText(ctx, pieceLine, textWidth)) {
      ctx.fillText(line, textLeft, textY);
      textY += 36;
    }
  }

  const handle = primaryShareHandle(profile) || look.sharedFrom || '';
  ctx.fillStyle = '#1a1a17';
  ctx.font = '26px Inter, system-ui, sans-serif';
  ctx.fillText(handle ? `@${handle}` : 'Lookbook', textLeft, height - 56);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('card_render_failed'))), 'image/jpeg', 0.92);
  });
}

function slugifyLookTitle(title) {
  return String(title || 'look')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'look';
}

async function downloadShareCard(look, profile = loadShareProfile()) {
  const blob = await renderShareCardBlob(look, profile);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugifyLookTitle(look.title)}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function nativeShareLook(look, profile = loadShareProfile()) {
  const caption = shareCaption(look, profile);
  const url = await lookShareUrl(look);
  const data = { title: look.title || 'Look', text: caption, url };

  try {
    const blob = await renderShareCardBlob(look, profile);
    const file = new File([blob], `${slugifyLookTitle(look.title)}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ ...data, files: [file] });
      return 'files';
    }
  } catch (e) {
    // Fall through to text/url share — canvas or file share can fail on desktop.
    if (e?.name === 'AbortError') return 'aborted';
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'url';
    } catch (e) {
      if (e?.name === 'AbortError') return 'aborted';
      throw e;
    }
  }
  return 'unsupported';
}

function twitterIntentUrl(look, shareUrl, profile = loadShareProfile()) {
  const text = shareCaption(look, profile);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
}

function whatsappShareUrl(look, shareUrl, profile = loadShareProfile()) {
  const text = `${shareCaption(look, profile)}\n${shareUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function instagramProfileUrl(handle) {
  const clean = String(handle || '').replace(/^@/, '').trim();
  return clean ? `https://instagram.com/${encodeURIComponent(clean)}` : '';
}

function xProfileUrl(handle) {
  const clean = String(handle || '').replace(/^@/, '').trim();
  return clean ? `https://x.com/${encodeURIComponent(clean)}` : '';
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}
