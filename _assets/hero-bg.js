/*
 * Self-hosted hero background: drifting four-colour gradient rendered as a
 * grid of ASCII-style glyphs, with a fading mouse trail and soft glow.
 *
 * Exposes window.UnicornStudio with the small surface Framer's Unicorn Studio
 * component calls (init / destroy / scenes), so the component works unchanged
 * but nothing is loaded from a third-party host.
 */
(function () {
  "use strict";

  var PALETTE = [
    [0x83, 0x3a, 0xb4], // purple
    [0xd1, 0x00, 0x29], // crimson
    [0xce, 0x88, 0x00], // amber
    [0x42, 0x29, 0xea], // indigo
  ].map(function (c) { return c.map(function (v) { return v / 255; }); });
  var TRAIL = [0.0, 0.51, 0.97];
  var CELL_CSS_PX = 8;      // glyph cell size in CSS pixels
  var DRIFT_SPEED = 0.17;   // matches the original gradient speed
  var FADE_MS = 1000;

  var VERT = "#version 300 es\n" +
    "in vec2 aPos; out vec2 vUv;\n" +
    "void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }";

  // Mouse trail: decays each frame, splats a soft disc along the cursor path.
  var TRAIL_FRAG = "#version 300 es\nprecision highp float;\n" +
    "in vec2 vUv; out vec4 o;\n" +
    "uniform sampler2D uPrev; uniform vec2 uA; uniform vec2 uB; uniform float uAspect; uniform float uOn;\n" +
    "float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.,1.); return length(pa-ba*h); }\n" +
    "void main(){\n" +
    "  float prev = texture(uPrev, vUv).r * 0.955;\n" +
    "  vec2 s = vec2(uAspect, 1.);\n" +
    "  float d = seg(vUv*s, uA*s, uB*s);\n" +
    "  float add = uOn * smoothstep(0.09, 0.0, d) * 0.55;\n" +
    "  o = vec4(clamp(prev + add, 0., 1.), 0., 0., 1.);\n" +
    "}";

  var MAIN_FRAG = "#version 300 es\nprecision highp float;\n" +
    "in vec2 vUv; out vec4 o;\n" +
    "uniform vec2 uRes; uniform float uTime; uniform float uCell; uniform float uFade;\n" +
    "uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uTrailCol;\n" +
    "uniform sampler2D uTrail;\n" +
    "vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }\n" +
    "vec3 field(vec2 uv){\n" +
    "  float a = uRes.x/uRes.y; vec2 p = vec2(uv.x*a, uv.y); float t = uTime;\n" +
    "  vec2 q0 = vec2(a*(0.80+0.18*sin(t*0.71)), 0.80+0.15*cos(t*0.53));\n" +
    "  vec2 q1 = vec2(a*(0.45+0.25*sin(t*0.37+1.7)), 0.98+0.10*sin(t*0.61));\n" +
    "  vec2 q2 = vec2(a*(0.22+0.20*cos(t*0.43+0.4)), 0.35+0.22*sin(t*0.47+2.1));\n" +
    "  vec2 q3 = vec2(a*(0.95+0.12*cos(t*0.59+0.9)), 0.25+0.20*cos(t*0.41+1.2));\n" +
    "  float w0 = exp(-dot(p-q0,p-q0)*5.5), w1 = exp(-dot(p-q1,p-q1)*7.0);\n" +
    "  float w2 = exp(-dot(p-q2,p-q2)*4.0), w3 = exp(-dot(p-q3,p-q3)*5.0);\n" +
    "  vec3 c = lin(uC0)*w0 + lin(uC1)*w1 + lin(uC2)*w2 + lin(uC3)*w3;\n" +
    "  return c * 0.85;\n" +
    "}\n" +
    "float box(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.)) + min(max(d.x,d.y),0.); }\n" +
    "float glyph(vec2 p, float lvl, float aa){\n" +
    "  float t = 0.075;\n" +
    "  float dDot = length(p) - 0.11;\n" +
    "  float dDash = box(p, vec2(0.28, t));\n" +
    "  float dPlus = min(box(p, vec2(0.30, t)), box(p, vec2(t, 0.30)));\n" +
    "  vec2 r = mat2(0.7071,-0.7071,0.7071,0.7071)*p;\n" +
    "  float dX = min(box(r, vec2(0.30, t)), box(r, vec2(t, 0.30)));\n" +
    "  float dStar = min(dPlus, min(box(r, vec2(0.36, t)), box(r, vec2(t, 0.36))));\n" +
    "  float d = lvl < 1. ? 1. : lvl < 2. ? dDot : lvl < 3. ? dDash : lvl < 4. ? dPlus : lvl < 5. ? dX : dStar;\n" +
    "  return smoothstep(aa, -aa, d);\n" +
    "}\n" +
    "void main(){\n" +
    "  vec2 frag = vUv*uRes;\n" +
    "  vec2 cell = floor(frag/uCell); vec2 center = (cell+0.5)*uCell/uRes;\n" +
    "  float trail = texture(uTrail, center).r;\n" +
    "  vec3 col = field(center + vec2(0.02, -0.03)*trail);\n" +
    "  col += lin(uTrailCol) * trail * 0.9;\n" +
    "  float lum = dot(col, vec3(0.2126,0.7152,0.0722));\n" +
    "  float lvl = floor(clamp(pow(lum, 0.6)*1.6, 0., 0.999) * 6.0);\n" +
    "  vec2 local = fract(frag/uCell) - 0.5;\n" +
    "  float m = glyph(local, lvl, 0.6/uCell);\n" +
    "  vec3 smooth_ = field(vUv) + lin(uTrailCol)*texture(uTrail, vUv).r*0.9;\n" +
    "  vec3 outc = col * m * 1.7 + smooth_ * 0.035;\n" +
    "  outc = outc / (1.0 + outc*0.35);\n" +
    "  o = vec4(pow(outc, vec3(1.0/2.2)) * uFade, 1.0);\n" +
    "}";

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, frag) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p: p, u: u };
  }
  function target(gl, w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex: tex, fb: fb, w: w, h: h };
  }

  function cssFallback(el) {
    el.style.background =
      "radial-gradient(60% 60% at 85% 20%, rgba(66,41,234,.55), transparent 70%)," +
      "radial-gradient(50% 50% at 20% 65%, rgba(206,136,0,.55), transparent 70%)," +
      "radial-gradient(45% 40% at 50% 0%, rgba(209,0,41,.45), transparent 70%)," +
      "radial-gradient(50% 50% at 80% 80%, rgba(131,58,180,.5), transparent 70%), #050308";
  }

  function createScene(el) {
    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;";
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.appendChild(canvas);

    var gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) { canvas.remove(); cssFallback(el); return { element: el, destroy: function () { el.style.background = ""; } }; }

    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var main = program(gl, MAIN_FRAG), trailP = program(gl, TRAIL_FRAG);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var dpr = 1, trails = null, ping = 0;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h && trails) return;
      canvas.width = w; canvas.height = h;
      var tw = Math.max(1, w >> 2), th = Math.max(1, h >> 2);
      trails = [target(gl, tw, th), target(gl, tw, th)];
      trails.forEach(function (t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); });
    }
    var ro = new ResizeObserver(resize); ro.observe(el); resize();

    // Mouse in element UV space (origin bottom-left). Smoothed for momentum.
    var mouse = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, tx: 0.5, ty: 0.5, on: 0 };
    function onMove(e) {
      var r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { mouse.on = 0; return; }
      mouse.tx = (e.clientX - r.left) / r.width; mouse.ty = 1 - (e.clientY - r.top) / r.height;
      if (!mouse.on) { mouse.x = mouse.px = mouse.tx; mouse.y = mouse.py = mouse.ty; }
      mouse.on = 1;
    }
    window.addEventListener("pointermove", onMove, { passive: true });

    var start = performance.now(), raf = 0, visible = true, alive = true;
    var io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible && !raf && alive) raf = requestAnimationFrame(frame); });
    io.observe(el);

    function frame(now) {
      raf = 0;
      if (!alive) return;
      var t = (now - start) / 1000;
      mouse.px = mouse.x; mouse.py = mouse.y;
      mouse.x += (mouse.tx - mouse.x) * 0.24; mouse.y += (mouse.ty - mouse.y) * 0.24;

      // Trail pass (ping-pong).
      var src = trails[ping], dst = trails[1 - ping];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.useProgram(trailP.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(trailP.u.uPrev, 0);
      gl.uniform2f(trailP.u.uA, mouse.px, mouse.py);
      gl.uniform2f(trailP.u.uB, mouse.x, mouse.y);
      gl.uniform1f(trailP.u.uAspect, canvas.width / canvas.height);
      var moved = Math.hypot(mouse.x - mouse.px, mouse.y - mouse.py);
      gl.uniform1f(trailP.u.uOn, mouse.on * Math.min(1, moved * 60));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ping = 1 - ping;

      // Main pass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(main.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.uniform1i(main.u.uTrail, 0);
      gl.uniform2f(main.u.uRes, canvas.width, canvas.height);
      gl.uniform1f(main.u.uTime, reduce ? 4.0 : t * DRIFT_SPEED * 6.0);
      gl.uniform1f(main.u.uCell, CELL_CSS_PX * dpr);
      gl.uniform1f(main.u.uFade, reduce ? 1 : Math.min(1, Math.sin(Math.min(1, (now - start) / FADE_MS) * Math.PI / 2)));
      gl.uniform3fv(main.u.uC0, PALETTE[0]); gl.uniform3fv(main.u.uC1, PALETTE[1]);
      gl.uniform3fv(main.u.uC2, PALETTE[2]); gl.uniform3fv(main.u.uC3, PALETTE[3]);
      gl.uniform3fv(main.u.uTrailCol, TRAIL);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function onVis() { if (!document.hidden && visible && !raf && alive) raf = requestAnimationFrame(frame); }
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);

    var scene = {
      element: el,
      destroy: function () {
        alive = false; cancelAnimationFrame(raf);
        ro.disconnect(); io.disconnect();
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("visibilitychange", onVis);
        var lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
        canvas.remove();
        var i = api.scenes.indexOf(scene); if (i >= 0) api.scenes.splice(i, 1);
      },
    };
    return scene;
  }

  var api = {
    scenes: [],
    init: function () {
      var els = document.querySelectorAll("[data-us-project],[data-us-project-src]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (api.scenes.some(function (s) { return s.element === el; })) continue;
        try { api.scenes.push(createScene(el)); } catch (e) { console.error("hero-bg:", e); cssFallback(el); }
      }
      return Promise.resolve(api.scenes);
    },
    destroy: function () { api.scenes.slice().forEach(function (s) { s.destroy(); }); },
  };
  window.UnicornStudio = api;
})();
