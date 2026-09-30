// 3D illustrations for style-riso, rendered in separation space (ink coverage per drum) into a render
// target that a sheet then screens and prints: a strawberry (the test subject) and a half-full wine glass
// with its BRIM ring.
import * as THREE from 'three';
import { makeRT } from '../engine/gl';
import { sepMaterial } from './style-riso-print';

/** Glass geometry constants (object space; the illustration camera frames them). */
export const GLASS = { rimY: 1.12, rimR: 0.29, wineY: 0.8, wineR: 0.315, bowlY: 0.5 } as const;

export class RisoIllus {
  rt = makeRT(768, 768, { pxScale: 1, depthBuffer: true });
  cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  berry = new THREE.Scene();
  glass = new THREE.Scene();
  berryRoot = new THREE.Object3D();
  glassRoot = new THREE.Object3D();
  wineTop: THREE.Mesh;
  wine: THREE.Mesh;

  constructor() {
    // ---- strawberry ----
    const prof = [[0.0, -0.56], [0.1, -0.5], [0.22, -0.34], [0.33, -0.12], [0.4, 0.08], [0.41, 0.22], [0.36, 0.34], [0.24, 0.43], [0.1, 0.47], [0.0, 0.48]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), sepMaterial(/* glsl */ `
      // seeds on a staggered grid in (around, along)
      vec2 g = vec2(vUv.x * 15.0, vUv.y * 9.0);
      g.x += 0.5 * mod(floor(g.y), 2.0);
      vec2 c = fract(g) - 0.5;
      float along = vUv.y;
      float seed = (1.0 - smoothstep(0.12, 0.2, length(c * vec2(1.0, 1.6)))) * step(0.08, along) * step(along, 0.85);
      float sp = pow(max(dot(reflect(-uL, n), v), 0.0), 18.0);
      float shade = pow(1.0 - dif, 1.3);
      ink.r = (0.97 - 0.75 * sp) * (1.0 - seed * 0.8);
      ink.g = 0.6 * shade + 0.25 * seed * (1.0 - dif);
      ink.b = seed * 0.95 + 0.1 * shade;
    `, { side: THREE.DoubleSide }));
    this.berryRoot.add(body);
    const leafMat = sepMaterial(/* glsl */ `
      float shade = 1.0 - dif;
      ink = vec3(0.0, 0.62 + 0.3 * shade, 0.95);
    `, { side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.36, 4, 1), leafMat);
      leaf.scale.set(1, 1, 0.25);
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const piv = new THREE.Object3D();
      piv.position.set(0, 0.44, 0);
      piv.rotation.set(0, a, 0);
      leaf.position.set(0, 0, 0.14);
      leaf.rotation.set(Math.PI / 2 - 0.35 - (i % 2) * 0.25, 0, 0);
      piv.add(leaf);
      this.berryRoot.add(piv);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.2, 6), leafMat);
    stem.position.set(0.01, 0.56, 0); stem.rotation.z = -0.25;
    this.berryRoot.add(stem);
    this.berry.add(this.berryRoot);

    // ---- wine glass: wine first (opaque), then the shell (max-blended fresnel lines), then the BRIM ring ----
    const wineProf = [[0.0, 0.5], [0.12, 0.515], [0.22, 0.57], [0.285, 0.66], [0.31, 0.74], [GLASS.wineR, GLASS.wineY]].map(([r, y]) => new THREE.Vector2(r, y));
    this.wine = new THREE.Mesh(new THREE.LatheGeometry(wineProf, 40), sepMaterial(/* glsl */ `
      float rim = pow(1.0 - abs(dot(n, v)), 1.5);
      ink = vec3(0.95, 0.28 + 0.45 * (1.0 - dif) + 0.2 * rim, 0.0);
    `, { side: THREE.DoubleSide }));
    this.wineTop = new THREE.Mesh(new THREE.CircleGeometry(GLASS.wineR, 40), sepMaterial(/* glsl */ `
      float sp = pow(max(dot(reflect(-uL, n), v), 0.0), 30.0);
      float edge = smoothstep(0.24, 0.31, length(vO.xy));
      ink = vec3(0.9 - 0.6 * sp, 0.12 + 0.35 * edge, 0.18 * (1.0 - edge));
    `, { side: THREE.DoubleSide }));
    this.wineTop.rotation.x = -Math.PI / 2;
    this.wineTop.position.y = GLASS.wineY;
    const glassProf = [[0.33, 0.0], [0.34, 0.012], [0.3, 0.02], [0.07, 0.035], [0.038, 0.07], [0.03, 0.2], [0.03, 0.4], [0.05, 0.47], [0.13, 0.5], [0.22, 0.55], [0.3, 0.65], [0.335, 0.8], [0.325, 0.95], [0.305, 1.05], [GLASS.rimR, GLASS.rimY]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const shell = new THREE.Mesh(new THREE.LatheGeometry(glassProf, 48), sepMaterial(/* glsl */ `
      float f = pow(1.0 - abs(dot(n, v)), 2.4);
      float sp = pow(max(dot(reflect(-uL, n), v), 0.0), 40.0);
      ink = vec3(0.0, 0.1 + 0.9 * f, 0.0);
      ink.g = max(ink.g - sp * 0.5, 0.0);
    `, { blend: 'max', side: THREE.DoubleSide, depthWrite: false }));
    shell.renderOrder = 2;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(GLASS.rimR, 0.007, 6, 64), sepMaterial(`ink = vec3(0.0, 1.0, 0.0);`, { blend: 'max' }));
    lip.rotation.x = Math.PI / 2; lip.position.y = GLASS.rimY; lip.renderOrder = 3;
    // the BRIM: a dashed red ring just above the rim, drawn by the proofreader
    const brim = new THREE.Mesh(new THREE.TorusGeometry(GLASS.rimR + 0.035, 0.009, 6, 96), sepMaterial(/* glsl */ `
      float a = atan(vO.y, vO.x);
      float dash = step(0.45, fract(a / 6.2831853 * 28.0));
      ink = vec3(dash, 0.0, 0.0);
      if (dash < 0.5) discard;
    `, {}));
    brim.rotation.x = Math.PI / 2; brim.position.y = GLASS.rimY; brim.renderOrder = 4;
    this.glassRoot.add(this.wine, this.wineTop, shell, lip, brim);
    this.glass.add(this.glassRoot);
  }

  /** Render the strawberry turning (angle rad). */
  renderBerry(renderer: THREE.WebGLRenderer, angle: number, tilt: number) {
    this.cam.aspect = 1; this.cam.fov = 26; this.cam.updateProjectionMatrix();
    this.berryRoot.rotation.set(0.18 + tilt, angle, -0.35);
    this.cam.position.set(0, 0.15, 3.1); this.cam.up.set(0, 1, 0); this.cam.lookAt(0, 0, 0);
    this.draw(renderer, this.berry);
  }

  /**
   * Render the glass. `elev` is the camera elevation (0 = side, PI/2 = straight down into the bowl),
   * `slosh` tilts the wine surface a little. The camera aspect matches the sheet's illustration rect.
   */
  renderGlass(renderer: THREE.WebGLRenderer, elev: number, slosh: number, aspect: number, zoom = 1) {
    this.cam.aspect = aspect; this.cam.fov = 26 / zoom; this.cam.updateProjectionMatrix();
    const target = new THREE.Vector3(0, THREE.MathUtils.lerp(0.58, GLASS.rimY - 0.1, Math.sin(elev)), 0);
    const d = 3.3;
    this.cam.position.set(0, target.y + Math.sin(elev) * d, Math.cos(elev) * d);
    this.cam.up.set(0, Math.cos(elev) > 0.05 ? 1 : 0, Math.cos(elev) > 0.05 ? 0 : -1);
    this.cam.lookAt(target);
    this.wineTop.rotation.set(-Math.PI / 2 + slosh, 0, slosh * 0.6);
    this.draw(renderer, this.glass);
  }

  /** Where an object-space point of the glass lands in the illustration (0..1, y up). */
  projectGlass(x: number, y: number, z: number): [number, number] {
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    return [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5];
  }

  private draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const prev = renderer.getClearColor(new THREE.Color()).clone(), pa = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, this.cam);
    renderer.setClearColor(prev, pa);
  }
}
