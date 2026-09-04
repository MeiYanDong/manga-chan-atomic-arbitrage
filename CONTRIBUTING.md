# Contributing

Keep changes small and attach an acceptance criterion to behavior changes. Run:

```bash
npm ci --no-audit --no-fund
npm run check
```

Pull requests that touch signing, nonce, receipt, balance, arm or RPC failure semantics must add a regression test. Never commit runtime evidence or credentials. A passing CI job is advisory until the repository's branch protection confirms that the job is required.
