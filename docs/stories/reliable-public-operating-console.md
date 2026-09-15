# Story: Reliable public operating console

As the strategy owner, I need capital, portfolio and receipt evidence to remain readable when market discovery is busy,
so a scanner cycle cannot make the operating console appear offline.

## Acceptance criteria

- `/api/v1/business` is served without a request to the opportunity-board process.
- Only the validated sanitized snapshot is published, by atomic rename, with a visible generation timestamp.
- The Nginx worker can read the file; no private key, RPC credential, signer or mutation endpoint is added.
- Existing dashboard installation verifies the endpoint before completing.
- Formatting, lint, type checks, unit tests, contract tests and secret scanning pass.
