/**
 * Diagnostics encryption module.
 *
 * Uses RSA-OAEP (4096-bit) + AES-256-GCM hybrid encryption so that only
 * holders of the private key (developers) can decrypt the diagnostics archive.
 *
 * File format of the encrypted output (.enc):
 *   [4 bytes]  – magic: "DIAG"
 *   [1 byte]   – format version (currently 0x01)
 *   [8 bytes]  – creation timestamp (BigUInt64BE, ms since Unix epoch)
 *   [2 bytes]  – big-endian uint16: length of the encrypted AES key
 *   [N bytes]  – RSA-OAEP encrypted AES-256 key (N = value from above)
 *   [12 bytes] – AES-GCM initialisation vector (IV / nonce)
 *   [16 bytes] – AES-GCM authentication tag
 *   [rest]     – AES-256-GCM ciphertext
 *
 * AAD (Additional Authenticated Data) covers bytes from DIAG through the
 * encrypted AES key (inclusive).  This authenticates the header so that
 * flipping the version, timestamp, or substituting a different encrypted key
 * is detected by GCM before any plaintext is released.
 */

import crypto from 'node:crypto';

const MAGIC = Buffer.from('DIAG');

/**
 * Format version byte (currently 0x01).
 *
 * Key rotation procedure:
 *   1. Generate a new RSA-4096 key pair
 *   2. Bump FORMAT_VERSION to 0x02
 *   3. Replace PUBLIC_KEY_PEM with the new public key
 *   4. Update PUBLIC_KEY_SHA256 with the new fingerprint
 *   5. Update decrypt-diagnostics.mjs to accept version 0x02 with the new private key
 *   6. Keep the old private key to decrypt archives from version 0x01
 */
const FORMAT_VERSION = 0x01;

/**
 * SHA-256 fingerprint of the embedded public key.
 * Used at startup to detect accidental corruption or tampering.
 * Regenerate with: node -e "import('node:crypto').then(c=>console.log(c.createHash('sha256').update(KEY_PEM).digest('hex')))"
 */
const PUBLIC_KEY_SHA256 = 'e01d8a1c6c2b800772495b3f656b10899364ece0e82d846f7d33f61cdffbd451';

// Embedded RSA-4096 public key (PEM).
// Only the matching private key (held by developers) can decrypt.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEArho8/7NwaYsZ3r27Lzek
mJXOdSOtjuxKLWHxS40Hf6MFskF/dSwY8om0NZ22Qa/cygStAiP4eAmL1fEuNqlS
JnoFgCtg6myFQVfeep9FWAJruR7EGp4WgiXopq8pvxSkJixZaYin2cch7CwUA5g9
b2AcErlfAmZM6F0Sd9v5Q7rHF68x3MINi3BTDKsz/3KqkoJoxyosKjMNDNATEn/T
y/yAF1/kELg7SJgnheWRoFK6130DEPzbym+TTxSZZOHeAtw27ALXoYGmnv09uq0K
Bks4wOrvW8gWQpbMOfpbc3XeWsP7bOuIXr/fs3kXgHIZoJSiLW7JlsivL9z5NDl6
UBxRyR0KOnK07Cx2xvl5pXfAOxQnc8F1JtjclzCHG6Q5sfq7isoMcpPuxDlEepgm
FNkJi71G4+lWgTotQr/fTVeZ46IxXrtnq89pb0fE20WYMaHnXkz0FMCIjMjuQWEP
R0zjeaRO8wZ3sqMgWSy2TldFsh709GqVUiS0YRUoVT1oExc27P47EFUNh57qI7bI
tcEIHVhBqyawK+WrIC+vgBgAPg6w5klxVhUaWGltubIFSm86BxNDTGx7C6rllcRU
pirqSQAW3PgOCg6d3lfkGLHVRsC+j6xsv1xC6clR6MKzklp7qz6uuOmf9GIdu+qE
9U0RwKqGYSp/N8TF5n3p3s0CAwEAAQ==
-----END PUBLIC KEY-----`;

/**
 * Encrypt a buffer so that only the developer private key can decrypt it.
 *
 * @param {Buffer} plainBuffer – the raw data (e.g. a .tar.gz archive)
 * @returns {Buffer} – the encrypted envelope (see file format above)
 */
export function encryptDiagnostics(plainBuffer) {
  // Verify public key integrity before using it
  const keyHash = crypto.createHash('sha256').update(PUBLIC_KEY_PEM).digest('hex');
  if (keyHash !== PUBLIC_KEY_SHA256) {
    throw new Error('Diagnostics encryption key integrity check failed — the embedded public key may have been tampered with.');
  }

  // 1. Generate random AES-256 key and IV
  const aesKey = crypto.randomBytes(32); // 256 bits
  const iv = crypto.randomBytes(12);     // 96-bit nonce for GCM

  // 2. Wrap the AES key with the developer's RSA public key
  const encryptedKey = crypto.publicEncrypt(
    {
      key: PUBLIC_KEY_PEM,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey,
  );

  // 3. Build the header and use it as AAD for GCM
  //    [4: DIAG][1: version][8: timestamp][2: keyLen][N: encryptedKey]
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(BigInt(Date.now()));

  const keyLenBuf = Buffer.alloc(2);
  keyLenBuf.writeUInt16BE(encryptedKey.length);

  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), tsBuf, keyLenBuf, encryptedKey]);

  // 4. Encrypt the payload with AES-256-GCM, using the header as AAD
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // Scrub the plaintext AES key from memory
  aesKey.fill(0);

  // 5. Pack: [header][12: iv][16: authTag][rest: ciphertext]
  return Buffer.concat([header, iv, authTag, encrypted]);
}
