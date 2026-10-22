# gh-v1 assets

Empty by design. gh-v1 declares no `ministry.logo` in `profile.yaml`, so the
dashboards render the bundled Palladium word-mark rather than a crest. A real
Ghana deployment drops the owning organisation's logo here (e.g. `logo-ghs.png`)
and names it under `ministry.logo`; the gateway then serves it from
`/api/profile/asset/<name>` and the SPAs show it in place of the word-mark.

Shipping another country's crest under this profile would be worse than shipping
none, which is why there is no fallback file here.
