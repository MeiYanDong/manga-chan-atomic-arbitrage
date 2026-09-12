# Earn sizing and hot-path v4 stories

## Story 1: improve route sizing without increasing quote work

As the strategy owner, I want each committed Earn route to receive a full-range coarse search followed by a local exact
refinement so that the selected input is at least as precise around the observed optimum while the public quote budget
falls below the previous 96-call wake.

Acceptance:

- all spendable principal remains reachable;
- each of four routes receives eight coarse quotes and at most six refinement quotes;
- refinement uses only adjacent successful quotes around that route's coarse winner;
- public exact quote count is at most 56; and
- failed quotes cannot become candidates or silently enlarge the spendable range.

## Story 2: do not repeat the full search on the paid execution provider

As the operator, I want a public-positive Opportunity to freeze one committed route and a local amount bracket before
managed escalation so that paid calls and decision latency shrink without weakening current-block execution truth.

Acceptance:

- the managed stage accepts only an ID in the committed route book;
- its bracket is clipped to the current spendable balance;
- it makes at most nine exact quotes and one-route Gas selection;
- it rechecks protocol identity, nonce, balance, Gas, protected output and final call at a current block; and
- a negative or changed managed quote produces `NO_SHOT` without signing.

## Story 3: bind the new semantics to a fresh authorization

As the wallet owner, I want the algorithm, quote ceilings and event cadence committed into the authorization ID so that
a code or configuration mismatch stops the only signer rather than changing live behavior silently.

Acceptance:

- policy version is v4;
- invalid algorithm, probe values and quote ceilings are rejected;
- the v3 arm cannot start the v4 watcher;
- cutover requires durable revocation, clean reconciliation and a new arm; and
- unlimited counts do not remove Gas, reserve, nonce, output-floor or receipt constraints.

## Story 4: measure the event-to-wire boundary honestly

As the strategy analyst, I want the public event's receive time and chain identifiers recorded before the child
preflight begins so that later receipt studies can measure source-to-plan/sign/broadcast latency without inferring it
from a process heartbeat.

Acceptance:

- event block, transaction hash and log index come from the reviewed Vault log;
- `sourceReceivedAt` is recorded only after the log response is observed;
- startup and periodic wakes remain distinguishable from pool events;
- the evidence is copied into the immutable mutation plan; and
- missing event timing remains null rather than being guessed.
