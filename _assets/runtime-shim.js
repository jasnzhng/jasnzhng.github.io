/*
 * Runtime fixes for the static mirror. Loaded as a classic <script> at the top
 * of <head>, so it runs before any of Framer's module scripts.
 *
 * 1. CMS range requests. Framer's CMS client fetches
 *    `<file>.framercms?range=a-b,c-d` and expects the server to return exactly
 *    those byte ranges, concatenated. Static hosts ignore the query and send
 *    the whole file, so we fetch each file once and slice it here.
 *
 * 2. CMS image URLs. Image URLs stored inside the binary CMS files still point
 *    at framerusercontent.com. We rewrite them to the local mirror at the
 *    moment they are assigned to an <img>/<source>, before any request is made.
 */
(function () {
  "use strict";

  // Folder the mirror is served from ("" for a root site, "/repo" for a project site).
  var BASE = (document.currentScript && document.currentScript.getAttribute("data-base")) || "";
  var REMOTE = /https:\/\/framerusercontent\.com\//g;
  var LOCAL = location.origin + BASE + "/_assets/framerusercontent.com/";

  // Note: LOCAL itself contains "framerusercontent.com", so always test for the
  // full remote prefix, never the bare hostname.
  function isRemote(v) {
    return typeof v === "string" && v.indexOf("https://framerusercontent.com/") !== -1;
  }
  function localize(v) {
    return isRemote(v) ? v.replace(REMOTE, LOCAL) : v;
  }

  // --- 1. CMS range requests -------------------------------------------------
  var realFetch = window.fetch.bind(window);
  var cache = new Map();

  function whole(path) {
    if (!cache.has(path)) {
      cache.set(path, realFetch(path).then(function (r) {
        if (!r.ok) throw new Error("runtime-shim: " + r.status + " for " + path);
        return r.arrayBuffer();
      }).then(function (b) { return new Uint8Array(b); }));
    }
    return cache.get(path);
  }

  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href); }
    catch (e) { return realFetch(input, init); }
    if (url.hostname === "framerusercontent.com") return realFetch(localize(url.href), init);
    var range = url.searchParams.get("range");
    if (url.origin !== location.origin || !url.pathname.endsWith(".framercms") || !range) {
      return realFetch(input, init);
    }
    return whole(url.pathname).then(function (bytes) {
      var parts = range.split(",").map(function (s) {
        var ab = s.split("-").map(Number);
        return bytes.subarray(ab[0], ab[1] + 1); // ranges are inclusive
      });
      var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
      var out = new Uint8Array(total), off = 0;
      parts.forEach(function (p) { out.set(p, off); off += p.length; });
      return new Response(out, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    });
  };

  // --- 2. CMS image URLs -----------------------------------------------------
  var ATTRS = { src: 1, srcset: 1, poster: 1 };
  var realSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (ATTRS[String(name).toLowerCase()]) value = localize(value);
    return realSetAttribute.call(this, name, value);
  };

  function wrapProp(proto, prop) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, localize(v)); },
    });
  }
  [window.HTMLImageElement, window.HTMLSourceElement, window.HTMLVideoElement, window.HTMLMediaElement]
    .forEach(function (C) {
      if (!C) return;
      ["src", "srcset", "poster"].forEach(function (p) { wrapProp(C.prototype, p); });
    });

  // Background images set through inline styles.
  var styleProto = window.CSSStyleDeclaration && CSSStyleDeclaration.prototype;
  if (styleProto) {
    var realSetProperty = styleProto.setProperty;
    styleProto.setProperty = function (n, v, p) { return realSetProperty.call(this, n, localize(v), p); };
    wrapProp(styleProto, "backgroundImage");
    wrapProp(styleProto, "background");
    wrapProp(styleProto, "cssText");
  }

  // Safety net for anything set by other means (e.g. parsed innerHTML).
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      var nodes = r.type === "attributes" ? [r.target] : Array.prototype.slice.call(r.addedNodes);
      nodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        var els = [n].concat(Array.prototype.slice.call(n.querySelectorAll ? n.querySelectorAll("img,source,video") : []));
        els.forEach(function (el) {
          ["src", "srcset", "poster"].forEach(function (a) {
            var v = el.getAttribute(a);
            if (isRemote(v)) realSetAttribute.call(el, a, localize(v)); // only when it changes, or this re-triggers forever
          });
        });
      });
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "srcset", "poster"] });
})();
