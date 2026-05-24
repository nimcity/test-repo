/**
 * renderer-core.js — WebGL2 rendering layer for Puzzle Fighter
 *
 * Provides a GPU-accelerated canvas layered BEHIND the game's Canvas 2D.
 * Renders: background planes, board floors, gems (instanced), particles,
 * dynamic lighting, and a custom bloom post-processing chain.
 *
 * Requires window.THREE (three.min.js loaded first).
 * Exposes: window.pfGL  { init, resize, render, emitBreak, setPostFX }
 */

(function () {
  'use strict';

  // ─── Guard: THREE must be present ───────────────────────────────────────────
  if (!window.THREE) {
    console.warn('renderer-core.js: window.THREE not found — GL layer disabled');
    window.pfGL = {
      init() {}, resize() {}, render() {}, emitBreak() {}, setPostFX() {}
    };
    return;
  }

  const THREE = window.THREE;

  // ─── Module-level state ─────────────────────────────────────────────────────
  let glCanvas, renderer, scene, camera;
  let W = 1, H = 1;
  let initialized = false;
  let totalTime = 0;
  let bloomStrength = 0.45;

  // Post-processing
  let rtMain, rtBright, rtBlurH, rtBlurV;
  let fsScene, fsCam;
  let quadBright, quadBlurH, quadBlurV, quadComposite;

  // Background
  let bgPlaneL, bgPlaneR;

  // Board floor meshes
  let floorL, floorR;

  // Instanced gem meshes: key = 'colorName_type' (TN=0, TC=1)
  const MAX_INSTANCES = 144;
  const gemMeshes = {};   // colorName_type → InstancedMesh
  const gemMats  = {};    // colorName_type → ShaderMaterial

  // Dynamic lights that follow active pieces
  let pointLightL, pointLightR;
  let ambientLight, dirLight;

  // Active particle systems
  const particleSystems = [];

  // Dummy objects for matrix math
  const _obj = new THREE.Object3D();
  const _col  = new THREE.Color();

  // Gem type constants (mirrors game)
  const TN = 0, TC = 1, TK = 2, TP = 3;

  // Color palette mirrors PAL in game (hi, main, shadow, accent)
  const PAL_GL = {
    red:    { hi:[1.0, 0.44, 0.44], main:[0.80, 0.00, 0.00], shad:[0.42, 0.00, 0.00], accent:[1.0, 0.13, 0.27] },
    blue:   { hi:[0.60, 0.80, 1.00], main:[0.07, 0.27, 0.80], shad:[0.00, 0.08, 0.40], accent:[0.20, 0.60, 1.00] },
    yellow: { hi:[1.00, 0.88, 0.40], main:[0.80, 0.53, 0.00], shad:[0.35, 0.23, 0.00], accent:[1.00, 0.80, 0.00] },
    green:  { hi:[0.40, 0.93, 0.53], main:[0.07, 0.53, 0.20], shad:[0.00, 0.20, 0.09], accent:[0.13, 0.87, 0.33] },
    gray:   { hi:[0.88, 0.88, 0.88], main:[0.54, 0.54, 0.54], shad:[0.23, 0.23, 0.23], accent:[0.73, 0.73, 0.73] },
  };

  const COLOR_NAMES = ['red', 'blue', 'yellow', 'green', 'gray'];

  // Character background colors (mirrors getCharBg in game)
  const CHAR_BG = ['#330000', '#000033', '#332200', '#001a00'];

  // ─── GLSL Shaders ───────────────────────────────────────────────────────────

  // ── Normal gem (TN) ──
  const gemVS = /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      vViewPos = -mvPos.xyz;
      gl_Position = projectionMatrix * mvPos;
    }
  `;

  const gemFS = /* glsl */`
    uniform vec3 gemColor;
    uniform vec3 gemHiColor;
    uniform vec3 gemShadColor;
    uniform float time;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPos;

    void main() {
      vec2 q = step(vec2(0.5), vUv);

      float tl = (1.0 - q.x) * (1.0 - q.y);
      float tr = q.x         * (1.0 - q.y);
      float bl = (1.0 - q.x) * q.y;
      float br = q.x         * q.y;

      // 4-quadrant faceted shading — TL bright, TR medium, BL medium-dark, BR darkest
      vec3 baseColor = gemColor;
      baseColor = mix(baseColor, gemHiColor,  tl * 0.72);
      baseColor = mix(baseColor, gemColor,    tr * 0.80);
      baseColor = mix(baseColor, mix(gemColor, gemShadColor, 0.5), bl * 0.60);
      baseColor = mix(baseColor, gemShadColor, br * 0.55);

      // Specular highlight (top-left quadrant) — Phong-like
      vec2 specCenter = vec2(0.28, 0.26);
      float specDist = length(vUv - specCenter);
      float spec = smoothstep(0.22, 0.0, specDist);
      baseColor += vec3(spec * 0.90);

      // Tiny secondary sparkle (upper-right)
      float spec2 = smoothstep(0.08, 0.0, length(vUv - vec2(0.68, 0.20)));
      baseColor += vec3(spec2 * 0.60);

      // Facet edge lines — bright edge bevel
      vec2 facetUV = abs(vUv - 0.5) * 2.0;
      float facetV = smoothstep(0.90, 1.0, max(facetUV.x, facetUV.y));
      baseColor = mix(baseColor, gemHiColor * 1.2, facetV * 0.35);

      // Cross facet lines through center
      float cx = smoothstep(0.03, 0.0, abs(vUv.x - 0.5));
      float cy = smoothstep(0.03, 0.0, abs(vUv.y - 0.5));
      baseColor += (cx + cy) * gemHiColor * 0.18;

      // Pulsing emissive glow
      float pulse = 0.10 + 0.04 * sin(time * 2.8);
      baseColor += gemColor * pulse;

      gl_FragColor = vec4(baseColor, 1.0);
    }
  `;

  // ── Crash gem (TC) ──
  const crashGemVS = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const crashGemFS = /* glsl */`
    uniform vec3 gemColor;
    uniform vec3 gemHiColor;
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Diamond mask — discard outside the diamond shape
      vec2 c = vUv - 0.5;
      float diamond = abs(c.x) + abs(c.y);
      if (diamond > 0.48) discard;

      float r = diamond / 0.48;

      // Radial gradient: white center → gem color → deep shadow
      vec3 col = mix(vec3(1.0), gemHiColor, smoothstep(0.0, 0.3, r));
      col = mix(col, gemColor,  smoothstep(0.3, 0.7, r));
      col = mix(col, gemColor * 0.4, smoothstep(0.7, 1.0, r));

      // Internal facet lines
      vec2 uv2 = vUv;
      float top    = smoothstep(0.02, 0.0, abs(uv2.x - 0.5) + abs(uv2.y - 1.0) - 0.5);
      float right  = smoothstep(0.02, 0.0, abs(uv2.x - 1.0) + abs(uv2.y - 0.5) - 0.5);
      float bottom = smoothstep(0.02, 0.0, abs(uv2.x - 0.5) + abs(uv2.y + 0.0) - 0.5);
      float left   = smoothstep(0.02, 0.0, abs(uv2.x + 0.0) + abs(uv2.y - 0.5) - 0.5);
      float facet  = max(max(top, right), max(bottom, left));
      col = mix(col, vec3(1.0), facet * 0.5);

      // Center divider lines from centroid
      float hLine = smoothstep(0.015, 0.0, abs(uv2.y - 0.5)) * step(abs(uv2.x - 0.5), 0.45);
      float vLine = smoothstep(0.015, 0.0, abs(uv2.x - 0.5)) * step(abs(uv2.y - 0.5), 0.45);
      col = mix(col, vec3(1.0), (hLine + vLine) * 0.25);

      // Pulsing glow halo near edges
      float glowPulse = 0.12 + 0.10 * sin(time * 3.5);
      col += gemColor * (1.0 - r) * glowPulse;

      // Specular highlight top-left
      float spec = smoothstep(0.18, 0.0, length(vUv - vec2(0.30, 0.28)));
      col += vec3(spec * 1.0);

      // Fade alpha near diamond edge for soft silhouette
      float alpha = smoothstep(0.48, 0.42, diamond);

      gl_FragColor = vec4(col, alpha);
    }
  `;

  // ── Counter gem (TK) ──
  const counterGemFS = /* glsl */`
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Diagonal stone gradient
      float d = (vUv.x + (1.0 - vUv.y)) * 0.5;
      vec3 light = vec3(0.88, 0.88, 0.88);
      vec3 mid   = vec3(0.54, 0.54, 0.54);
      vec3 dark  = vec3(0.23, 0.23, 0.23);
      vec3 col   = mix(light, mid, smoothstep(0.0, 0.5, d));
      col        = mix(col, dark, smoothstep(0.5, 1.0, d));

      // Top highlight bevel
      float topBevel = smoothstep(0.20, 0.0, vUv.y);
      col = mix(col, vec3(1.0), topBevel * 0.30);
      // Bottom shadow bevel
      float botBevel = smoothstep(0.80, 1.0, vUv.y);
      col = mix(col, dark, botBevel * 0.45);

      // Horizontal seam line in middle
      float seam = smoothstep(0.025, 0.0, abs(vUv.y - 0.50));
      col = mix(col, dark, seam * 0.55);
      col = mix(col, vec3(0.9), seam * 0.18 * step(vUv.y, 0.50));

      // Edge border
      vec2 border = step(vec2(0.06), vUv) * step(vUv, vec2(0.94));
      float inside = border.x * border.y;
      col = mix(vec3(0.73, 0.73, 0.73), col, inside);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ── Background shader — gradient per half ──
  const bgVS = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;
  const bgFS = /* glsl */`
    uniform vec3 colorTop;
    uniform vec3 colorBot;
    varying vec2 vUv;
    void main() {
      vec3 c = mix(colorBot, colorTop, vUv.y);
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  // ── Board floor shader ──
  const floorFS = /* glsl */`
    uniform vec3 accentColor;
    varying vec2 vUv;
    void main() {
      vec3 base = vec3(0.05, 0.05, 0.08);
      // Subtle grid
      vec2 grid = fract(vUv * vec2(6.0, 12.0));
      float line = step(0.96, max(grid.x, grid.y));
      vec3 col = mix(base, accentColor * 0.25 + base, line);
      // Edge vignette
      vec2 ev = abs(vUv - 0.5) * 2.0;
      float vignette = 1.0 - smoothstep(0.7, 1.0, max(ev.x, ev.y)) * 0.6;
      gl_FragColor = vec4(col * vignette, 0.85);
    }
  `;

  // ── Fullscreen quad shaders ──
  const fsVS = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  // Bright-extract pass (luminance threshold)
  const brightFS = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float threshold;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float brightness = smoothstep(threshold - 0.05, threshold + 0.05, lum);
      gl_FragColor = vec4(c.rgb * brightness, 1.0);
    }
  `;

  // Gaussian blur — horizontal
  const blurHFS = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 texelSize;
    varying vec2 vUv;
    void main() {
      float weights[7];
      weights[0] = 0.0625; weights[1] = 0.09375; weights[2] = 0.125;
      weights[3] = 0.15625;
      weights[4] = 0.125; weights[5] = 0.09375; weights[6] = 0.0625;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 7; i++) {
        float off = float(i - 3);
        col += texture2D(tDiffuse, vUv + vec2(off * texelSize.x * 2.0, 0.0)).rgb * weights[i];
      }
      gl_FragColor = vec4(col * 1.2, 1.0);
    }
  `;

  // Gaussian blur — vertical
  const blurVFS = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 texelSize;
    varying vec2 vUv;
    void main() {
      float weights[7];
      weights[0] = 0.0625; weights[1] = 0.09375; weights[2] = 0.125;
      weights[3] = 0.15625;
      weights[4] = 0.125; weights[5] = 0.09375; weights[6] = 0.0625;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 7; i++) {
        float off = float(i - 3);
        col += texture2D(tDiffuse, vUv + vec2(0.0, off * texelSize.y * 2.0)).rgb * weights[i];
      }
      gl_FragColor = vec4(col * 1.2, 1.0);
    }
  `;

  // Composite pass — main + bloom, with chromatic aberration
  const compositeFS = /* glsl */`
    uniform sampler2D tMain;
    uniform sampler2D tBloom;
    uniform float bloomStrength;
    uniform vec2 texelSize;
    varying vec2 vUv;
    void main() {
      // Chromatic aberration: R shifted +1px, B shifted -1px
      float rr = texture2D(tMain, vUv + vec2( texelSize.x, 0.0)).r;
      float gg = texture2D(tMain, vUv).g;
      float bb = texture2D(tMain, vUv - vec2( texelSize.x, 0.0)).b;
      vec3 scene = vec3(rr, gg, bb);

      vec3 bloom = texture2D(tBloom, vUv).rgb;
      vec3 combined = scene + bloom * bloomStrength;

      // ACES-like tone mapping (approximation)
      combined = combined * (2.51 * combined + 0.03) / (combined * (2.43 * combined + 0.59) + 0.14);
      combined = clamp(combined, 0.0, 1.0);

      // Subtle vignette
      vec2 uvc = vUv - 0.5;
      float vignette = 1.0 - dot(uvc, uvc) * 0.5;
      combined *= vignette;

      gl_FragColor = vec4(combined, 1.0);
    }
  `;

  // ── Particle shaders ──
  const particleVS = /* glsl */`
    attribute vec3 velocity;
    attribute float startTime;
    attribute vec3 aColor;
    uniform float currentTime;
    uniform float size;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float t = currentTime - startTime;
      // gravity points downward in canvas coords (positive Y is down)
      vec3 pos = position + velocity * t + vec3(0.0, 180.0 * t * t, 0.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      float life = clamp(1.0 - t * 2.0, 0.0, 1.0);
      gl_PointSize = max(1.0, size * life);
      vColor = aColor;
      vAlpha = life * life;
    }
  `;

  const particleFS = /* glsl */`
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) discard;
      float alpha = (0.5 - d) * 2.0 * vAlpha;
      gl_FragColor = vec4(vColor + 0.4, alpha);
    }
  `;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function hexToVec3(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return new THREE.Vector3(r, g, b);
  }

  function makeRenderTarget(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
  }

  function createGemMaterial(colorName, type) {
    const pal = PAL_GL[colorName] || PAL_GL.gray;
    if (type === TC) {
      return new THREE.ShaderMaterial({
        uniforms: {
          gemColor:   { value: new THREE.Vector3(...pal.main) },
          gemHiColor: { value: new THREE.Vector3(...pal.hi)   },
          time:       { value: 0 },
        },
        vertexShader:   crashGemVS,
        fragmentShader: crashGemFS,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
    }
    if (type === TK) {
      return new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader:   gemVS,
        fragmentShader: counterGemFS,
        side: THREE.FrontSide,
      });
    }
    // TN — normal gem
    return new THREE.ShaderMaterial({
      uniforms: {
        gemColor:    { value: new THREE.Vector3(...pal.main) },
        gemHiColor:  { value: new THREE.Vector3(...pal.hi)   },
        gemShadColor:{ value: new THREE.Vector3(...pal.shad) },
        time:        { value: 0 },
      },
      vertexShader:   gemVS,
      fragmentShader: gemFS,
      side: THREE.FrontSide,
    });
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  function init(gameCanvas) {
    if (initialized) return;
    initialized = true;

    // Create & insert the WebGL canvas BEHIND the game canvas
    glCanvas = document.createElement('canvas');
    glCanvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    document.body.insertBefore(glCanvas, document.body.firstChild);

    W = window.innerWidth;
    H = window.innerHeight;
    glCanvas.width  = W;
    glCanvas.height = H;

    // ── Three.js renderer ──
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NoToneMapping; // tone-mapping done in composite shader
    renderer.toneMappingExposure = 1.0;
    renderer.setSize(W, H, false);

    // ── Scene & camera ──
    scene = new THREE.Scene();

    // Orthographic camera matching pixel coords: origin top-left, Y downward
    camera = new THREE.OrthographicCamera(0, W, 0, H, -500, 500);
    camera.position.z = 100;

    // Expose scene and renderer for renderer-stages.js and renderer-fx.js
    window.pfGL.scene    = scene;
    window.pfGL.renderer = renderer;

    // ── Lighting ──
    ambientLight = new THREE.AmbientLight(0x112233, 0.5);
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(-1, -1, 1).normalize();
    scene.add(dirLight);

    pointLightL = new THREE.PointLight(0xff4444, 0, 200);
    pointLightR = new THREE.PointLight(0x4488ff, 0, 200);
    scene.add(pointLightL);
    scene.add(pointLightR);

    // ── Background planes ──
    const bgGeo = new THREE.PlaneGeometry(1, 1);

    bgPlaneL = new THREE.Mesh(bgGeo, new THREE.ShaderMaterial({
      uniforms: { colorTop: { value: new THREE.Vector3(0.05, 0, 0) }, colorBot: { value: new THREE.Vector3(0, 0, 0) } },
      vertexShader: bgVS, fragmentShader: bgFS, depthWrite: false,
    }));
    bgPlaneL.position.z = -100;
    bgPlaneL.renderOrder = -10;
    scene.add(bgPlaneL);

    bgPlaneR = new THREE.Mesh(bgGeo.clone(), new THREE.ShaderMaterial({
      uniforms: { colorTop: { value: new THREE.Vector3(0, 0, 0.05) }, colorBot: { value: new THREE.Vector3(0, 0, 0) } },
      vertexShader: bgVS, fragmentShader: bgFS, depthWrite: false,
    }));
    bgPlaneR.position.z = -100;
    bgPlaneR.renderOrder = -10;
    scene.add(bgPlaneR);

    // ── Board floors ──
    const floorGeo = new THREE.PlaneGeometry(1, 1);

    floorL = new THREE.Mesh(floorGeo, new THREE.ShaderMaterial({
      uniforms: { accentColor: { value: new THREE.Vector3(0.8, 0, 0) } },
      vertexShader: bgVS, fragmentShader: floorFS,
      transparent: true, depthWrite: false,
    }));
    floorL.renderOrder = -5;
    scene.add(floorL);

    floorR = new THREE.Mesh(floorGeo.clone(), new THREE.ShaderMaterial({
      uniforms: { accentColor: { value: new THREE.Vector3(0, 0.2, 0.8) } },
      vertexShader: bgVS, fragmentShader: floorFS,
      transparent: true, depthWrite: false,
    }));
    floorR.renderOrder = -5;
    scene.add(floorR);

    // ── Instanced gem meshes ──
    const normalGeo  = new THREE.BoxGeometry(0.88, 0.88, 0.5);
    const crashGeo   = new THREE.BoxGeometry(0.88, 0.88, 0.5); // used as proxy; shader draws diamond
    const counterGeo = new THREE.BoxGeometry(0.88, 0.88, 0.3);

    for (const colorName of COLOR_NAMES) {
      // Normal gem
      const keyN  = `${colorName}_${TN}`;
      const matN  = createGemMaterial(colorName, TN);
      gemMats[keyN] = matN;
      const meshN = new THREE.InstancedMesh(normalGeo, matN, MAX_INSTANCES);
      meshN.frustumCulled = false;
      meshN.count = 0;
      gemMeshes[keyN] = meshN;
      scene.add(meshN);

      // Crash gem
      const keyC  = `${colorName}_${TC}`;
      const matC  = createGemMaterial(colorName, TC);
      gemMats[keyC] = matC;
      const meshC = new THREE.InstancedMesh(crashGeo, matC, MAX_INSTANCES);
      meshC.frustumCulled = false;
      meshC.count = 0;
      gemMeshes[keyC] = meshC;
      scene.add(meshC);

      // Counter gem — only gray matters but create for all so board render is uniform
      const keyK  = `${colorName}_${TK}`;
      const matK  = createGemMaterial('gray', TK);
      gemMats[keyK] = matK;
      const meshK = new THREE.InstancedMesh(counterGeo, matK, MAX_INSTANCES);
      meshK.frustumCulled = false;
      meshK.count = 0;
      gemMeshes[keyK] = meshK;
      scene.add(meshK);
    }

    // ── Post-processing render targets & fullscreen quads ──
    _buildPostFX(W, H);

    // Ensure game canvas z-index is above GL canvas
    if (gameCanvas) {
      gameCanvas.style.position = 'relative';
      if (!gameCanvas.style.zIndex) gameCanvas.style.zIndex = '1';
    }
  }

  function _buildPostFX(w, h) {
    if (rtMain)   rtMain.dispose();
    if (rtBright) rtBright.dispose();
    if (rtBlurH)  rtBlurH.dispose();
    if (rtBlurV)  rtBlurV.dispose();

    rtMain   = makeRenderTarget(w, h);
    rtBright = makeRenderTarget(w >> 1, h >> 1);
    rtBlurH  = makeRenderTarget(w >> 1, h >> 1);
    rtBlurV  = makeRenderTarget(w >> 1, h >> 1);

    const ts = new THREE.Vector2(1 / (w >> 1), 1 / (h >> 1));
    const tsMain = new THREE.Vector2(1 / w, 1 / h);

    // Bright-extract quad
    const matBright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rtMain.texture }, threshold: { value: 0.65 } },
      vertexShader: fsVS, fragmentShader: brightFS, depthTest: false, depthWrite: false,
    });
    // BlurH
    const matBlurH = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rtBright.texture }, texelSize: { value: ts } },
      vertexShader: fsVS, fragmentShader: blurHFS, depthTest: false, depthWrite: false,
    });
    // BlurV
    const matBlurV = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rtBlurH.texture }, texelSize: { value: ts } },
      vertexShader: fsVS, fragmentShader: blurVFS, depthTest: false, depthWrite: false,
    });
    // Composite
    const matComp = new THREE.ShaderMaterial({
      uniforms: {
        tMain:        { value: rtMain.texture },
        tBloom:       { value: rtBlurV.texture },
        bloomStrength:{ value: bloomStrength },
        texelSize:    { value: tsMain },
      },
      vertexShader: fsVS, fragmentShader: compositeFS, depthTest: false, depthWrite: false,
    });

    fsScene = fsScene || new THREE.Scene();
    fsCam   = fsCam   || new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const quadGeo = new THREE.PlaneGeometry(2, 2);

    if (quadBright) { quadBright.geometry.dispose(); quadBright.material.dispose(); fsScene.remove(quadBright); }
    if (quadBlurH)  { quadBlurH.geometry.dispose();  quadBlurH.material.dispose();  fsScene.remove(quadBlurH);  }
    if (quadBlurV)  { quadBlurV.geometry.dispose();  quadBlurV.material.dispose();  fsScene.remove(quadBlurV);  }
    if (quadComposite) { quadComposite.geometry.dispose(); quadComposite.material.dispose(); fsScene.remove(quadComposite); }

    quadBright    = new THREE.Mesh(quadGeo,         matBright);
    quadBlurH     = new THREE.Mesh(quadGeo.clone(),  matBlurH);
    quadBlurV     = new THREE.Mesh(quadGeo.clone(),  matBlurV);
    quadComposite = new THREE.Mesh(quadGeo.clone(),  matComp);

    // Only one quad is in fsScene at a time — we swap by adding/removing
  }

  // ─── Resize ─────────────────────────────────────────────────────────────────

  function resize(w, h) {
    if (!initialized) return;
    W = w; H = h;
    glCanvas.width  = W;
    glCanvas.height = H;
    renderer.setSize(W, H, false);

    // Update orthographic camera
    camera.left   = 0;
    camera.right  = W;
    camera.top    = 0;
    camera.bottom = H;
    camera.updateProjectionMatrix();

    _buildPostFX(W, H);
    _updateQuadUniforms();
  }

  function _updateQuadUniforms() {
    if (!quadComposite) return;
    const tsMain = new THREE.Vector2(1 / W, 1 / H);
    const ts     = new THREE.Vector2(1 / (W >> 1), 1 / (H >> 1));
    quadComposite.material.uniforms.texelSize.value = tsMain;
    quadBlurH.material.uniforms.texelSize.value = ts;
    quadBlurV.material.uniforms.texelSize.value = ts;
    quadComposite.material.uniforms.bloomStrength.value = bloomStrength;
  }

  // ─── setPostFX ──────────────────────────────────────────────────────────────

  function setPostFX(strength) {
    bloomStrength = strength != null ? strength : 0.45;
    if (quadComposite) quadComposite.material.uniforms.bloomStrength.value = bloomStrength;
  }

  // ─── Background updater ─────────────────────────────────────────────────────

  function _updateBackground(playerChar, cpuChar) {
    // Convert hex char BG colors to vec3, boost slightly for visibility
    function charVec(idx, isTop) {
      const hex = (typeof window.getCharBg === 'function')
        ? window.getCharBg(idx)
        : CHAR_BG[idx] || '#000000';
      const v = hexToVec3(hex);
      // Multiply up a bit so backgrounds aren't pitch black
      const scale = isTop ? 0.55 : 0.15;
      return new THREE.Vector3(v.x * scale + 0.02, v.y * scale + 0.02, v.z * scale + 0.02);
    }

    // Left half: player background
    bgPlaneL.material.uniforms.colorTop.value = charVec(playerChar, true);
    bgPlaneL.material.uniforms.colorBot.value = charVec(playerChar, false);

    // Right half: CPU background
    bgPlaneR.material.uniforms.colorTop.value = charVec(cpuChar, true);
    bgPlaneR.material.uniforms.colorBot.value = charVec(cpuChar, false);

    // Resize background planes to fill their respective halves
    bgPlaneL.scale.set(W / 2, H, 1);
    bgPlaneL.position.set(W / 4, H / 2, -100);

    bgPlaneR.scale.set(W / 2, H, 1);
    bgPlaneR.position.set(W * 3 / 4, H / 2, -100);
  }

  // ─── Board floor updater ────────────────────────────────────────────────────

  function _updateFloors(lx, rx, by, bw, bh, playerChar, cpuChar) {
    function accentForChar(idx) {
      const CHAR_COLORS = ['red', 'blue', 'yellow', 'green'];
      const colName = CHAR_COLORS[idx] || 'red';
      const pal = PAL_GL[colName] || PAL_GL.red;
      return new THREE.Vector3(...pal.main);
    }

    floorL.material.uniforms.accentColor.value = accentForChar(playerChar);
    floorR.material.uniforms.accentColor.value = accentForChar(cpuChar);

    // Position at board location; z slightly in front of background
    floorL.scale.set(bw, bh, 1);
    floorL.position.set(lx + bw / 2, by + bh / 2, -50);

    floorR.scale.set(bw, bh, 1);
    floorR.position.set(rx + bw / 2, by + bh / 2, -50);
  }

  // ─── Gem instance sync ───────────────────────────────────────────────────────

  // Reset all instance counts to 0
  function _resetInstances() {
    for (const key of Object.keys(gemMeshes)) {
      gemMeshes[key].count = 0;
    }
    // Internal per-key slot counters
    _resetInstances._idx = {};
    for (const key of Object.keys(gemMeshes)) {
      _resetInstances._idx[key] = 0;
    }
  }
  _resetInstances._idx = {};

  // Place one gem instance
  function _placeGemInstance(colorName, type, px, py, cell) {
    // Power gems handled separately
    if (type === TP) return;

    const effectiveType = type === TK ? TK : type;
    const key = `${colorName}_${effectiveType}`;
    const mesh = gemMeshes[key];
    if (!mesh) return;

    const idx = _resetInstances._idx[key] || 0;
    if (idx >= MAX_INSTANCES) return;

    // In THREE orthographic Y-down space: position at pixel center
    _obj.position.set(px + cell * 0.5, py + cell * 0.5, 0);
    _obj.scale.set(cell, cell, cell * 0.5);
    _obj.rotation.set(0, 0, 0);
    _obj.updateMatrix();
    mesh.setMatrixAt(idx, _obj.matrix);

    // instanceMatrix needs update
    mesh.instanceMatrix.needsUpdate = true;
    _resetInstances._idx[key] = idx + 1;
    mesh.count = _resetInstances._idx[key];
  }

  // Sync board state to instanced meshes
  function _syncBoards(boards, pieces, lx, rx, by, cell, bw, bh) {
    _resetInstances();

    if (!boards) return;

    const boardOrigins = [{ x: lx, y: by }, { x: rx, y: by }];

    for (let bi = 0; bi < 2; bi++) {
      if (!boards[bi]) continue;
      const ox = boardOrigins[bi].x;

      for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 6; col++) {
          const gem = boards[bi][row][col];
          if (!gem) continue;
          if (gem.type === TP) continue; // power gems rendered by 2D canvas

          const px = ox + col * cell;
          const py = by + row * cell;
          const colorName = gem.color || 'gray';
          _placeGemInstance(colorName, gem.type, px, py, cell);
        }
      }

      // Active piece
      if (pieces && pieces[bi]) {
        const p = pieces[bi];
        // ROTS mirrors game
        const ROTS = [[[0,0],[1,0]],[[0,0],[0,1]],[[0,0],[-1,0]],[[0,0],[0,-1]]];
        const r = ROTS[p.orient % 4];
        const cells2 = [[p.x + r[0][0], p.y + r[0][1]], [p.x + r[1][0], p.y + r[1][1]]];
        const pieceColors = [p.c1, p.c2];
        const pieceTypes  = [p.t1, p.t2];
        for (let i = 0; i < 2; i++) {
          const [gc, gr] = cells2[i];
          if (gr < 0) continue;
          const px = ox + gc * cell;
          const py = by + gr * cell;
          _placeGemInstance(pieceColors[i] || 'red', pieceTypes[i] != null ? pieceTypes[i] : TN, px, py, cell);
        }
      }
    }
  }

  // ─── Dynamic point light updater ────────────────────────────────────────────

  function _updatePointLights(pieces, lx, rx, by, cell) {
    const ROTS = [[[0,0],[1,0]],[[0,0],[0,1]],[[0,0],[-1,0]],[[0,0],[0,-1]]];

    function getPieceCenter(piece, ox) {
      if (!piece) return null;
      const r = ROTS[piece.orient % 4];
      const c0 = [piece.x + r[0][0], piece.y + r[0][1]];
      const c1 = [piece.x + r[1][0], piece.y + r[1][1]];
      return {
        x: ox + ((c0[0] + c1[0]) / 2 + 0.5) * cell,
        y: by  + ((c0[1] + c1[1]) / 2 + 0.5) * cell,
        color: piece.c1 || 'red',
      };
    }

    const pc = pieces && getPieceCenter(pieces[0], lx);
    const cc = pieces && getPieceCenter(pieces[1], rx);

    const CHAR_COLORS = ['red', 'blue', 'yellow', 'green'];

    if (pc) {
      const pal = PAL_GL[pc.color] || PAL_GL.red;
      pointLightL.color.setRGB(...pal.accent);
      pointLightL.position.set(pc.x, pc.y, 60);
      pointLightL.intensity = 0.6;
    } else {
      pointLightL.intensity = 0;
    }

    if (cc) {
      const pal = PAL_GL[cc.color] || PAL_GL.blue;
      pointLightR.color.setRGB(...pal.accent);
      pointLightR.position.set(cc.x, cc.y, 60);
      pointLightR.intensity = 0.6;
    } else {
      pointLightR.intensity = 0;
    }
  }

  // ─── Post-processing render ──────────────────────────────────────────────────

  function _renderPostFX() {
    const fs = fsScene;
    const fc = fsCam;

    // 1. Scene → rtMain
    renderer.setRenderTarget(rtMain);
    renderer.render(scene, camera);

    // 2. Bright-extract → rtBright
    fs.children.length = 0;
    fs.add(quadBright);
    renderer.setRenderTarget(rtBright);
    renderer.render(fs, fc);

    // 3. Blur H → rtBlurH
    fs.children.length = 0;
    fs.add(quadBlurH);
    renderer.setRenderTarget(rtBlurH);
    renderer.render(fs, fc);

    // 4. Blur V → rtBlurV
    fs.children.length = 0;
    fs.add(quadBlurV);
    renderer.setRenderTarget(rtBlurV);
    renderer.render(fs, fc);

    // 5. Composite → screen
    fs.children.length = 0;
    fs.add(quadComposite);
    renderer.setRenderTarget(null);
    renderer.render(fs, fc);
  }

  // ─── Simple background-only render (non-game states) ───────────────────────

  function _renderBackground() {
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
  }

  // ─── Main render entry point ─────────────────────────────────────────────────

  function render(
    dt,
    gameState,
    boards,
    pieces,
    lx, rx, by, cell, bw, bh,
    playerChar, cpuChar,
    fallProgress, spawnFlash, attackWarning, allClearDisplay, superMeter
  ) {
    if (!initialized) return;

    totalTime += dt;

    // Update all shader time uniforms
    for (const key of Object.keys(gemMats)) {
      const mat = gemMats[key];
      if (mat.uniforms && mat.uniforms.time) {
        mat.uniforms.time.value = totalTime;
      }
    }

    // S.GAME === 4
    const S_GAME = 4;

    if (gameState !== S_GAME) {
      _renderBackground();
      return;
    }

    // ── Full game scene render ──

    // Ensure camera matches current dimensions
    camera.left   = 0;
    camera.right  = W;
    camera.top    = 0;
    camera.bottom = H;
    camera.updateProjectionMatrix();

    _updateBackground(playerChar || 0, cpuChar || 1);
    _updateFloors(lx, rx, by, bw, bh, playerChar || 0, cpuChar || 1);
    _syncBoards(boards, pieces, lx, rx, by, cell, bw, bh);
    _updatePointLights(pieces, lx, rx, by, cell);

    // Tick particles
    _tickParticles(dt);

    // Render via post-processing chain
    renderer.setClearColor(0x000000, 1);
    _renderPostFX();
  }

  // ─── GPU Particle System ─────────────────────────────────────────────────────

  function emitBreak(x, y, colorName) {
    if (!initialized) return;

    const COUNT = 30;
    const pal = PAL_GL[colorName] || PAL_GL.gray;

    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    const startTimes = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);

    const now = totalTime;

    for (let i = 0; i < COUNT; i++) {
      // Start at the gem position
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 5;

      // Random velocity in a burst pattern
      const angle = (Math.random() * Math.PI * 2);
      const speed = 80 + Math.random() * 160;
      velocities[i * 3 + 0] = Math.cos(angle) * speed;
      velocities[i * 3 + 1] = Math.sin(angle) * speed - 60; // bias upward in screen space
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 20;

      startTimes[i] = now;

      // Mix between hi and main color with slight jitter
      const t = Math.random();
      colors[i * 3 + 0] = pal.hi[0] * t + pal.main[0] * (1 - t);
      colors[i * 3 + 1] = pal.hi[1] * t + pal.main[1] * (1 - t);
      colors[i * 3 + 2] = pal.hi[2] * t + pal.main[2] * (1 - t);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',  new THREE.BufferAttribute(positions,  3));
    geo.setAttribute('velocity',  new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('startTime', new THREE.BufferAttribute(startTimes, 1));
    geo.setAttribute('aColor',    new THREE.BufferAttribute(colors,     3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        currentTime: { value: now },
        size:        { value: Math.max(6, (window.CELL || 28) * 0.35) },
      },
      vertexShader:   particleVS,
      fragmentShader: particleFS,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points._birthTime = now;
    points._life = 0.55; // seconds

    scene.add(points);
    particleSystems.push(points);
  }

  function _tickParticles(dt) {
    for (let i = particleSystems.length - 1; i >= 0; i--) {
      const ps = particleSystems[i];
      const age = totalTime - ps._birthTime;

      if (age > ps._life) {
        scene.remove(ps);
        ps.geometry.dispose();
        ps.material.dispose();
        particleSystems.splice(i, 1);
        continue;
      }

      // Update time uniform so the vertex shader can animate
      ps.material.uniforms.currentTime.value = totalTime;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  Object.assign(window.pfGL = window.pfGL || {}, {
    init,
    resize,
    render,
    emitBreak,
    setPostFX,
  });

})();
