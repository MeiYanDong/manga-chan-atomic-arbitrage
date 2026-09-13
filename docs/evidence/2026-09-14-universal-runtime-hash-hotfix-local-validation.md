# Universal immutable runtime-hash hotfix local validation

Date: 2026-09-14

## Production observation

The guarded v0.14.2 deployment signed and submitted exactly one transaction after its release, fork, nonce and reserve
gates passed. Canonical readback showed:

- transaction `0xa9f9ba79df5cfd8a5fdd9d2018752c5ad70d2fa6a691bb5dd68f86b3e0989f32` succeeded at block `62297386`;
- executor `0xc167e650e8e3279a61d0650d963f65f768b031da` contains 15,891 runtime bytes;
- Gas used was `3,491,410` at `84,804,000 wei`, or `296,085,533,640,000 wei` in total;
- wallet latest and pending nonces both advanced from 27 to 28; and
- the actual runtime hash was `0x189525d9135bb70015874c4afd4d054c06dcf0d20cc7882357431e900a90e0fd`.

The managed reader and official public RPC independently agreed on the successful receipt, deployment address and
runtime hash. Both also read `operator()` as `0x77f771E83f118C32547A1291dda438a757B4b91B` and `MORPHO()` as
`0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`.

The one-shot stopped after the receipt because v0.14.2 had committed the compiler's unmaterialized runtime-template
hash `0x0fda9e64a37fdddea86e1eb3a2fed7f3c70dde0f624e3cef4a3e268229450790`. No second deployment was attempted, and the
unresolved-mutation barrier remained active.

## Root-cause proof

Solc exposes four 32-byte references for the single `operator` immutable. Replacing each zero placeholder with the
ABI-padded reviewed operator produced
`0x189525d9135bb70015874c4afd4d054c06dcf0d20cc7882357431e900a90e0fd`, exactly matching the chain code. This rules out
foreign bytecode and identifies the verifier's template/concrete mismatch.

## Change and fail-closed boundary

- New plans commit the concrete runtime hash before signing.
- The mined v0.14.2 transaction is accepted only through the explicit legacy-template mode described in ADR 0061.
- Foreign code, a foreign planned hash, an unexpected immutable layout, nonzero template placeholders, changed source
  or creation bytecode, wrong operator/Morpho identity, conflicting RPC evidence, or a non-successful receipt all fail.
- Recovery reuses the canonical receipt; it cannot sign, rebroadcast or deploy.

## Local gates

`npm run check` passed after one TypeScript Hex-typing failure was fixed and the entire command was rerun from the
beginning:

- format, ESLint, Solhint and shell syntax: passed;
- TypeScript: passed;
- UI and all contract compilers: passed;
- Node tests: 327 passed, 0 failed;
- four deterministic contract suites: passed; and
- secret scan: 370 files passed.

`systemd-analyze` is unavailable on the macOS validation host. The exact v0.14.2 production units were separately
verified on Linux; only pre-existing Alibaba Cloud Monitor warnings were emitted.
