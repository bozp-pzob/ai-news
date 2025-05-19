declare module 'three' {
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): this;
  }

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }

  export class Color {
    constructor(color?: number | string);
    r: number;
    g: number;
    b: number;
    set(color: number | string): this;
    lerpColors(colorA: Color, colorB: Color, alpha: number): this;
  }

  export class Scene {
    add(object: Object3D): this;
    remove(object: Object3D): this;
    children: Object3D[];
    clear(): this;
  }

  export class WebGLRenderer {
    constructor(parameters?: any);
    setSize(width: number, height: number): void;
    render(scene: Scene, camera: Camera): void;
    dispose(): void;
    domElement: HTMLCanvasElement;
    setScissor(x: number, y: number, width: number, height: number): void;
    setScissorTest(value: boolean): void;
  }

  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    position: Vector3;
    aspect: number;
    updateProjectionMatrix(): void;
  }

  export class Camera extends Object3D {
    constructor();
  }

  export class Object3D {
    constructor();
    position: Vector3;
    rotation: {
      x: number;
      y: number;
      z: number;
    };
    isMesh?: boolean;
    geometry?: any;
    traverse(callback: (object: Object3D) => void): void;
    add(object: Object3D): this;
    children: Object3D[];
    userData: any;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: any, material?: any);
    isMesh: boolean;
    geometry: any;
    material: any;
    scale: Vector3;
    add(object: Object3D): this;
    children: Object3D[];
  }

  export class LineSegments extends Object3D {
    constructor(geometry?: any, material?: any);
    geometry: any;
    material: any;
  }

  export class BoxGeometry {
    constructor(width?: number, height?: number, depth?: number);
    computeBoundingBox(): void;
    boundingBox: {
      getCenter(target: Vector3): void;
    };
    translate(x: number, y: number, z: number): this;
    clone(): any;
  }

  export class EdgesGeometry {
    constructor(geometry?: any, thresholdAngle?: number);
  }

  export class IcosahedronGeometry {
    constructor(radius?: number, detail?: number);
  }

  export class MeshBasicMaterial {
    constructor(parameters?: any);
    color: any;
    wireframe: boolean;
    transparent: boolean;
    opacity: number;
    vertexColors: boolean;
    needsUpdate: boolean;
  }

  export class LineBasicMaterial {
    constructor(parameters?: any);
    color: any;
    transparent: boolean;
    opacity: number;
    vertexColors: boolean;
    needsUpdate: boolean;
  }

  export class Material {
    opacity?: number;
    transparent?: boolean;
  }

  export class BufferGeometry {
    constructor();
    setAttribute(name: string, attribute: BufferAttribute): this;
    computeBoundingBox(): void;
    boundingBox: {
      getCenter(target: Vector3): void;
    };
    translate(x: number, y: number, z: number): this;
    clone(): any;
    hasAttribute(name: string): boolean;
  }

  export class BufferAttribute {
    constructor(array: Float32Array | Uint16Array | Uint32Array, itemSize: number);
    count: number;
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
    setXYZ(index: number, x: number, y: number, z: number): void;
    needsUpdate: boolean;
  }

  export class Line extends Object3D {
    constructor(geometry?: BufferGeometry, material?: LineBasicMaterial);
  }

  export class Group extends Object3D {
    constructor();
    add(object: Object3D): this;
  }

  export class GridHelper extends Object3D {
    constructor(size?: number, divisions?: number, colorCenterLine?: number, colorGrid?: number);
    material: Material | Material[];
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import { Object3D, Scene } from 'three';
  
  export class GLTFLoader {
    load(
      url: string,
      onLoad?: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: any) => void
    ): void;
  }
  
  export interface GLTF {
    animations: any[];
    scene: Scene;
    scenes: Scene[];
    cameras: any[];
    asset: any;
  }
} 