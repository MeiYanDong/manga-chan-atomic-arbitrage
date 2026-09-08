# ADR 0025: user-first operations console with progressive disclosure

- Status: Accepted
- Date: 2026-09-08

## Context

The first business dashboard made receipt-backed profit and delivery state available, but its navigation and visual
hierarchy still reflected the underlying evidence model. Six equal-weight pages, a large candidate table, English
console branding and visible addresses made the product difficult to read as an operator. A scanned candidate was also
too easy to confuse with an executable opportunity.

The economic and provenance evidence must remain inspectable. Removing it would make the interface simpler at the cost
of auditability; leaving it in the primary path would preserve the original usability defect.

## Decision

1. Use four user tasks as the only primary navigation: 总览, 机会, 账单 and 更多.
2. Make the current authorized strategy the homepage subject. Account-wide daily history remains visible, but is
   explicitly separated from the current strategy's post-start result.
3. Divide opportunities into 可以执行, 接近门槛 and 全部观察. The default view is 可以执行; the complete candidate
   population is available only after the operator deliberately selects 全部观察.
4. Show monetary results to two decimals in the primary hierarchy. Exact values, Gas details, hashes, addresses,
   provenance axes and evidence timelines remain available through explicit disclosure controls.
5. Keep source ownership orthogonal. PAIR, LONG, Doppler and generic on-chain pools remain separate, and the interface
   explicitly states that NINECAT is not a PAIR listing.
6. Keep the dashboard loopback-only, same-origin and read-only. This ADR adds no deploy, arm, sign, execute, withdraw or
   arbitrary-link control.
7. Use a calm light financial visual system with a single strong action color. Status colors communicate verified,
   waiting and danger states; they do not imply profit.

## Consequences

- The first screen answers whether the current strategy traded, why it did not trade, what was earned across the account
  today, and where to inspect the next layer.
- The complete evidence remains available without exposing raw machine fields by default.
- Historical hashes and exact values require one deliberate expansion, which is an acceptable extra interaction for
  audit work.
- Existing old dashboard hashes route to their closest new page so saved links fail safely.
- No backend schema, signing boundary, live policy, RPC, amount, Gas or opportunity threshold changes.

## Verification

- View-model tests cover navigation, opportunity stages and human explanations.
- A product-language regression test rejects the former English console vocabulary and ensures raw addresses remain
  behind the technical disclosure.
- The production build must be inspected at phone, tablet and desktop widths, including navigation, opportunity-stage
  switching, transaction disclosure and the evidence drawer.
