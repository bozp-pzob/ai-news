import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Github, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [scene, setScene] = useState<THREE.Scene | null>(null);

  const openGithub = () => {
    window.open('https://github.com/bozp-pzob/ai-news', '_blank')?.focus();
  }

  const scrollScreen = () => {
    window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
  }

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, ( window.innerWidth / 2) / window.innerHeight, 0.1, 1000);
    camera.position.set(0,-10,400);
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      alpha: true,
      antialias: true
    });
    let mesh;
    let points;
    const loader = new GLTFLoader();
    loader.load('/ai-news/mask.gltf', (gltf) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          const geometry = child.geometry.clone(); // Clone to avoid modifying the original
          geometry.computeBoundingBox(); // Compute bounding box
      
          const center = new THREE.Vector3();
          geometry.boundingBox.getCenter(center); // Get center of bounding box
          geometry.translate(-center.x, -center.y, -center.z); // Shift to origin
      
          const material = new THREE.MeshBasicMaterial({
            color: 0x6366f1,
            wireframe: true,
            transparent: false,
            opacity: 0.3
          });
          mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
        }
      })

      mesh.rotation.x -= 5.75;
      mesh.rotation.y += 6;
      animate();
    });

    renderer.setSize(window.innerWidth / 2, window.innerHeight);

    // Create abstract geometric shapes
    // const geometry = new THREE.IcosahedronGeometry(1, 0);
    // const material = new THREE.MeshBasicMaterial({
    //   color: 0x6366f1,
    //   wireframe: true,
    //   transparent: true,
    //   opacity: 0.3
    // });
    // const mesh = new THREE.Mesh(geometry, material);
    // scene.add(mesh);

    // Animation
    const animate = () => {
      requestAnimationFrame(animate);
      if ( mesh ) {
        // mesh.rotation.x += 0.0001;
        // mesh.rotation.y += 0.002;
      }
      renderer.render(scene, camera);
    };
    animate();

    setScene(scene);

    return () => {
      scene.remove(mesh);
      // geometry.dispose();
      // material.dispose();
      renderer.dispose();
    };
  }, []);

  // Handle mouse movement
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || !scene) return;
    const { left, top, width, height } = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - left) / width * 2 - 1;
    const y = ((e.clientY - top) / height) * 2 + 1;
    setMousePos({ x, y });

    if (scene.children[0]) {
      scene.children[0].rotation.x = y * 0.25;
      scene.children[0].rotation.y = x * 0.75;
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative min-h-screen overflow-hidden bg-zinc-950"
      onMouseMove={handleMouseMove}
    >
      {/* 3D Background */}
      <canvas
        ref={canvasRef}
        className="absolute left-[50vw] top-0 inset-0 h-full"
      />

      {/* Content */}
      <div className="relative grid grid-cols-1 lg:grid-cols-2 min-h-screen">
        {/* Left Section */}
        <div className="relative flex flex-col justify-center p-8 lg:p-16">
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/90 to-transparent transform -skew-x-12" />

          <div className="relative space-y-8">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="inline-block px-4 py-1 mb-4 border border-zinc-800 rounded-full">
                <span className="text-sm font-mono text-zinc-400">v1.0.0 BETA</span>
              </div>
              <h1 className="text-5xl lg:text-7xl font-bold tracking-tighter mb-4">
                <span className="block text-white">AI-News</span>
                <span className="block pb-4 text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">
                  Aggregator
                </span>
              </h1>
              <p className="text-lg text-zinc-400 max-w-md">
                Experience content aggregation reimagined through the lens of artificial intelligence.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex flex-wrap gap-4"
            >
              <Button
                onClick={scrollScreen}
                size="lg"
                className="relative group overflow-hidden bg-white text-black hover:text-white transition-colors"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative flex items-center gap-2">
                  Get Started
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>

              <Button
                onClick={openGithub}
                size="lg"
                variant="outline"
                className="relative group border-zinc-800 hover:border-zinc-700"
              >
                <Github className="w-4 h-4 mr-2" />
                <span>View Source</span>
              </Button>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="grid grid-cols-3 gap-8 pt-12 mt-12 border-t border-zinc-800/50"
            >
              {[
                // { value: "10K+", label: "Active Users" },
                // { value: "50+", label: "Data Sources" },
                // { value: "1M+", label: "Daily Updates" }
              ].map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-sm text-zinc-500">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>

        {/* Right Section - Visual Focus */}
        <div className="hidden lg:flex items-center justify-center relative">
          <motion.div
            className="absolute inset-0 bg-gradient-to-tl from-indigo-500/10 to-purple-500/10"
            style={{
              filter: "blur(100px)",
              transform: `translate(${mousePos.x * 20}px, ${mousePos.y * 20}px)`,
              transition: "transform 0.3s ease-out"
            }}
          />
        </div>
      </div>
    </div>
  );
}