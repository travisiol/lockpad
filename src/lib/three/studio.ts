import * as THREE from "three";

/*
  three.js plumbing for the hero padlock. Everything here is painted at
  runtime — there is no texture, model or HDR file to load.
*/

export const AMBER = 0xffb02e;
export const AMBER_RGB = "255, 176, 46";
export const BLUE = 0x3650ff;

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/**
 * A studio for chrome: a black room, two white softboxes, a long thin strip
 * overhead for the specular line, an amber rim strip low and behind so every
 * edge carries the lock colour, and a cold blue kicker on the far side so
 * the object reads as sitting inside the page's nebula.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.BackSide })));

  const panel = (w: number, h: number, color: number, intensity: number, x: number, y: number, z: number) => {
    const material = new THREE.MeshBasicMaterial();
    material.color.set(color).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };

  panel(6, 3, 0xffffff, 7, -4, 6, 4); // key softbox, top-left-front
  panel(3, 6, 0xffffff, 2.4, 7, 1, 3); // fill, right
  panel(12, 0.45, 0xffffff, 5, 0, 8, -2); // thin strip overhead → long specular line
  panel(10, 7, 0xffffff, 0.9, 0, 1, 10); // broad soft panel behind the camera, so the front face reads as metal, not black
  panel(10, 3, 0xffffff, 0.55, 0, -6, 5); // floor bounce, so the lower body keeps a grey sheen
  panel(12, 1.4, AMBER, 7, -3, -6, -4); // amber rim, below-back-left
  panel(4, 1, AMBER, 2.5, 6, -3, -5); // faint amber kicker, right-back
  panel(5, 5, BLUE, 1.6, 6, 3, -6); // cold kicker, far right-back

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  disposeScene(scene);
  return target.texture;
}

/** Soft radial glow as a texture, for light spill under and behind the subject. */
export function radialGlowTexture(rgb: string, alpha: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    gradient.addColorStop(0.45, `rgba(${rgb}, ${alpha * 0.32})`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function glowPlane(texture: THREE.Texture, size: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

export function chrome(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd9dde6,
    metalness: 1,
    roughness: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.35,
  });
}

export function darkSteel(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x2a2d36,
    metalness: 0.9,
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.1,
  });
}

export function matteBlack(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x05060a, metalness: 0.2, roughness: 0.7 });
}

/** Key / rim / kicker lights. */
export function addStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.PointLight(AMBER, 26, 14, 2);
  rim.position.set(-2.4, -2.2, -1.2);
  scene.add(rim);
  const kicker = new THREE.PointLight(0xffffff, 9, 12, 2);
  kicker.position.set(3.2, 2.4, 2.5);
  scene.add(kicker);
  const cold = new THREE.PointLight(BLUE, 8, 12, 2);
  cold.position.set(3.4, 1.2, -2.6);
  scene.add(cold);
}

/** Calls `cb` now and on every size change of `el`. */
export function observeSize(el: HTMLElement, cb: (width: number, height: number) => void): () => void {
  const emit = () => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) cb(rect.width, rect.height);
  };
  const observer = new ResizeObserver(emit);
  observer.observe(el);
  emit();
  return () => observer.disconnect();
}

/**
 * requestAnimationFrame loop that only runs while the canvas is on screen and
 * the tab is visible. With `animate = false` it renders a single frame.
 */
export function runLoop(canvas: HTMLCanvasElement, render: (time: number, dt: number) => void, animate: boolean): () => void {
  let raf = 0;
  let running = false;
  let visible = true;
  let last = performance.now();

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    render(now / 1000, dt);
    raf = requestAnimationFrame(frame);
  };

  const sync = () => {
    const should = animate && visible && !document.hidden;
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      sync();
    },
    { threshold: 0 },
  );
  observer.observe(canvas);
  document.addEventListener("visibilitychange", sync);

  if (!animate) render(0, 0);
  sync();

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    cancelAnimationFrame(raf);
    running = false;
  };
}

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        material.dispose();
      }
    }
  });
}
