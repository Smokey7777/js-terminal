/* Sandboxed evaluator running inside a Web Worker */
(function () {
  const ts = () => Date.now();

  // --- formatting utilities ---
  function typeOf(x) {
    return Object.prototype.toString.call(x).slice(8, -1);
  }

  function formatValue(val, depth = 0, seen = new WeakSet()) {
    const t = typeof val;
    if (val === null) return "null";
    if (t === "undefined") return "undefined";
    if (t === "string") return JSON.stringify(val);
    if (t === "number" || t === "boolean" || t === "bigint") return String(val);
    if (t === "symbol") return val.toString();
    if (t === "function") return `[Function ${val.name || "anonymous"}]`;

    const tag = typeOf(val);
    if (tag === "Date") return `Date(${isNaN(val) ? "Invalid" : val.toISOString()})`;
    if (tag === "RegExp") return val.toString();
    if (tag === "Error") return `${val.name}: ${val.message}\n${val.stack || ""}`;
    if (tag === "ArrayBuffer") return `ArrayBuffer(${val.byteLength})`;
    if (/Array$/.test(tag)) return `${tag}(${val.length}) ${depth>2 ? "[…]" : "[" + val.slice(0,50).map(v => formatValue(v, depth+1, seen)).join(", ") + (val.length>50?", …":"") + "]"}`;
    if (tag === "Map") {
      if (seen.has(val)) return "[Circular Map]";
      seen.add(val);
      if (depth > 2) return "Map(…)";
      let i = 0;
      const parts = [];
      for (const [k, v] of val) {
        parts.push(`${formatValue(k, depth+1, seen)} => ${formatValue(v, depth+1, seen)}`);
        if (++i > 50) { parts.push("…"); break; }
      }
      return `Map(${val.size}) { ${parts.join(", ")} }`;
    }
    if (tag === "Set") {
      if (seen.has(val)) return "[Circular Set]";
      seen.add(val);
      if (depth > 2) return "Set(…)";
      let i = 0;
      const parts = [];
      for (const v of val) {
        parts.push(formatValue(v, depth+1, seen));
        if (++i > 50) { parts.push("…"); break; }
      }
      return `Set(${val.size}) { ${parts.join(", ")} }`;
    }
    if (tag === "Promise") return "[Promise]";
    if (tag === "DataView") return `DataView(${val.byteLength})`;
    if (tag.endsWith("Array")) return `${tag}(${val.length})`;

    // generic object
    if (t === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      if (depth > 2) return "{…}";
      const keys = Object.keys(val);
      const parts = keys.slice(0, 50).map(k => `${JSON.stringify(k)}: ${formatValue(val[k], depth+1, seen)}`);
      if (keys.length > 50) parts.push("…");
      return `{ ${parts.join(", ")} }`;
    }
    try {
      return String(val);
    } catch {
      return "[Unserializable]";
    }
  }

  function formatArgs(args) {
    try {
      return args.map(a => formatValue(a)).join(" ");
    } catch (e) {
      return "[format error] " + (e && e.message ? e.message : String(e));
    }
  }

  function send(type, payload) {
    postMessage(Object.assign({ type }, payload));
  }

  // Patch console.*
  const methods = ["log", "info", "warn", "error", "debug"];
  const original = {};
  methods.forEach((m) => (original[m] = console[m]));
  console.log = (...args) => send("console", { method: "log", formatted: formatArgs(args), ts: ts() });
  console.info = (...args) => send("console", { method: "info", formatted: formatArgs(args), ts: ts() });
  console.warn = (...args) => send("console", { method: "warn", formatted: formatArgs(args), ts: ts() });
  console.error = (...args) => send("console", { method: "error", formatted: formatArgs(args), ts: ts() });
  console.debug = (...args) => send("console", { method: "debug", formatted: formatArgs(args), ts: ts() });

  console.table = (data, columns) => {
    // Normalize to array of objects
    let rows = [];
    if (Array.isArray(data)) {
      rows = data;
    } else if (data && typeof data === "object") {
      rows = Object.entries(data).map(([k, v]) => ({ "(index)": k, ...v }));
    } else {
      rows = [{ value: data }];
    }

    const headers = columns && Array.isArray(columns) && columns.length
      ? columns
      : Array.from(rows.reduce((set, row) => {
          Object.keys(row || {}).forEach(k => set.add(k));
          return set;
        }, new Set()));

    const tableRows = rows.map(row => headers.map(h => formatValue(row && row[h])));
    send("table", { headers, rows: tableRows, ts: ts() });
  };

  self.onunhandledrejection = (e) => {
    send("error", { formatted: `Unhandled Rejection: ${formatValue(e.reason)}`, ts: ts() });
  };
  self.onerror = (msg, src, lineno, colno, err) => {
    send("error", { formatted: `${msg} @ ${src}:${lineno}:${colno}\n${err && err.stack ? err.stack : ""}`, ts: ts() });
  };

  // .load implementation (classic scripts via importScripts, or map bare names to jsDelivr UMD)
  function resolveSpec(spec) {
    const s = String(spec).trim();
    if (/^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) return s;
    // bare name -> jsDelivr heuristic
    // Examples: "lodash" -> lodash@latest/lodash.min.js
    //           "dayjs" -> dayjs@latest/dayjs.min.js
    const name = s;
    const map = {
      lodash: "lodash@latest/lodash.min.js",
      dayjs: "dayjs@latest/dayjs.min.js",
      rxjs: "rxjs@7/dist/bundles/rxjs.umd.min.js",
      ramda: "ramda@latest/dist/ramda.min.js",
      underscore: "underscore@latest/underscore-min.js",
      "decimal.js": "decimal.js@latest/decimal.min.js",
      "papaparse": "papaparse@latest/papaparse.min.js"
    };
    const path = map[name] || `${name}@latest`;
    return `https://cdn.jsdelivr.net/npm/${path}`;
  }

  async function evalCode(id, code) {
    try {
      // Allow both expression and block with top-level await
      // Strategy: try to eval as expression first; if ReferenceError/SyntaxError, wrap in async IIFE.
      let result;
      try {
        // eslint-disable-next-line no-eval
        result = await eval(code);
      } catch (e) {
        // Try async block execution
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const runner = new AsyncFunction(`"use strict";\n${code}`);
        result = await runner();
      }
      send("result", { id, formatted: formatValue(result), ts: ts() });
    } catch (err) {
      send("error", { id, formatted: formatValue(err), ts: ts() });
    }
  }

  self.onmessage = async (ev) => {
    const data = ev.data || {};
    if (data.type === "eval") {
      await evalCode(data.id, String(data.code || ""));
    } else if (data.type === "load") {
      const spec = String(data.spec || "");
      try {
        const url = resolveSpec(spec);
        importScripts(url);
        send("console", { method: "info", formatted: `loaded: ${url}`, ts: ts() });
      } catch (e) {
        send("error", { formatted: `load failed: ${formatValue(e)}`, ts: ts() });
      }
    }
  };

  send("ready", {});
})();