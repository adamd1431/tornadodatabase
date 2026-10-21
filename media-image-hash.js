// The same byte fingerprints and perceptual image hashes power tornado and cyclone scans.
function isImageFileForDuplicateCheck(file) {
  return !!file?.type?.startsWith("image/") && !/gif|svg/i.test(file.type);
}

const SAME_PHOTO_DHASH_DISTANCE = 8;
const SAME_PHOTO_AHASH_DISTANCE = 8;
const SAME_PHOTO_PHASH_DISTANCE = 10;
function imageHashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (!Number.isFinite(xor)) return Infinity;
    distance += xor.toString(2).replace(/0/g, "").length;
  }
  return distance;
}

function bitsToHex(bits) {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, "0"), 2).toString(16);
  }
  return hex;
}

function cleanImageHashPart(value) {
  const hash = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(hash) ? hash : "";
}

function parseStoredImageHash(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return {};
  const parts = raw.split(":");
  if (parts[0] === "v2") {
    return {
      dhash: cleanImageHashPart(parts[1]),
      ahash: cleanImageHashPart(parts[2]),
      phash: cleanImageHashPart(parts[3])
    };
  }
  return { dhash: cleanImageHashPart(raw) };
}

function imageHashesLookSame(a, b) {
  const left = parseStoredImageHash(a);
  const right = parseStoredImageHash(b);
  const dDistance = left.dhash && right.dhash ? imageHashDistance(left.dhash, right.dhash) : Infinity;
  const aDistance = left.ahash && right.ahash ? imageHashDistance(left.ahash, right.ahash) : Infinity;
  const pDistance = left.phash && right.phash ? imageHashDistance(left.phash, right.phash) : Infinity;

  if (pDistance <= SAME_PHOTO_PHASH_DISTANCE) return true;
  if (dDistance <= SAME_PHOTO_DHASH_DISTANCE && aDistance <= SAME_PHOTO_AHASH_DISTANCE) return true;
  if ((!left.ahash || !right.ahash) && dDistance <= SAME_PHOTO_DHASH_DISTANCE) return true;
  return false;
}

function imageGrayPixels(img, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const pixels = [];

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const red = data[i] * alpha + 255 * (1 - alpha);
    const green = data[i + 1] * alpha + 255 * (1 - alpha);
    const blue = data[i + 2] * alpha + 255 * (1 - alpha);
    pixels.push(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  return pixels;
}

function differenceHashFromImage(img) {
  const width = 9;
  const height = 8;
  const pixels = imageGrayPixels(img, width, height);
  let bits = "";

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = y * width + x;
      bits += pixels[left] > pixels[left + 1] ? "1" : "0";
    }
  }

  return bitsToHex(bits);
}

function averageHashFromImage(img) {
  const pixels = imageGrayPixels(img, 8, 8);
  const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  return bitsToHex(pixels.map(value => value >= average ? "1" : "0").join(""));
}

function dctHashFromImage(img) {
  const size = 32;
  const hashSize = 8;
  const pixels = imageGrayPixels(img, size, size);
  const coefficients = [];

  for (let v = 0; v < hashSize; v++) {
    for (let u = 0; u < hashSize; u++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          sum += pixels[y * size + x]
            * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))
            * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
        }
      }
      coefficients.push(sum);
    }
  }

  const lowFrequencies = coefficients.slice(1).sort((a, b) => a - b);
  const median = lowFrequencies[Math.floor(lowFrequencies.length / 2)] || 0;
  return bitsToHex(coefficients.map((value, index) => index === 0 ? "0" : value > median ? "1" : "0").join(""));
}

function perceptualHashFromImage(img) {
  return `v2:${differenceHashFromImage(img)}:${averageHashFromImage(img)}:${dctHashFromImage(img)}`;
}

async function createImageContentHashFromFile(file) {
  if (!isImageFileForDuplicateCheck(file)) return "";
  try {
    const img = await loadImageFromFile(file);
    return perceptualHashFromImage(img);
  } catch (error) {
    console.warn("Could not check selected image content:", error);
    return "";
  }
}

async function createUploadFingerprint(file) {
  if (!file || !globalThis.crypto?.subtle || !file.slice) return "";

  try {
    const chunkSize = 1024 * 1024;
    const parts = [new TextEncoder().encode(`${file.size}|`)];
    parts.push(new Uint8Array(await file.slice(0, Math.min(chunkSize, file.size)).arrayBuffer()));
    if (file.size > chunkSize) {
      const endStart = Math.max(chunkSize, file.size - chunkSize);
      parts.push(new Uint8Array(await file.slice(endStart, file.size).arrayBuffer()));
    }

    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach(part => {
      combined.set(part, offset);
      offset += part.length;
    });

    const digest = await crypto.subtle.digest("SHA-256", combined);
    return [...new Uint8Array(digest)]
      .slice(0, 6)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    console.warn("Could not fingerprint upload:", error);
    return "";
  }
}


function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    const timer = setTimeout(() => finish(new Error('Image scan timed out')), 10000);
    function finish(error) {
      clearTimeout(timer); URL.revokeObjectURL(url);
      img.onload = img.onerror = null;
      if (error) reject(error); else resolve(img);
    }
    img.onload = () => finish();
    img.onerror = () => finish(new Error('Could not read image'));
    img.src = url;
  });
}
export { isImageFileForDuplicateCheck, imageHashesLookSame, perceptualHashFromImage, createImageContentHashFromFile, createUploadFingerprint };
