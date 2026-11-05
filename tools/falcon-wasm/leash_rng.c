/* randombytes() backed by the platform CSPRNG (crypto.getRandomValues), replacing the deterministic NIST
 * KAT DRBG (katrng.c) that ZKNox links for test vectors. Falcon signing needs fresh randomness. */
#include <emscripten.h>

EM_JS(void, leash_fill_random, (unsigned char *buf, int len), {
  globalThis.crypto.getRandomValues(HEAPU8.subarray(buf, buf + len));
});

int randombytes(unsigned char *x, unsigned long long xlen) {
  while (xlen > 0) {
    int n = xlen > 65536 ? 65536 : (int)xlen;
    leash_fill_random(x, n);
    x += n;
    xlen -= (unsigned long long)n;
  }
  return 0;
}
