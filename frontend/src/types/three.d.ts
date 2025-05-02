declare module 'three' {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
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
  }

  export class Mesh extends Object3D {
    constructor(geometry?: any, material?: any);
    isMesh: boolean;
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

  export class IcosahedronGeometry {
    constructor(radius?: number, detail?: number);
  }

  export class MeshBasicMaterial {
    constructor(parameters?: any);
    color: any;
    wireframe: boolean;
    transparent: boolean;
    opacity: number;
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