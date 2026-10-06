# Admin Panel UI check

`ui-new-features.mjs` runs the real Admin Panel bundle inside `jsdom` against a
running backend and checks the Office Logo card in Settings, the real author
names on Campus Feed, and inline photos in SAA Chat. This environment has no
browser, so it is a regression check, not a replacement for clicking through.

```
cd "admin portal"
npm install --no-save jsdom@24 esbuild   # test-only dependencies
cd test && node build-bundle.mjs
BACKEND=http://localhost:5000 ADMIN_USER=you@psu.edu.ph ADMIN_PASSWORD=... node ui-new-features.mjs
```
