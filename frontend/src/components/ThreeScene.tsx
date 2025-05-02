import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// This is a placeholder component for the three.js scene
// Since we can't directly use three.js due to Node.js version constraints,
// we'll create a component that simulates the 3D effect with CSS

interface ThreeSceneProps {
  mouseX: number;
  mouseY: number;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ mouseX, mouseY }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  
  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    // Skip Three.js on low-end devices or mobile
    const isMobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, (window.innerWidth / 2) / window.innerHeight, 0.1, 1000);
    camera.position.set(0, -10, 400);
    
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      alpha: true,
      antialias: true
    });
    
    // Set renderer size to half the window width
    renderer.setSize(window.innerWidth / 2, window.innerHeight);
    
    // Create a default mesh in case loading fails
    const createFallbackMesh = () => {
      const geometry = new THREE.IcosahedronGeometry(100, 0);
      const material = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        wireframe: true,
        transparent: true,
        opacity: 0.3
      });
      const fallbackMesh = new THREE.Mesh(geometry, material);
      scene.add(fallbackMesh);
      meshRef.current = fallbackMesh;
      return fallbackMesh;
    };
    
    // Start with fallback mesh
    let mesh = createFallbackMesh();
    
    // Try to load the GLTF model
    const loader = new GLTFLoader();
    
    // List of possible paths to try
    const possiblePaths = [
      '/ai-news/mask.gltf',
      '/mask.gltf',
      './mask.gltf',
      '../mask.gltf',
      '/public/ai-news/mask.gltf',
      'public/mask.gltf'
    ];
    
    const tryLoadModel = (paths: string[], index: number = 0) => {
      if (index >= paths.length) {
        console.warn('Failed to load model from all paths, using fallback mesh');
        return;
      }
      
      loader.load(
        paths[index],
        (gltf) => {
          // Successfully loaded the model
          let hasAddedMesh = false;
          
          // Remove the fallback mesh
          if (mesh) {
            scene.remove(mesh);
          }
          
          // Process the model - use type assertion for traverse method
          (gltf.scene as any).traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) {
              const childMesh = child as THREE.Mesh;
              if (childMesh.geometry) {
                const geometry = childMesh.geometry.clone();
                geometry.computeBoundingBox();
                
                if (geometry.boundingBox) {
                  const center = new THREE.Vector3();
                  geometry.boundingBox.getCenter(center);
                  geometry.translate(-center.x, -center.y, -center.z);
                }
                
                const material = new THREE.MeshBasicMaterial({
                  color: 0xf59e0b,
                  wireframe: true,
                  transparent: false,
                  opacity: 0.3
                });
                
                mesh = new THREE.Mesh(geometry, material);
                scene.add(mesh);
                meshRef.current = mesh;
                hasAddedMesh = true;
              }
            }
          });
          
          if (mesh && hasAddedMesh) {
            // Set initial rotation
            mesh.rotation.x -= 5.75;
            mesh.rotation.y += 6;
          } else {
            console.warn('Model did not contain any meshes, using fallback');
            mesh = createFallbackMesh();
          }
        },
        undefined,
        (error) => {
          console.warn(`Failed to load from ${paths[index]}: ${error.message}`);
          tryLoadModel(paths, index + 1);
        }
      );
    };
    
    tryLoadModel(possiblePaths);
    
    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    
    animate();
    
    // Handle window resize
    const handleResize = () => {
      if (canvasRef.current) {
        camera.aspect = (window.innerWidth / 2) / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth / 2, window.innerHeight);
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (mesh) {
        scene.remove(mesh);
      }
      renderer.dispose();
    };
  }, []);
  
  // Handle mouse movement updating rotation directly on the mesh
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.rotation.x = mouseY * 0.25 - 5.5;
      meshRef.current.rotation.y = mouseX * 0.75 + 6;
    }
  }, [mouseX, mouseY]);

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="absolute left-[50vw] top-0 h-full"
      />
      
      {/* CSS fallback effect for mobile or if Three.js fails */}
      <div className="absolute inset-0 opacity-30 lg:hidden">
        <div 
          className="absolute inset-0 opacity-30"
          style={{ 
            background: 'radial-gradient(circle at center, rgba(245, 158, 11, 0.3) 0%, rgba(120, 113, 108, 0.1) 70%)',
            filter: 'blur(40px)',
            transform: `translate(${mouseX * 10}px, ${mouseY * 10}px) scale(1.1)`,
            transition: 'transform 0.5s ease-out'
          }}
        />
      </div>
    </div>
  );
};

export default ThreeScene; 