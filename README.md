# JavaScript Terminal (GitHub Pages ready)

A self-contained JavaScript terminal that runs user code in a sandboxed Web Worker. No backend. Drop into GitHub Pages.

## Features

- Web Worker sandbox. Main UI stays safe if code misbehaves.
- `console.log/info/warn/error/debug` capture.
- `console.table` rendering.
- Top‑level `await` support.
- Result preview for common JS types.
- History with ↑/↓. Stored in `localStorage`.
- Keyboard-friendly: `Shift+Enter` runs code; plain `Enter` inserts a newline.
- Commands:
  - `.help` — show help
  - `.clear` — clear output
  - `.reset` — restart sandbox
  - `.load <url|name>` — load classic script into sandbox. Bare names map to jsDelivr UMD heuristics (e.g., `lodash`, `dayjs`).

## Deploy on GitHub Pages

1. Create a repo. Copy these files to the repo root.
2. Commit and push.
3. In repo settings, enable **Pages** → **Source: Deploy from a branch** → **Branch: `main` / `/`**.
4. Open the Pages URL. The terminal loads at `/`.

## Local run

Open `index.html` directly in a browser. No server required in browsers that allow Web Workers on `file://` URLs. If your browser blocks Web Workers for local files (Chrome does, for example), launch a tiny static server and open the `http://` URL instead:

```bash
npx serve .
# or
python -m http.server 8080
```

## Notes

- The sandbox is a **classic Worker**. `.load` uses `importScripts()`. Prefer UMD-style bundles.
- If code enters an infinite loop, click **Reset** to recreate the sandbox.
- CSP: The project does not set a CSP. If you add one, allow `unsafe-eval` inside the **Worker** or avoid eval-based expression mode.

## Example snippets

```js
console.log('hello');
2 ** 10;

await (await fetch('https://api.github.com')).status;

console.table([{a:1,b:2},{a:3,b:4}]);

// Load lodash and use it
// .load lodash
_.chunk([1,2,3,4,5,6,7], 3);
```

MIT License.
