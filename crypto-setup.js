const { webcrypto } = require('crypto');

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

if (!globalThis.subtle) {
  globalThis.subtle = webcrypto.subtle;
}
