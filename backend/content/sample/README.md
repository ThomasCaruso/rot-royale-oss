# Synthetic sample content

Everything here is **invented for this repository**. None of it is production Rot Royale content,
and none of it appears in a live ranked contest.

The questions describe a fictional setting (Aldoria, Tern, the Sill delta) precisely so they cannot
collide with the real bank *or* with any real-world trivia corpus — a paraphrased production
question would defeat the point, and so would a generic fact that might coincidentally match one.

## Why this exists

The public source tree must not contain information sufficient to predict or reconstruct a live
challenge. The Daily Royale seed is a pure function of `(contest_date, slot)` and `build_round_set`
is deterministic — both are fully public and unchanged. That is safe **because the data is not
here**. Publishing the algorithm is fine; publishing the answers is not.

So the corpus moved behind one boundary:

```
ROT_CONTENT_DIR unset, APP_ENV != production   ->  this directory
ROT_CONTENT_DIR set                            ->  exactly that directory
ROT_CONTENT_DIR unset, APP_ENV == production   ->  refuse to start
```

There is no fallback from production to this corpus. Serving placeholder questions in a ranked
contest would be a worse failure than not booting, and it would be silent.

## Layout

| Path | Contents |
|------|----------|
| `bank/*.json` | 30 trivia questions across 6 categories (ingest schema) |
| `estimate/fermi.json` | 8 Fermi estimation items |
| `change/manifest.json` + PNGs | 2 change-detection pairs |
| `trivia.json` | the legacy seed schema, same 30 questions |

The change-detection images are drawn programmatically — flat circles and squares on a grid. They
are test fixtures, not Rot Royale artwork, and are regenerated rather than edited.

## Enough to run, not enough to play seriously

A fresh clone can boot, ingest, enter a contest, answer rounds and settle. It is **not** enough for
campaign mode, which needs 100 questions per world with a fixed difficulty spread; suites that
depend on that are skipped and say so (`tests/conftest.py`).

## Adding to it

Invent new material. Do not copy, translate, or reword production questions — `tests/
test_no_production_content.py` fingerprints every question-shaped record in the tree against this
corpus and fails on anything it does not recognise.
