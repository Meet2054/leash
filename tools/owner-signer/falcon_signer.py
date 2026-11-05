#!/usr/bin/env python3
"""Leash owner signer: ETHFALCON-512 (Falcon-512 with ZKNox's keccak-based hash-to-point).

Wraps ZKNox's reference Python implementation (contracts/lib/ETHFALCON/pythonref, MIT). It is
the fallback signer for the owner's post-quantum key (spec §9.1) and the source of the
cross-check vectors that prove a signature made off-chain verifies on-chain (gate M2).

Encodings (must match contracts/src/verifiers/EthFalconVerifier.sol):
  pubKey = 32 big-endian words: NTT(h) compacted, 16 coefficients x 16 bits per word (1,024 B)
  sig    = salt (40 B) || s2 compacted to 32 words (1,024 B) = 1,064 B
  message = the 32-byte EIP-712 digest

CLI:
  falcon_signer.py keygen --out keys/owner.json        # writes secret key, prints pubkey + hash
  falcon_signer.py pubkey --key keys/owner.json
  falcon_signer.py sign   --key keys/owner.json --digest 0x<32 bytes>
  falcon_signer.py serve  --key keys/owner.json --port 8787   # localhost-only HTTP signer for the owner app
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.normpath(os.path.join(HERE, "..", "..", "contracts", "lib", "ETHFALCON", "pythonref"))
sys.path.insert(0, REF)

from Crypto.Hash import keccak  # noqa: E402
from common import falcon_compact, q  # noqa: E402
from encoding import decompress  # noqa: E402
from falcon import HEAD_LEN, SALT_LEN, PublicKey, SecretKey  # noqa: E402
from keccak_prng import KeccakPRNG  # noqa: E402
from polyntt.poly import Poly  # noqa: E402

N = 512
WORDS = 32


def _words(ints: list[int]) -> bytes:
    assert len(ints) == WORDS
    return b"".join(x.to_bytes(32, "big") for x in ints)


def keccak256(b: bytes) -> bytes:
    k = keccak.new(digest_bits=256)
    k.update(b)
    return k.digest()


def keygen() -> SecretKey:
    return SecretKey(N)


def save_key(sk: SecretKey, path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"scheme": "ETHFALCON-512", "n": N, "f": sk.f, "g": sk.g, "F": sk.F, "G": sk.G}, f)


def load_key(path: str) -> SecretKey:
    with open(path) as f:
        d = json.load(f)
    assert d["scheme"] == "ETHFALCON-512" and d["n"] == N
    return SecretKey(N, polys=[d["f"], d["g"], d["F"], d["G"]])


def pubkey_bytes(sk: SecretKey) -> bytes:
    ntth = Poly(sk.h, q).ntt()
    return _words(falcon_compact(ntth))


def sign(sk: SecretKey, digest: bytes) -> bytes:
    """Sign a 32-byte digest; returns salt || compact(s2) as the contract expects."""
    assert len(digest) == 32, "digest must be 32 bytes"
    raw = sk.sign(digest, xof=KeccakPRNG)  # fresh randomness from os.urandom
    salt = raw[HEAD_LEN:HEAD_LEN + SALT_LEN]
    s2 = decompress(raw[HEAD_LEN + SALT_LEN:], sk.sig_bytelen - HEAD_LEN - SALT_LEN, N)
    s2 = [c % q for c in s2]
    out = salt + _words(falcon_compact(s2))
    assert len(out) == SALT_LEN + WORDS * 32
    # self-check with the reference verifier before handing the signature out
    assert PublicKey(N, sk.h).verify(digest, raw, xof=KeccakPRNG), "reference verify failed"
    return out


def _hex(b: bytes) -> str:
    return "0x" + b.hex()


def _parse_digest(s: str) -> bytes:
    b = bytes.fromhex(s[2:] if s.startswith("0x") else s)
    if len(b) != 32:
        raise ValueError("digest must be 32 bytes")
    return b


def serve(sk: SecretKey, port: int) -> None:
    pub = pubkey_bytes(sk)
    info = {"scheme": "ETHFALCON-512", "pubKey": _hex(pub), "pubKeyHash": _hex(keccak256(pub))}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", os.environ.get("SIGNER_ALLOW_ORIGIN", "http://localhost:3000"))
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:  # CORS preflight
            self._send(204, {})

        def do_GET(self) -> None:
            if self.path == "/pubkey":
                self._send(200, info)
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path != "/sign":
                return self._send(404, {"error": "not found"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
                digest = _parse_digest(body["digest"])
            except Exception as e:  # noqa: BLE001
                return self._send(400, {"error": f"bad request: {e}"})
            label = body.get("label", "")
            print(f"[owner-signer] signing {label or 'digest'} {_hex(digest)}", flush=True)
            self._send(200, {"sig": _hex(sign(sk, digest)), **info})

        def log_message(self, *args) -> None:  # quiet
            pass

    # bind to loopback only: the key never leaves this machine
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("keygen")
    k.add_argument("--out", required=True)
    p = sub.add_parser("pubkey")
    p.add_argument("--key", required=True)
    s = sub.add_parser("sign")
    s.add_argument("--key", required=True)
    s.add_argument("--digest", required=True)
    v = sub.add_parser("serve")
    v.add_argument("--key", required=True)
    v.add_argument("--port", type=int, default=8787)
    a = ap.parse_args()

    if a.cmd == "keygen":
        if os.path.exists(a.out):
            sys.exit(f"refusing to overwrite existing key {a.out}")
        sk = keygen()
        save_key(sk, a.out)
        pub = pubkey_bytes(sk)
        print(json.dumps({"pubKey": _hex(pub), "pubKeyHash": _hex(keccak256(pub))}))
    elif a.cmd == "pubkey":
        pub = pubkey_bytes(load_key(a.key))
        print(json.dumps({"pubKey": _hex(pub), "pubKeyHash": _hex(keccak256(pub))}))
    elif a.cmd == "sign":
        sk = load_key(a.key)
        print(json.dumps({"sig": _hex(sign(sk, _parse_digest(a.digest)))}))
    elif a.cmd == "serve":
        serve(load_key(a.key), a.port)


if __name__ == "__main__":
    main()
