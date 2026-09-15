# Story: keep live trading honest when real-time inputs are unavailable

As the operator, I want the system to keep safe recovery scans running while clearly showing that the fast event path
is unavailable, without repeated alerts or provider reconnect storms.

## Acceptance criteria

- A failed initial managed-WSS connection retries after 30, 60, 120, 240, 480 and no more than 900 seconds.
- A successful managed-WSS subscription resets its retry epoch to zero.
- A production WSS repair is admitted only after a secret-safe probe verifies chain ID 4663 and a real subscription;
  neither endpoint nor credential appears in command output, Git or the public API.
- The live state records the retry policy, consecutive failures and next retry time without changing the 60-second
  Earn public-log or five-minute Global recovery commitments.
- When managed Earn WSS and the Sequencer Feed are both observably unavailable, critical health returns
  `LOW_LATENCY_INPUTS_UNAVAILABLE` with state `DEGRADED`.
- Entering that degraded state does not send Feishu. Process death, stale runtime, stalled reconciliation, sustained
  execution failure or loss of every discovery adapter retain the existing critical pages.
- The public business API contains no provider URL, native error, HTTP status, credential, authorization ID or signed
  transaction. It reports only connected paths, recovery delay bounds and the next automatic retry.
- The strategy page presents the real-time and recovery state in concise Chinese.
- No signature, broadcast, Gas spend, principal, profit floor, nonce handling or receipt accounting changes.
