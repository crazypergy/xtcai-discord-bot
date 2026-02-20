// Utility for Ed25519 signature verification in Cloudflare Workers
// Usage: await verifySignature(publicKey, signature, timestamp, body)

export async function verifySignature(publicKey, signature, timestamp, body) {
  // Convert hex/base64 to Uint8Array
  function hexToUint8Array(hex) {
    return new Uint8Array(
      hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)),
    );
  }

  const encoder = new TextEncoder();
  const publicKeyUint8 = hexToUint8Array(publicKey);
  const signatureUint8 = hexToUint8Array(signature);
  const dataUint8 = encoder.encode(timestamp + body);

  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyUint8,
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
    false,
    ["verify"],
  );

  return await crypto.subtle.verify(
    "NODE-ED25519",
    key,
    signatureUint8,
    dataUint8,
  );
}
