/**
 * renderer-stages.js
 * Stage background and character rendering module for Super Puzzle Fighter WebGL2.
 * Extends window.pfGL with stage/background mesh management.
 *
 * Depends on:
 *   - window.THREE  (Three.js global)
 *   - window.pfGL   (set up by renderer-core.js, or created here if absent)
 */

(function () {
  'use strict';

  window.pfGL = window.pfGL || {};

  // ---------------------------------------------------------------------------
  // Shared vertex shader (all stage planes)
  // ---------------------------------------------------------------------------
  const VERT_SHADER = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // ---------------------------------------------------------------------------
  // Fragment shaders — one per character
  // ---------------------------------------------------------------------------

  // KAI (idx 0) — Japanese Dojo / Temple at Dusk
  const FRAG_KAI = /* glsl */`
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Deep indigo sky gradient at top
      vec3 skyTop = vec3(0.05, 0.03, 0.15);
      vec3 skyBot = vec3(0.15, 0.05, 0.08);
      vec3 sky = mix(skyTop, skyBot, vUv.y);

      // Horizon glow (orange sunset at y≈0.35)
      float horizDist = abs(vUv.y - 0.35);
      vec3 horizGlow = vec3(0.8, 0.3, 0.05) * (1.0 - smoothstep(0.0, 0.2, horizDist)) * 0.6;

      // Stylized pagoda silhouette at bottom
      float roof1     = step(0.85, vUv.y) * step(vUv.x, 0.9)  * step(0.1,  vUv.x);
      float roof2     = step(0.78, vUv.y) * step(vUv.x, 0.82) * step(0.18, vUv.x);
      float roof3     = step(0.72, vUv.y) * step(vUv.x, 0.74) * step(0.26, vUv.x);
      float building  = step(0.72, vUv.y) * step(vUv.x, 0.62) * step(0.38, vUv.x);
      float silhouette = max(max(roof1, roof2), max(roof3, building));

      // Floating red lanterns
      vec2 lantern1 = vec2(0.25, 0.45);
      vec2 lantern2 = vec2(0.72, 0.52);
      float lan  = smoothstep(0.04,  0.0, length(vUv - lantern1));
           lan += smoothstep(0.035, 0.0, length(vUv - lantern2));

      vec3 finalColor = sky + horizGlow;
      finalColor = mix(finalColor, vec3(0.0), silhouette * 0.95);
      finalColor += vec3(0.9, 0.2, 0.1) * lan * (0.7 + 0.3 * sin(time * 2.0));

      gl_FragColor = vec4(finalColor * 0.7, 1.0);
    }
  `;

  // MEI (idx 1) — Hong Kong Rooftop at Night
  const FRAG_MEI = /* glsl */`
    uniform float time;
    varying vec2 vUv;

    void main() {
      vec3 sky = mix(vec3(0.0, 0.02, 0.12), vec3(0.02, 0.05, 0.18), vUv.y);

      // Building grid (windows)
      vec2 gridUV  = fract(vUv * vec2(12.0, 8.0));
      float windowMask = step(0.1, gridUV.x) * step(0.1, gridUV.y)
                       * step(gridUV.x, 0.85) * step(gridUV.y, 0.8);
      vec2 cellID  = floor(vUv * vec2(12.0, 8.0));
      float rand   = fract(sin(dot(cellID, vec2(127.1, 311.7))) * 43758.5);
      float windowOn = step(0.35, rand);
      vec3 windowColor = mix(vec3(0.1, 0.3, 0.6), vec3(0.8, 0.6, 0.2), fract(rand * 7.3));

      // Neon sign glows
      float neon1 = smoothstep(0.03,  0.0, length(vUv - vec2(0.3,  0.6)));
      float neon2 = smoothstep(0.025, 0.0, length(vUv - vec2(0.65, 0.55)));

      // Rain streaks
      float rainUV = fract(vUv.x * 40.0 + time * 0.3);
      float rainY  = fract(vUv.y * 20.0 + time * 3.0 + fract(floor(vUv.x * 40.0) * 0.618));
      float rain   = step(0.92, rainUV) * step(0.0, rainY) * step(rainY, 0.15) * 0.3;

      vec3 col = sky;
      col += windowColor * windowMask * windowOn * 0.4;
      col += vec3(0.2, 0.5, 1.0) * neon1 * 0.8;
      col += vec3(1.0, 0.2, 0.4) * neon2 * 0.8;
      col += vec3(0.6, 0.7, 1.0) * rain;

      gl_FragColor = vec4(col * 0.75, 1.0);
    }
  `;

  // RIKU (idx 2) — Mountain Cliff at Sunset
  const FRAG_RIKU = /* glsl */`
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Sunset gradient
      vec3 skyTop = vec3(0.05, 0.05, 0.2);
      vec3 skyMid = vec3(0.9,  0.4,  0.05);
      vec3 skyBot = vec3(0.6,  0.15, 0.02);
      vec3 sky = vUv.y < 0.5
        ? mix(skyBot, skyMid, vUv.y * 2.0)
        : mix(skyMid, skyTop, (vUv.y - 0.5) * 2.0);

      // Mountain silhouette
      float mtn = smoothstep(0.0, 0.05,
        vUv.y - (0.3 + 0.25 * sin(vUv.x * 3.14) + 0.1 * sin(vUv.x * 7.3 + 1.2)));

      // Rising embers
      float ember = 0.0;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 ep = vec2(
          fract(0.2 + fi * 0.17 + sin(fi * 2.3) * 0.15),
          fract(0.1 + fi * 0.19 + time * 0.08 + fi * 0.07)
        );
        ember += smoothstep(0.02, 0.0, length(vUv - ep));
      }

      vec3 col = sky;
      col = mix(col, vec3(0.02, 0.01, 0.0), (1.0 - mtn));
      col += vec3(1.0, 0.5, 0.1) * ember * 0.9;

      gl_FragColor = vec4(col * 0.72, 1.0);
    }
  `;

  // SHADOW (idx 3) — Supernatural Shrine
  const FRAG_SHADOW = /* glsl */`
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Dark supernatural sky
      vec3 sky = mix(vec3(0.0, 0.02, 0.04), vec3(0.04, 0.0, 0.08), vUv.y);

      // Green energy wisps
      float wisp1 = smoothstep(0.06, 0.0, length(vUv - vec2(0.3 + 0.1 * sin(time * 0.7), 0.5)));
      float wisp2 = smoothstep(0.05, 0.0, length(vUv - vec2(0.7 + 0.08 * cos(time * 0.9), 0.4)));

      // Floating petals
      float petal = 0.0;
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        vec2 pp = vec2(
          fract(fi * 0.16 + sin(fi * 1.7 + time * 0.1) * 0.08),
          fract(fi * 0.15 + time * 0.04 + fi * 0.12)
        );
        petal += smoothstep(0.018, 0.0, length(vUv - pp));
      }

      // Lightning flicker
      float lightning = step(0.97, sin(time * 23.0 + 1.3)) * step(0.4, vUv.y);

      // Torii gate silhouette
      float toriV = step(0.72, vUv.y)
        * (step(0.3,  vUv.x) * step(vUv.x, 0.36)
         + step(0.64, vUv.x) * step(vUv.x, 0.70));
      float toriH = step(0.28, vUv.x) * step(vUv.x, 0.72)
        * (step(0.72, vUv.y) * step(vUv.y, 0.76)
         + step(0.82, vUv.y) * step(vUv.y, 0.86));
      float torii = max(toriV, toriH);

      vec3 col = sky;
      col += vec3(0.1, 0.6, 0.2) * wisp1 * 0.6;
      col += vec3(0.05, 0.4, 0.1) * wisp2 * 0.5;
      col += vec3(0.8, 0.5, 0.9) * petal * 0.7;
      col  = mix(col, vec3(0.0), torii * 0.9);
      col += vec3(0.8, 0.9, 1.0) * lightning * 0.4;

      gl_FragColor = vec4(col * 0.8, 1.0);
    }
  `;

  // ---------------------------------------------------------------------------
  // Full-screen background: dark gradient tinted by combined character colors
  // ---------------------------------------------------------------------------
  const FRAG_SCREENBG = /* glsl */`
    uniform vec3 colorA;   // player-side tint
    uniform vec3 colorB;   // cpu-side tint
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Blend from left (colorA) to right (colorB)
      vec3 tint = mix(colorA, colorB, vUv.x);
      // Dark vignette from edges
      vec2 centred = vUv - 0.5;
      float vignette = 1.0 - smoothstep(0.35, 0.85, length(centred));
      vec3 base = mix(vec3(0.0), tint * 0.18, vignette);
      gl_FragColor = vec4(base, 1.0);
    }
  `;

  // ---------------------------------------------------------------------------
  // Character accent colours (used for the full-screen bg tint)
  // ---------------------------------------------------------------------------
  const CHAR_COLORS = [
    new THREE.Color(0.8,  0.15, 0.05),  // 0 KAI    — red
    new THREE.Color(0.05, 0.2,  0.85),  // 1 MEI    — blue
    new THREE.Color(0.85, 0.75, 0.0),   // 2 RIKU   — yellow
    new THREE.Color(0.05, 0.55, 0.15),  // 3 SHADOW — green/dark
  ];

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  var _stageMaterials = null;   // Array[4] of ShaderMaterial — one per character
  var _screenBgMat   = null;   // ShaderMaterial for full-screen bg
  var _leftMesh      = null;   // Board BG mesh — left  (player)
  var _rightMesh     = null;   // Board BG mesh — right (cpu)
  var _screenBgMesh  = null;   // Full-screen bg mesh
  var _startTime     = Date.now();

  // ---------------------------------------------------------------------------
  // Helper: build a ShaderMaterial with a `time` uniform
  // ---------------------------------------------------------------------------
  function makeStageMat(fragShader) {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader:   VERT_SHADER,
      fragmentShader: fragShader,
      depthWrite: false,
      depthTest:  false,
    });
  }

  // ---------------------------------------------------------------------------
  // pfGL.initStages(scene)
  //   Creates all stage meshes and adds them to the scene.
  //   Returns [leftMesh, rightMesh].
  // ---------------------------------------------------------------------------
  window.pfGL.initStages = function (scene) {
    // Build per-character stage materials
    _stageMaterials = [
      makeStageMat(FRAG_KAI),
      makeStageMat(FRAG_MEI),
      makeStageMat(FRAG_RIKU),
      makeStageMat(FRAG_SHADOW),
    ];

    // Full-screen background material
    _screenBgMat = new THREE.ShaderMaterial({
      uniforms: {
        colorA: { value: new THREE.Color(0, 0, 0) },
        colorB: { value: new THREE.Color(0, 0, 0) },
        time:   { value: 0.0 },
      },
      vertexShader:   VERT_SHADER,
      fragmentShader: FRAG_SCREENBG,
      depthWrite: false,
      depthTest:  false,
    });

    // Geometry — unit planes; scaled in resizeStages / renderStages
    var boardGeo  = new THREE.PlaneGeometry(1, 1);
    var screenGeo = new THREE.PlaneGeometry(1, 1);

    // Full-screen background (z = -50, render first)
    _screenBgMesh = new THREE.Mesh(screenGeo, _screenBgMat);
    _screenBgMesh.renderOrder = -2;
    scene.add(_screenBgMesh);

    // Left board background (player), z = -10
    _leftMesh = new THREE.Mesh(boardGeo.clone(), _stageMaterials[0]);
    _leftMesh.renderOrder = -1;
    scene.add(_leftMesh);

    // Right board background (cpu), z = -10
    _rightMesh = new THREE.Mesh(boardGeo.clone(), _stageMaterials[0]);
    _rightMesh.renderOrder = -1;
    scene.add(_rightMesh);

    return [_leftMesh, _rightMesh];
  };

  // ---------------------------------------------------------------------------
  // pfGL.updateStageColors(playerChar, cpuChar)
  //   Swaps the ShaderMaterial on each board mesh and updates the full-screen
  //   background tint colours.
  // ---------------------------------------------------------------------------
  window.pfGL.updateStageColors = function (playerChar, cpuChar) {
    var pIdx = (typeof playerChar === 'number') ? (playerChar % 4) : 0;
    var cIdx = (typeof cpuChar    === 'number') ? (cpuChar    % 4) : 0;

    if (_leftMesh  && _stageMaterials) {
      _leftMesh.material  = _stageMaterials[pIdx];
    }
    if (_rightMesh && _stageMaterials) {
      _rightMesh.material = _stageMaterials[cIdx];
    }

    if (_screenBgMat) {
      _screenBgMat.uniforms.colorA.value.copy(CHAR_COLORS[pIdx]);
      _screenBgMat.uniforms.colorB.value.copy(CHAR_COLORS[cIdx]);
    }
  };

  // ---------------------------------------------------------------------------
  // pfGL.resizeStages(W, H, lx, rx, by, bw, bh)
  //   Repositions and scales stage planes to match the current board dimensions.
  //   Called on canvas resize and also from renderStages every frame (cheap).
  //
  //   Coordinate system: Three.js orthographic where (0,0) = canvas centre,
  //   x-right positive, y-up positive, matching a camera set up as
  //     OrthographicCamera(-W/2, W/2, H/2, -H/2, ...)
  //
  //   lx, rx — left/right board left-edge X in pixel coords (0 = canvas left)
  //   by      — board top Y in pixel coords (0 = canvas top)
  //   bw, bh  — board width/height in pixels
  // ---------------------------------------------------------------------------
  window.pfGL.resizeStages = function (W, H, lx, rx, by, bw, bh) {
    if (!_screenBgMesh || !_leftMesh || !_rightMesh) return;

    // renderer-core.js uses OrthographicCamera(0,W,0,H): world coords = pixel coords, y-down.
    // PlaneGeometry(1,1) is centred at its position, so use the board's pixel centre point.

    // Full-screen background: centred at screen midpoint
    _screenBgMesh.scale.set(W, H, 1);
    _screenBgMesh.position.set(W * 0.5, H * 0.5, -50);

    // Left board (player)
    _leftMesh.scale.set(bw, bh, 1);
    _leftMesh.position.set(lx + bw * 0.5, by + bh * 0.5, -10);

    // Right board (cpu)
    _rightMesh.scale.set(bw, bh, 1);
    _rightMesh.position.set(rx + bw * 0.5, by + bh * 0.5, -10);
  };

  // ---------------------------------------------------------------------------
  // pfGL.renderStages(scene, W, H, lx, rx, by, bw, bh, playerChar, cpuChar)
  //   Called by renderer-core each frame, after the scene is set up.
  //   Updates time uniforms and repositions planes.
  // ---------------------------------------------------------------------------
  window.pfGL.renderStages = function (scene, W, H, lx, rx, by, bw, bh, playerChar, cpuChar) {
    var t = (Date.now() - _startTime) * 0.001; // seconds

    // Update time on all stage materials
    if (_stageMaterials) {
      for (var i = 0; i < _stageMaterials.length; i++) {
        _stageMaterials[i].uniforms.time.value = t;
      }
    }
    if (_screenBgMat) {
      _screenBgMat.uniforms.time.value = t;
    }

    // Keep board materials in sync (idempotent, cheap)
    window.pfGL.updateStageColors(playerChar, cpuChar);

    // Re-apply geometry transforms (handles resize without a separate event)
    window.pfGL.resizeStages(W, H, lx, rx, by, bw, bh);
  };

}());
