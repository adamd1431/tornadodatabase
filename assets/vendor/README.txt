Bzip2 decoder: @foxglove/wasm-bz2 0.3.0, from the official npm registry.
Upstream: https://github.com/foxglove/wasm-bz2
Licenses: bzip2-foxglove-LICENSE.txt (MIT wrapper); bzip2-LICENSE.txt (libbzip2).
bzip2.wasm is the original package binary. bzip2-module.js only changes browser/worker loading, the relative wasm URL, and the ESM export. bzip2.js provides bounded output, concatenated JMA stream handling and memory cleanup.
No decoder, raw scan, or resulting image is stored in Supabase.
