/* Terminal UI and worker orchestration */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const out = $("#output");
  const input = $("#input");
  const runBtn = $("#runBtn");
  const clearBtn = $("#clearBtn");
  const resetBtn = $("#resetBtn");
  const status = $("#status");

  const HISTORY_KEY = "js-term-history-v1";
  let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  let historyIndex = history.length;
  let worker = createWorker();
  let pending = new Map(); // id -> { startedAt }

  function createWorker() {
    const w = new Worker("assets/js/worker.js");
    w.onmessage = (ev) => {
      const msg = ev.data || {};
      switch (msg.type) {
        case "ready":
          setStatus("sandbox ready");
          break;
        case "console":
          renderConsole(msg.method, msg.formatted, msg.ts);
          break;
        case "table":
          renderTable(msg.headers, msg.rows, msg.ts);
          break;
        case "result": {
          const meta = pending.get(msg.id);
          if (meta) {
            const ms = Math.max(0, performance.now() - meta.startedAt).toFixed(1);
            renderResult(msg.formatted, msg.ts, ms);
            pending.delete(msg.id);
            setStatus(`done in ${ms} ms`);
          } else {
            renderResult(msg.formatted, msg.ts, null);
          }
          break;
        }
        case "error":
          renderError(msg.formatted, msg.ts);
          setStatus("error");
          break;
        case "clear":
          out.innerHTML = "";
          break;
        case "status":
          setStatus(msg.text || "");
          break;
        default:
          // ignore
      }
    };
    w.onerror = (e) => {
      renderError(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
    };
    w.onmessageerror = (e) => {
      renderError("message channel error");
    };
    return w;
  }

  function setStatus(text) {
    status.textContent = text;
  }

  function tsString(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString();
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function appendLine(html, classes) {
    const div = document.createElement("div");
    div.className = `line ${classes||""}`.trim();
    div.innerHTML = html;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }

  function renderConsole(method, formatted, ts) {
    const tag = method.toUpperCase();
    const cls = method === "error" ? "err" : method === "warn" ? "warn" : "ok";
    appendLine(
      `<span class="tag">[${esc(tsString(ts))}] ${esc(tag)}</span><div class="content">${formatted}</div>`,
      cls
    );
  }

  function renderTable(headers, rows, ts) {
    const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
    const body = rows
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join("");
    const html = `<div class="table-wrap">
      <table class="console-table" aria-label="console table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
    appendLine(
      `<span class="tag">[${esc(tsString(ts))}] TABLE</span><div class="content">${html}</div>`,
      "ok"
    );
  }

  function renderResult(formatted, ts, ms) {
    const speed = ms != null ? ` <span class="muted">(${ms} ms)</span>` : "";
    appendLine(
      `<span class="tag">[${esc(tsString(ts))}] RESULT</span><div class="content">${formatted}${speed}</div>`,
      "result"
    );
  }

  function renderError(formatted, ts) {
    appendLine(
      `<span class="tag">[${esc(tsString(ts))}] ERROR</span><div class="content">${formatted}</div>`,
      "err"
    );
  }

  function commandHelp() {
    const text = [
      ".help                      show this help",
      ".clear                     clear output",
      ".reset                     reset sandbox",
      ".load <url|name>           load script into sandbox (UMD/CommonJS compatible)",
      ".history                   print input history",
    ].join("\n");
    renderConsole("info", `<pre>${esc(text)}</pre>`);
  }

  function handleCommand(cmdline) {
    const [cmd, ...rest] = cmdline.trim().split(/\s+/);
    switch (cmd) {
      case ".help":
        commandHelp();
        return true;
      case ".clear":
        out.innerHTML = "";
        return true;
      case ".reset":
        worker.terminate();
        worker = createWorker();
        setStatus("sandbox reset");
        return true;
      case ".load": {
        const spec = rest.join(" ");
        if (!spec) {
          renderError("usage: .load <url|name>");
          return true;
        }
        worker.postMessage({ type: "load", spec });
        setStatus(`loading ${spec} ...`);
        return true;
      }
      case ".history": {
        const body = history.map((h, i) => `${String(i+1).padStart(3, " ")}  ${h}`).join("\n");
        renderConsole("info", `<pre>${esc(body)}</pre>`);
        return true;
      }
      default:
        renderError(`unknown command: ${esc(cmd)}`);
        return true;
    }
  }

  function run(code) {
    if (!code.trim()) return;
    if (code.trim().startsWith(".")) {
      handleCommand(code);
      return;
    }
    history.push(code);
    if (history.length > 300) history = history.slice(-300);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    historyIndex = history.length;

    const id = Math.random().toString(36).slice(2);
    pending.set(id, { startedAt: performance.now() });
    worker.postMessage({ type: "eval", id, code });
    setStatus("running ...");
  }

  // UI events
  runBtn.addEventListener("click", () => run(input.value));
  clearBtn.addEventListener("click", () => (out.innerHTML = ""));
  resetBtn.addEventListener("click", () => {
    worker.terminate();
    worker = createWorker();
    setStatus("sandbox reset");
  });

  // Keyboard handling
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      run(input.value);
      e.preventDefault();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const value = input.value;
      input.value = value.slice(0, start) + "  " + value.slice(end);
      input.selectionStart = input.selectionEnd = start + 2;
      return;
    }
    if (e.key === "ArrowUp" && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (historyIndex > 0) {
        historyIndex--;
        input.value = history[historyIndex] || "";
        setTimeout(() => input.setSelectionRange(0, 0), 0);
      }
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      if (historyIndex < history.length - 1) {
        historyIndex++;
        input.value = history[historyIndex] || "";
      } else {
        historyIndex = history.length;
        input.value = "";
      }
      e.preventDefault();
      return;
    }
  });

  // Helpers for demo
  (function seedDemo() {
    if (!localStorage.getItem("js-term-demo-done")) {
      input.value = `console.log('hello');\n2 ** 10\n\n// Top-level await works:\n(await (await fetch('https://api.github.com')).status)`;
      localStorage.setItem("js-term-demo-done", "1");
    }
  })();
})();