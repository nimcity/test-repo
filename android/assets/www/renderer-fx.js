/**
 * renderer-fx.js
 * Post-processing (HDR bloom + chromatic aberration + vignette + film grain)
 * and GPU particle system for Super Puzzle Fighter WebGL2 renderer.
 *
 * Extends window.pfGL — safe to load before renderer-core.js.
 * Requires window.THREE (Three.js global).
 */

(function () {
  'use strict';

  // Ensure pfGL namespace exists.
  window.pfGL = window.pfGL || {};

  // ---------------------------------------------------------------------------
  // GLSL Sources
  // ---------------------------------------------------------------------------

  const COMMON_VERT = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const BRIGHT_EXTRACT_FRAG = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float threshold;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float brightness = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
      float contribution = max(0.0, brightness - threshold);
      gl_FragColor = texel * (contribution / max(brightness, 0.001));
    }
  `;

  const BLUR_FRAG = /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform vec2 direction;
    varying vec2 vUv;
    void main() {
      vec2 texelSize = direction / resolution;
      vec4 result = vec4(0.0);
      // 9-tap Gaussian weights (sum ≈ 1.0)
      float w0 = 0.051;
      float w1 = 0.0918;
      float w2 = 0.1227;
      float w3 = 0.1331;
      float w4 = 0.1462;
      result += texture2D(tDiffuse, vUv + texelSize * -4.0) * w0;
      result += texture2D(tDiffuse, vUv + texelSize * -3.0) * w1;
      result += texture2D(tDiffuse, vUv + texelSize * -2.0) * w2;
      result += texture2D(tDiffuse, vUv + texelSize * -1.0) * w3;
      result += texture2D(tDiffuse, vUv                   ) * w4;
      result += texture2D(tDiffuse, vUv + texelSize *  1.0) * w3;
      result += texture2D(tDiffuse, vUv + texelSize *  2.0) * w2;
      result += texture2D(tDiffuse, vUv + texelSize *  3.0) * w1;
      result += texture2D(tDiffuse, vUv + texelSize *  4.0) * w0;
      gl_FragColor = result;
    }
  `;

  const COMPOSITE_FRAG = /* glsl */`
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform float bloomStrength;
    uniform float time;
    varying vec2 vUv;
    void main() {
      // Chromatic aberration
      float caStrength = 0.003;
      vec2 dir = vUv - 0.5;
      float r = texture2D(tScene, vUv + dir * caStrength).r;
      float g = texture2D(tScene, vUv).g;
      float b = texture2D(tScene, vUv - dir * caStrength).b;
      vec4 sceneColor = vec4(r, g, b, 1.0);

      // Bloom
      vec4 bloomColor = texture2D(tBloom, vUv);
      vec3 combined = sceneColor.rgb + bloomColor.rgb * bloomStrength;

      // Vignette
      float vignette = 1.0 - smoothstep(0.5, 1.2, length(dir * vec2(1.0, 1.3)));
      combined *= (0.85 + 0.15 * vignette);

      // Subtle film grain
      float grain = fract(sin(dot(vUv + time * 0.01, vec2(127.1, 311.7))) * 43758.5453) * 0.03 - 0.015;
      combined += grain;

      gl_FragColor = vec4(combined, 1.0);
    }
  `;

  // ---------------------------------------------------------------------------
  // Particle GLSL
  // ---------------------------------------------------------------------------

  const PARTICLE_VERT = /* glsl */`
    attribute vec3 aVelocity;
    attribute float aStartTime;
    attribute vec3 aColor;
    uniform float uCurrentTime;
    varying float vAlpha;
    varying vec3 vColor;
    const float GRAVITY = 300.0;
    void main() {
      float age = uCurrentTime - aStartTime;
      float maxAge = 0.6;
      if (age < 0.0 || age > maxAge) {
        gl_PointSize = 0.0;
        vAlpha = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off-screen
        return;
      }
      vec3 pos = position + aVelocity * age + vec3(0.0, GRAVITY * age * age * 0.5, 0.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      vAlpha = 1.0 - (age / maxAge);
      vAlpha = vAlpha * vAlpha;
      gl_PointSize = 6.0 * vAlpha + 2.0;
      vColor = aColor;
    }
  `;

  const PARTICLE_FRAG = /* glsl */`
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) discard;
      float intensity = (0.5 - d) * 2.0;
      gl_FragColor = vec4(vColor + 0.3, vAlpha * intensity);
    }
  `;

  // ---------------------------------------------------------------------------
  // All-Clear particle GLSL (larger, ring-expansion + starburst lines)
  // ---------------------------------------------------------------------------

  const ALLCLEAR_VERT = /* glsl */`
    attribute vec3 aVelocity;
    attribute float aStartTime;
    attribute vec3 aColor;
    attribute float aSize;
    uniform float uCurrentTime;
    varying float vAlpha;
    varying vec3 vColor;
    const float GRAVITY = 60.0;
    void main() {
      float age = uCurrentTime - aStartTime;
      float maxAge = 1.2;
      if (age < 0.0 || age > maxAge) {
        gl_PointSize = 0.0;
        vAlpha = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      vec3 pos = position + aVelocity * age + vec3(0.0, GRAVITY * age * age * 0.5, 0.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      // Fade: quick rise then slow fade
      float t = age / maxAge;
      vAlpha = t < 0.15 ? (t / 0.15) : (1.0 - ((t - 0.15) / 0.85));
      vAlpha = max(0.0, vAlpha);
      gl_PointSize = aSize * vAlpha + 3.0;
      vColor = aColor;
    }
  `;

  const ALLCLEAR_FRAG = /* glsl */`
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) discard;
      // Bright core glow
      float glow = exp(-d * 6.0);
      float rim  = (0.5 - d) * 2.0;
      float intensity = glow * 0.6 + rim * 0.4;
      gl_FragColor = vec4(vColor, vAlpha * intensity);
    }
  `;

  // ---------------------------------------------------------------------------
  // Private state (closures — shared across all pfGL methods in this file)
  // ---------------------------------------------------------------------------

  // Render targets
  let rtMain   = null; // kept for resize reference (not used directly in render)
  let rtBright = null;
  let rtBlurH  = null;
  let rtBlurV  = null;

  // Full-screen quad objects  { scene, cam, mesh }
  let brightExtractQuad = null;
  let blurHQuad         = null;
  let blurVQuad         = null;
  let compositeQuad     = null;

  // Current bloom strength
  let _bloomStrength = 1.2;

  // Active particle systems (THREE.Points)
  let particleSystems = [];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a full-screen orthographic quad scene for post-processing passes.
   * @param {THREE.Material} material
   * @returns {{ scene: THREE.Scene, cam: THREE.OrthographicCamera, mesh: THREE.Mesh }}
   */
  function makeFullScreenQuad(material) {
    const scene = new THREE.Scene();
    const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mesh  = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    return { scene, cam, mesh };
  }

  /**
   * Build a ShaderMaterial using the shared vertex shader.
   * @param {string} fragmentShader
   * @param {object} uniforms
   * @returns {THREE.ShaderMaterial}
   */
  function makePostMaterial(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: fragmentShader,
      uniforms: uniforms,
      depthTest: false,
      depthWrite: false
    });
  }

  // ---------------------------------------------------------------------------
  // pfGL.initFX
  // ---------------------------------------------------------------------------

  /**
   * Initialise render targets, shaders, and full-screen quads for post-FX.
   * Call once after the WebGL renderer is created.
   *
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} W  Canvas pixel width
   * @param {number} H  Canvas pixel height
   */
  window.pfGL.initFX = function (renderer, W, H) {
    const W2 = Math.floor(W / 2);
    const H2 = Math.floor(H / 2);

    // ---------- render targets ----------

    rtMain = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType
    });

    const halfParams = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    };
    rtBright = new THREE.WebGLRenderTarget(W2, H2, halfParams);
    rtBlurH  = new THREE.WebGLRenderTarget(W2, H2, halfParams);
    rtBlurV  = new THREE.WebGLRenderTarget(W2, H2, halfParams);

    // ---------- bright-extract pass ----------

    brightExtractQuad = makeFullScreenQuad(
      makePostMaterial(BRIGHT_EXTRACT_FRAG, {
        tDiffuse:  { value: null },
        threshold: { value: 0.6 }
      })
    );

    // ---------- horizontal blur pass ----------

    blurHQuad = makeFullScreenQuad(
      makePostMaterial(BLUR_FRAG, {
        tDiffuse:   { value: null },
        resolution: { value: new THREE.Vector2(W2, H2) },
        direction:  { value: new THREE.Vector2(1, 0) }
      })
    );

    // ---------- vertical blur pass ----------

    blurVQuad = makeFullScreenQuad(
      makePostMaterial(BLUR_FRAG, {
        tDiffuse:   { value: null },
        resolution: { value: new THREE.Vector2(W2, H2) },
        direction:  { value: new THREE.Vector2(0, 1) }
      })
    );

    // ---------- composite pass ----------

    compositeQuad = makeFullScreenQuad(
      makePostMaterial(COMPOSITE_FRAG, {
        tScene:       { value: null },
        tBloom:       { value: null },
        bloomStrength: { value: _bloomStrength },
        time:         { value: 0.0 }
      })
    );
  };

  // ---------------------------------------------------------------------------
  // pfGL.renderFX
  // ---------------------------------------------------------------------------

  /**
   * Run the full post-processing pipeline and output to the screen.
   * Must be called after the main scene has already been rendered into
   * `mainTarget` by renderer-core.js.
   *
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget} mainTarget  The source render target
   * @param {number} W  Canvas pixel width  (unused here but kept for signature)
   * @param {number} H  Canvas pixel height (unused here but kept for signature)
   */
  window.pfGL.renderFX = function (renderer, mainTarget, W, H) {
    if (!brightExtractQuad) {
      // initFX has not been called yet; nothing to do.
      return;
    }

    // --- Pass 1: bright extract (mainTarget → rtBright) ---
    brightExtractQuad.mesh.material.uniforms.tDiffuse.value = mainTarget.texture;
    renderer.setRenderTarget(rtBright);
    renderer.render(brightExtractQuad.scene, brightExtractQuad.cam);

    // --- Pass 2: horizontal blur (rtBright → rtBlurH) ---
    blurHQuad.mesh.material.uniforms.tDiffuse.value   = rtBright.texture;
    blurHQuad.mesh.material.uniforms.direction.value.set(1, 0);
    renderer.setRenderTarget(rtBlurH);
    renderer.render(blurHQuad.scene, blurHQuad.cam);

    // --- Pass 3: vertical blur (rtBlurH → rtBlurV) ---
    blurVQuad.mesh.material.uniforms.tDiffuse.value   = rtBlurH.texture;
    blurVQuad.mesh.material.uniforms.direction.value.set(0, 1);
    renderer.setRenderTarget(rtBlurV);
    renderer.render(blurVQuad.scene, blurVQuad.cam);

    // --- Pass 4: composite (mainTarget + rtBlurV → screen) ---
    compositeQuad.mesh.material.uniforms.tScene.value        = mainTarget.texture;
    compositeQuad.mesh.material.uniforms.tBloom.value        = rtBlurV.texture;
    compositeQuad.mesh.material.uniforms.bloomStrength.value = _bloomStrength;
    compositeQuad.mesh.material.uniforms.time.value          = performance.now() * 0.001;
    renderer.setRenderTarget(null); // output to canvas/screen
    renderer.render(compositeQuad.scene, compositeQuad.cam);
  };

  // ---------------------------------------------------------------------------
  // pfGL.setBloom
  // ---------------------------------------------------------------------------

  /**
   * Adjust bloom intensity at runtime.
   * @param {number} strength  0.0 (off) – 3.0 (very strong)
   */
  window.pfGL.setBloom = function (strength) {
    _bloomStrength = Math.max(0.0, Math.min(3.0, strength));
    if (compositeQuad) {
      compositeQuad.mesh.material.uniforms.bloomStrength.value = _bloomStrength;
    }
  };

  // ---------------------------------------------------------------------------
  // pfGL.emitBreak
  // ---------------------------------------------------------------------------

  /**
   * Spawn a GPU particle burst at pixel position (x, y) for a gem break event.
   *
   * @param {THREE.Scene} scene     The scene that owns particle systems
   * @param {number}      x         World-space X of the break
   * @param {number}      y         World-space Y of the break
   * @param {number}      colorHex  0xRRGGBB hex colour for the gem
   * @param {number}     [count=24] Number of particles
   */
  window.pfGL.emitBreak = function (scene, x, y, colorHex, count) {
    count = (count !== undefined && count > 0) ? count : 24;

    const positions  = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const startTimes = new Float32Array(count);
    const colors     = new Float32Array(count * 3);

    const col = new THREE.Color(colorHex);
    const now = performance.now() * 0.001;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 80 + Math.random() * 180;

      positions[i * 3    ] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 5;

      velocities[i * 3    ] = Math.cos(angle) * speed;
      // Mostly upward — negate Y because Y increases downward in most 2-D layouts
      velocities[i * 3 + 1] = -Math.abs(Math.sin(angle)) * speed - 60;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 30;

      // Slight stagger so particles don't all start on the exact same frame
      startTimes[i] = now + Math.random() * 0.05;

      colors[i * 3    ] = Math.min(1.0, col.r + Math.random() * 0.3);
      colors[i * 3 + 1] = Math.min(1.0, col.g + Math.random() * 0.3);
      colors[i * 3 + 2] = Math.min(1.0, col.b + Math.random() * 0.3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',   new THREE.BufferAttribute(positions,  3));
    geo.setAttribute('aVelocity',  new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('aStartTime', new THREE.BufferAttribute(startTimes, 1));
    geo.setAttribute('aColor',     new THREE.BufferAttribute(colors,     3));

    const mat = new THREE.ShaderMaterial({
      vertexShader:   PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uCurrentTime: { value: now }
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    points._expires = now + 0.7;
    scene.add(points);
    particleSystems.push(points);
  };

  // ---------------------------------------------------------------------------
  // pfGL.updateParticles
  // ---------------------------------------------------------------------------

  /**
   * Advance particle simulation and remove expired systems.
   * Call once per frame, before rendering.
   *
   * @param {THREE.Scene} scene  Same scene passed to emitBreak / emitAllClear
   * @param {number}      dt     Delta time in seconds (informational; not used
   *                             because the shaders track absolute time)
   */
  window.pfGL.updateParticles = function (scene, dt) {
    const now = performance.now() * 0.001;

    for (let i = particleSystems.length - 1; i >= 0; i--) {
      const ps = particleSystems[i];

      // Update the shader's time uniform
      if (ps.material && ps.material.uniforms && ps.material.uniforms.uCurrentTime) {
        ps.material.uniforms.uCurrentTime.value = now;
      }

      // Remove expired systems
      if (now > ps._expires) {
        scene.remove(ps);
        ps.geometry.dispose();
        ps.material.dispose();
        particleSystems.splice(i, 1);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // pfGL.emitAllClear
  // ---------------------------------------------------------------------------

  /**
   * Spectacular ALL CLEAR burst effect.
   *  - Expanding ring of large bright golden particles
   *  - Dense inner starburst of white-hot sparks
   *  - Long golden "ray" streaks radiating outward
   *
   * @param {THREE.Scene} scene
   * @param {number}      x   World-space X of the board centre
   * @param {number}      y   World-space Y of the board centre
   * @param {number}      w   Board width  in world units (used to scale ring radius)
   * @param {number}      h   Board height in world units
   */
  window.pfGL.emitAllClear = function (scene, x, y, w, h) {
    const now    = performance.now() * 0.001;
    const radius = Math.max(w, h) * 0.5;

    // -----------------------------------------------------------------------
    // Layer A: expanding ring  (large, golden)
    // -----------------------------------------------------------------------
    const RING_COUNT = 64;
    _spawnAllClearBatch(scene, now, {
      count:   RING_COUNT,
      expires: now + 1.3,
      makeParticle: function (i, positions, velocities, startTimes, colors, sizes) {
        const angle = (i / RING_COUNT) * Math.PI * 2;
        const jitter = (Math.random() - 0.5) * 0.08;
        const speed  = radius * 2.2 + Math.random() * radius * 0.5;

        positions[i * 3    ] = x + Math.cos(angle) * 4;
        positions[i * 3 + 1] = y + Math.sin(angle) * 4;
        positions[i * 3 + 2] = 3;

        velocities[i * 3    ] = Math.cos(angle + jitter) * speed;
        velocities[i * 3 + 1] = Math.sin(angle + jitter) * speed;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 20;

        startTimes[i] = now + Math.random() * 0.04;

        // Golden palette
        colors[i * 3    ] = 1.0;
        colors[i * 3 + 1] = 0.78 + Math.random() * 0.22;
        colors[i * 3 + 2] = Math.random() * 0.25;

        sizes[i] = 18 + Math.random() * 14;
      }
    });

    // -----------------------------------------------------------------------
    // Layer B: dense inner starburst  (small, white-hot)
    // -----------------------------------------------------------------------
    const INNER_COUNT = 80;
    _spawnAllClearBatch(scene, now, {
      count:   INNER_COUNT,
      expires: now + 0.9,
      makeParticle: function (i, positions, velocities, startTimes, colors, sizes) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * radius * 1.8;

        positions[i * 3    ] = x + (Math.random() - 0.5) * 10;
        positions[i * 3 + 1] = y + (Math.random() - 0.5) * 10;
        positions[i * 3 + 2] = 4;

        velocities[i * 3    ] = Math.cos(angle) * speed;
        velocities[i * 3 + 1] = Math.sin(angle) * speed;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 40;

        startTimes[i] = now + Math.random() * 0.08;

        // White-hot core with colour fringe
        const hue = Math.random();
        const c   = new THREE.Color().setHSL(hue, 0.7, 0.85);
        colors[i * 3    ] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;

        sizes[i] = 6 + Math.random() * 6;
      }
    });

    // -----------------------------------------------------------------------
    // Layer C: golden starburst RAYS  (long streaks — large point size)
    // -----------------------------------------------------------------------
    const RAY_COUNT = 16;
    _spawnAllClearBatch(scene, now, {
      count:   RAY_COUNT,
      expires: now + 1.2,
      makeParticle: function (i, positions, velocities, startTimes, colors, sizes) {
        const angle = (i / RAY_COUNT) * Math.PI * 2;
        const speed = radius * 3.5;

        // Stagger along the ray so it looks like a streak
        const offset = Math.random() * radius * 0.3;
        positions[i * 3    ] = x + Math.cos(angle) * offset;
        positions[i * 3 + 1] = y + Math.sin(angle) * offset;
        positions[i * 3 + 2] = 2;

        velocities[i * 3    ] = Math.cos(angle) * speed;
        velocities[i * 3 + 1] = Math.sin(angle) * speed;
        velocities[i * 3 + 2] = 0;

        startTimes[i] = now + Math.random() * 0.02;

        // Bright gold / white
        colors[i * 3    ] = 1.0;
        colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 2] = 0.4 + Math.random() * 0.3;

        sizes[i] = 24 + Math.random() * 20;
      }
    });

    // -----------------------------------------------------------------------
    // Layer D: secondary rainbow ring (delayed, slower)
    // -----------------------------------------------------------------------
    const RAINBOW_COUNT = 48;
    _spawnAllClearBatch(scene, now, {
      count:   RAINBOW_COUNT,
      expires: now + 1.5,
      makeParticle: function (i, positions, velocities, startTimes, colors, sizes) {
        const angle = (i / RAINBOW_COUNT) * Math.PI * 2;
        const speed = radius * 1.4 + Math.random() * radius * 0.4;

        positions[i * 3    ] = x + Math.cos(angle) * 6;
        positions[i * 3 + 1] = y + Math.sin(angle) * 6;
        positions[i * 3 + 2] = 3;

        velocities[i * 3    ] = Math.cos(angle) * speed;
        velocities[i * 3 + 1] = Math.sin(angle) * speed;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 15;

        // Delay so it appears after the main ring
        startTimes[i] = now + 0.15 + Math.random() * 0.06;

        const c = new THREE.Color().setHSL((i / RAINBOW_COUNT + Math.random() * 0.05) % 1.0, 1.0, 0.65);
        colors[i * 3    ] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;

        sizes[i] = 10 + Math.random() * 8;
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Internal helper — spawn one batch of All-Clear particles
  // ---------------------------------------------------------------------------

  /**
   * @param {THREE.Scene} scene
   * @param {number}      now    performance.now() * 0.001
   * @param {object}      opts
   * @param {number}      opts.count
   * @param {number}      opts.expires
   * @param {Function}    opts.makeParticle  (i, pos, vel, st, col, sz) => void
   */
  function _spawnAllClearBatch(scene, now, opts) {
    const count = opts.count;

    const positions  = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const startTimes = new Float32Array(count);
    const colors     = new Float32Array(count * 3);
    const sizes      = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      opts.makeParticle(i, positions, velocities, startTimes, colors, sizes);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',   new THREE.BufferAttribute(positions,  3));
    geo.setAttribute('aVelocity',  new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('aStartTime', new THREE.BufferAttribute(startTimes, 1));
    geo.setAttribute('aColor',     new THREE.BufferAttribute(colors,     3));
    geo.setAttribute('aSize',      new THREE.BufferAttribute(sizes,      1));

    const mat = new THREE.ShaderMaterial({
      vertexShader:   ALLCLEAR_VERT,
      fragmentShader: ALLCLEAR_FRAG,
      uniforms: {
        uCurrentTime: { value: now }
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    points._expires = opts.expires;
    scene.add(points);
    particleSystems.push(points);
  }

}()); // end IIFE
