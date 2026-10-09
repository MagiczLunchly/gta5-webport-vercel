# GTA V browser deployment

Vercel serves the browser engine, shaders, metadata and prebuilt startup batches.
An Edge function serves game-file ranges and ordered batches from fixed,
range-addressable release packs. The game keeps its existing browser cache.

The source snapshot is build `8b0b5899ed` from `playgta5.com`, supplied through
the offline archive. A WebGPU-capable desktop browser is required.

Run `npm test` to check range translation, batch ordering, validation and
upstream failures. Run `npm run build` to create Vercel Build Output API files.

The release must contain every pack in `asset-index.json` before the site can
load the world. Pack files are prepared locally outside this source project.
Game data is published in the `game-data-v1` GitHub release for this deployment.
