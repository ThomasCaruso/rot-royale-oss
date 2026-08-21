# Security policy

## Reporting a vulnerability

Please report privately, not in a public issue.

Use GitHub's **[Report a vulnerability](../../security/advisories/new)** form, or email
**thomas@novasolutions-ai.com** with `SECURITY` in the subject.

Include what you did, what happened, and what you expected. A proof of concept helps but is not
required to report something.

You should get an acknowledgement within a few days. This is a small project; there is no bounty
programme and no guaranteed timeline, but reports are taken seriously and you will be told what
happened.

Please give a reasonable opportunity to fix an issue before disclosing it publicly.

## What is in scope

This repository: the API, the SPA, the deployment configuration, and the contest logic.

The classes of bug that matter most here, because the game's integrity depends on them:

- **Answer disclosure.** A `client_spec` must never contain the answer to its own round. If you can
  obtain a correct answer before submitting, that is a serious bug regardless of how obscure the
  route.
- **Score or currency forgery.** The server is authoritative for scores, coins, gems, rating and
  standings. Client-supplied scores are ignored by design; a path that changes that is in scope.
- **Ledger inconsistency.** Coins and gems are append-only ledgers, and a balance that can diverge
  from its ledger sum is a bug even without a way to profit from it.
- **Contest fairness.** Anything that lets one player receive different questions, more attempts, or
  a second entry in a window.
- Ordinary web security: authentication, authorisation, injection, SSRF, path traversal.

## What is out of scope

- The **live service** at rotroyale.live. Do not test against production. Run it locally; that is
  what the sample corpus is for.
- **Private content.** Question banks and artwork are not in this repository. Attempting to obtain
  them from the live service is not research.
- The **sample corpus** having low-quality questions. It is synthetic by design.
- Missing hardening that has no exploit path — reports consisting only of a scanner's output are
  unlikely to get a detailed reply.
- Social engineering, physical access, or denial of service by volume.

## A note on the seeded Daily Royale

Every player in a window receives the same questions in the same order. This is intentional (see
`CLAUDE.md` §9): it makes scores comparable and shares meaningful. It also means the day's questions
are learnable within the 24-hour window by someone who plays early and tells someone else.

That is an accepted trade-off in a game with no money attached, not an oversight. Answers still
never leave the server, and client scores are still never trusted.
