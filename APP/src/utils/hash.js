// Simple hex encoder
function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Fallback non-cryptographic hash (djb2 variant) for insecure contexts
function djb2(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  // Produce 32 bytes from 32-bit hash by repeating and mixing
  const bytes = new Uint8Array(32);
  let h = hash >>> 0;
  for (let i = 0; i < 32; i++) {
    // xorshift
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    bytes[i] = h & 0xff;
  }
  return toHex(bytes);
}

export async function hashHex(text) {
  try {
    if (
      typeof window !== "undefined" &&
      window.crypto &&
      window.crypto.subtle
    ) {
      const enc = new TextEncoder();
      const buf = await window.crypto.subtle.digest(
        "SHA-256",
        enc.encode(text)
      );
      return toHex(new Uint8Array(buf));
    }
  } catch (_) {
    // ignore and fallback
  }
  // Fallback (NOT cryptographically secure). Only for demo/offline contexts.
  return djb2(text);
}
