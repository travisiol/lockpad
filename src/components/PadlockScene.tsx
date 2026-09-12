"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  AMBER,
  AMBER_RGB,
  addStudioLights,
  chrome,
  createRenderer,
  createStudioEnvironment,
  darkSteel,
  disposeScene,
  glowPlane,
  matteBlack,
  observeSize,
  radialGlowTexture,
  runLoop,
  supportsWebGL,
} from "@/lib/three/studio";
import { PadlockMark } from "@/components/PadlockMark";
import { useMounted } from "@/components/ConnectButton";

const BODY = { w: 2.4, h: 1.9, d: 0.8, r: 0.3 };
const SHACKLE = { r: 0.7, tube: 0.165, legTop: 1.0, legLen: 0.95 };
const REST = { x: -0.12, y: -0.42 };

let webglSupport: boolean | null = null;
function webgl(): boolean {
  if (webglSupport === null) webglSupport = supportsWebGL();
  return webglSupport;
}

/**
 * The hero object: a chrome padlock lit by a painted studio environment.
 * The shackle starts lifted and drops shut in the first second — the one
 * animation the product is about — then the whole lock floats and tilts
 * toward the pointer. Falls back to the SVG mark where WebGL is unavailable.
 */
export function PadlockScene({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // null during SSR and hydration; decided once the client owns the tree.
  const mounted = useMounted();
  const supported = mounted ? webgl() : null;

  useEffect(() => {
    if (!supported) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = createRenderer(canvas);
    const environment = createStudioEnvironment(renderer);

    const scene = new THREE.Scene();
    scene.environment = environment;

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    camera.position.set(0, 1.1, 8.2);
    camera.lookAt(0, 0.55, 0);

    addStudioLights(scene);

    const group = new THREE.Group();
    group.rotation.set(REST.x, REST.y, 0);
    scene.add(group);

    // Body
    const body = new THREE.Mesh(new RoundedBoxGeometry(BODY.w, BODY.h, BODY.d, 7, BODY.r), chrome());
    group.add(body);

    // A darker band across the body so the chrome has a break in it, like a
    // real lock's brass core.
    const band = new THREE.Mesh(new RoundedBoxGeometry(BODY.w + 0.02, 0.34, BODY.d + 0.02, 4, 0.12), darkSteel());
    band.position.y = 0.42;
    group.add(band);

    // Keyhole: a disc and a slot, set just proud of the front face.
    const keyZ = BODY.d / 2 + 0.01;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 32), matteBlack());
    hole.rotation.x = Math.PI / 2;
    hole.position.set(0, -0.08, keyZ);
    group.add(hole);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.06), matteBlack());
    slot.position.set(0, -0.34, keyZ);
    group.add(slot);

    // The one warm point on the object: a lit amber dot, the "locked" lamp.
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), new THREE.MeshBasicMaterial({ color: AMBER }));
    lamp.position.set(0.86, -0.62, keyZ + 0.001);
    group.add(lamp);
    const lampHalo = glowPlane(radialGlowTexture(AMBER_RGB, 0.9), 0.5);
    lampHalo.position.set(0.86, -0.62, keyZ + 0.002);
    group.add(lampHalo);

    // Shackle: a half torus over two legs, grouped so it can drop shut.
    const shackle = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(SHACKLE.r, SHACKLE.tube, 24, 64, Math.PI), chrome());
    arc.position.y = SHACKLE.legTop;
    shackle.add(arc);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(SHACKLE.tube, SHACKLE.tube, SHACKLE.legLen, 24), chrome());
      leg.position.set(side * SHACKLE.r, SHACKLE.legTop - SHACKLE.legLen / 2, 0);
      shackle.add(leg);
    }
    // Collars where the legs enter the body.
    for (const side of [-1, 1]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(SHACKLE.tube + 0.06, SHACKLE.tube + 0.06, 0.08, 32), darkSteel());
      collar.position.set(side * SHACKLE.r, BODY.h / 2 + 0.02, 0);
      group.add(collar);
    }
    const SHACKLE_OPEN = 0.42;
    shackle.position.y = reduce ? 0 : SHACKLE_OPEN;
    group.add(shackle);

    // Light spill: an amber ellipse on the floor and a cold halo behind.
    const floor = glowPlane(radialGlowTexture(AMBER_RGB, 0.5), 4.4);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0.1, -1.7, 0.3);
    scene.add(floor);
    const halo = glowPlane(radialGlowTexture("70, 90, 255", 0.42), 5.2);
    halo.position.set(0.2, 0.6, -2);
    scene.add(halo);

    // Pointer parallax, normalised to the viewport.
    const pointer = new THREE.Vector2();
    const onMove = (event: PointerEvent) => {
      pointer.set((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const stopResize = observeSize(host, (w, h) => {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });

    let elapsed = 0;
    const stopLoop = runLoop(
      canvas,
      (_time, dt) => {
        elapsed += dt;
        // Drop shut: ease out with a small bounce, done by ~1.3s.
        if (!reduce) {
          const t = Math.min(1, Math.max(0, (elapsed - 0.35) / 0.9));
          const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t) * Math.cos(t * Math.PI * 2.2);
          shackle.position.y = SHACKLE_OPEN * (1 - Math.min(1, eased));
        }
        const bob = reduce ? 0 : Math.sin(elapsed * 0.9) * 0.06;
        group.position.y = bob;
        const targetX = REST.x + (reduce ? 0 : -pointer.y * 0.16);
        const targetY = REST.y + (reduce ? 0 : pointer.x * 0.3 + Math.sin(elapsed * 0.35) * 0.06);
        group.rotation.x += (targetX - group.rotation.x) * Math.min(1, dt * 3);
        group.rotation.y += (targetY - group.rotation.y) * Math.min(1, dt * 3);
        renderer.render(scene, camera);
      },
      true,
    );

    return () => {
      stopLoop();
      stopResize();
      window.removeEventListener("pointermove", onMove);
      disposeScene(scene);
      environment.dispose();
      renderer.dispose();
    };
  }, [supported]);

  return (
    <div ref={hostRef} className={`relative ${className}`} aria-hidden="true">
      {supported === false ? (
        <div className="flex h-full w-full items-center justify-center">
          <PadlockMark className="h-[60%] w-auto" />
        </div>
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" />
      )}
    </div>
  );
}
