# bundle/docs — served operator docs (synced copy, do not edit here)

These are the operator-facing docs the system serves in the **admin Documentation
page** (published to the private MinIO `nhdw-docs` bucket at boot by
`bundle/scripts/seed-docs.sh`). Keeping them **inside the bundle** is what makes
the bundle self-contained — nothing outside `bundle/` is a seed input.

They are **copies**. The editable originals live in the top-level `docs/`
developer folder; `bundle/scripts/sync-docs.sh` (run automatically by `pack.sh`)
copies the curated served set here. **Edit `docs/…` and re-sync — do not edit
these copies directly.** The served set is defined once in both `seed-docs.sh`
(`DOC_ROWS`) and `sync-docs.sh` (`SERVED`).
