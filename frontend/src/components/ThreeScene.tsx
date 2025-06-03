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

interface Settings {
  speed: number;
  length: number;
  width: number;
  maxLines: number;
  spawnRate: number;
  color: string;
}

// Define a pulse interface for a heartbeat monitor animation
interface GridPulse {
  lineIndex: number;        // Index of the current line being traveled
  progress: number;         // Position along the current line (0-1)
  isHorizontal: boolean;    // Whether the pulse is on a horizontal or vertical line
  speed: number;            // Speed of the pulse
  pulseIntensity: number;   // Intensity of the pulse effect
  tailLength: number;       // Length of the tail behind the pulse
  pulsePoints: number[];    // Heartbeat pattern points (0-1 values for pulse heights)
}

// Type definition for line userData
interface LineUserData {
  isHorizontal: boolean;
  normalizedPosition: number;
  baseOpacity: number;
  yPosition?: number;
  xPosition?: number;
}


class PulseLine {
  //@ts-ignore
  path: PathPoint[];
  traveled: number;
  speed: number;
  //@ts-ignore
  tubeMaterial: THREE.MeshBasicMaterial;
  //@ts-ignore
  glowMaterial: THREE.MeshBasicMaterial;
  //@ts-ignore
  headMaterial: THREE.MeshPhongMaterial;
  mainTube: THREE.Mesh | null;
  glowTube: THREE.Mesh | null;
  headSphere: THREE.Mesh;
  scene: THREE.Scene;
  gridSize: number;
  gridRotationX: number;
  gridY: number;
  gridZ: number;

  constructor(scene: THREE.Scene, gridSize: number, settings: Settings, gridY: number, gridZ: number, gridRotationX: number) {
    this.scene = scene;
    this.gridSize = gridSize;
    this.gridY = gridY;
    this.gridZ = gridZ;
    this.gridRotationX = gridRotationX;

    // Get a random position from one of the 10 center gridlines
    // Define the range for center gridlines (-5 to +4 indices from center)
    const centerRange = 5;
    const randomOffset = Math.floor(Math.random() * (centerRange * 2)) - centerRange;
    
    // Calculate grid step size based on gridDivisions (100)
    const gridDivisions = 50;
    const step = gridSize / gridDivisions;
    
    // Snap to exact grid line position
    const startX = randomOffset * step;
    
    // Initialize path from the selected center gridline - start at bottom of grid
    this.path = [
      { x: startX, z: gridSize/2 },
      { x: startX, z: gridSize/2 - step } // Move up exactly one grid cell
    ];
    
    this.traveled = 0;
    this.speed = settings.speed * (0.8 + Math.random() * 0.4); // Add some variation
    
    // Create materials
    this.createMaterials(settings.color);
    
    // Initialize meshes
    this.mainTube = null;
    this.glowTube = null;
    
    // Create head sphere
    const headRadius = settings.width / 400 + 0.02;
    //@ts-ignore
    const headGeometry = new THREE.SphereGeometry(headRadius, 12, 12);
    this.headSphere = new THREE.Mesh(headGeometry, this.headMaterial);
    scene.add(this.headSphere);
  }
  
  createMaterials(color: string): void {
    const colorObj = new THREE.Color(color);
    
    // Main tube material
    this.tubeMaterial = new THREE.MeshBasicMaterial({
      color: colorObj,
      transparent: true,
      opacity: 0.9,
      vertexColors: true
    });
    
    // Glow tube material
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: colorObj,
      transparent: true,
      opacity: 0.4,
      //@ts-ignore
      side: THREE.BackSide,
      vertexColors: true
    });
    
    // Head material
      //@ts-ignore
    this.headMaterial = new THREE.MeshPhongMaterial({
      color: colorObj,
      emissive: colorObj,
      emissiveIntensity: 0.8,
      transparent: true
    });
  }
  
  updateColor(color: string): void {
    const colorObj = new THREE.Color(color);
    
    this.tubeMaterial.color.set(colorObj);
    this.glowMaterial.color.set(colorObj);
    
    this.headMaterial.color.set(colorObj);
    this.headMaterial.emissive.set(colorObj);
  }
  
  // Grow the path to ensure it's long enough
  ensurePath(index: number): void {
    // Calculate grid step size based on gridDivisions (100)
    const gridDivisions = 50;
    const step = this.gridSize / gridDivisions;

    while (this.path.length <= index + 1) {
      const lastIndex = this.path.length - 1;
      const prevIndex = lastIndex - 1;
      
      // Get last direction
      const lastDir = {
        x: this.path[lastIndex].x - this.path[prevIndex].x,
        z: this.path[lastIndex].z - this.path[prevIndex].z
      };
      
      // Normalize to grid step size
      if (lastDir.x !== 0) {
        lastDir.x = Math.sign(lastDir.x) * step;
      }
      if (lastDir.z !== 0) {
        lastDir.z = Math.sign(lastDir.z) * step;
      }
      
      // Special case for top edge - force upward movement
      const topZ = -this.gridSize/2;
      
      // Check if we're approaching the top edge
      const approachingTopEdge = this.path[lastIndex].z <= topZ + this.gridSize * 0.3;
      
      // Check if we're in the center zone (10 central gridlines)
      const centerZoneWidth = 5 * step;
      const inCenterZone = Math.abs(this.path[lastIndex].x) <= centerZoneWidth;
      
      // When at or beyond the top edge, keep moving upward
      if (this.path[lastIndex].z <= topZ) {
        this.path.push({
          x: this.path[lastIndex].x, // Maintain x position
          z: this.path[lastIndex].z - step // Move up exactly one grid step
        });
        continue;
      }
      
      // Choose next direction (upward or horizontal)
      interface DirectionOption {
        x: number;
        z: number;
        weight: number;
      }
      
      const dirs: DirectionOption[] = [];
      
      // Increase chance to move upward as we get closer to the top edge
      let upwardWeight = 0.7;
      if (approachingTopEdge) {
        // Exponentially increase upward weight as we get closer to the top
        const distToTop = Math.max(0, this.path[lastIndex].z - topZ);
        const normalizedDist = distToTop / (this.gridSize * 0.3);
        upwardWeight = 0.7 + (1 - normalizedDist) * 0.3; // Increases to 1.0 at the edge
      }
      
      // Slightly increase upward probability when in center zone
      if (inCenterZone) {
        upwardWeight *= 1.1; // Moderate boost to upward movement in center zone
      }
      
      // Add upward direction with higher priority
      dirs.push({ x: 0, z: -step, weight: upwardWeight }); // Move up one grid cell
      
      // Horizontal movement weights
      let horizontalWeight = approachingTopEdge ? 0.2 : 0.3;
      
      // Adjust horizontal weights based on position relative to center zone
      if (inCenterZone) {
        // Allow some horizontal movement within center zone
        horizontalWeight *= 0.7; // Reduced but not eliminated
        
        // Add equal weights for horizontal movement within center zone - exactly one grid cell
        dirs.push({ x: step, z: 0, weight: horizontalWeight * 0.5 }); // Move right one grid cell
        dirs.push({ x: -step, z: 0, weight: horizontalWeight * 0.5 }); // Move left one grid cell
      } else {
        // Outside center zone, bias toward returning to it
        const centerDir = this.path[lastIndex].x > 0 ? -1 : 1;
        dirs.push({ 
          x: centerDir * step, 
          z: 0, 
          weight: horizontalWeight * 1.2 
        }); // Move toward center one grid cell
        
        // Add small chance to continue away from center
        dirs.push({ 
          x: -centerDir * step, 
          z: 0, 
          weight: horizontalWeight * 0.3 
        }); // Move away from center one grid cell
      }
      
      // For lines already moving horizontally, add some chance to continue
      if (Math.abs(lastDir.x) > 0 && !approachingTopEdge) {
        const continuationWeight = inCenterZone ? horizontalWeight * 0.8 : horizontalWeight * 0.6;
        dirs.push({ 
          x: Math.sign(lastDir.x) * step, 
          z: 0, 
          weight: continuationWeight 
        }); // Continue same horizontal direction one grid cell
      }
      
      // Filter valid directions (stay within grid)
      const validDirs = dirs.filter(dir => {
        const newX = this.path[lastIndex].x + dir.x;
        const newZ = this.path[lastIndex].z + dir.z;
        
        // Normal grid boundary checking
        return newX >= -this.gridSize/2 && newX <= this.gridSize/2 && 
               newZ >= -this.gridSize/2;  // Only check bottom boundary, allow going beyond top
      });
      
      // If at top edge, only allow upward direction to exit
      if (this.path[lastIndex].z === topZ || this.path[lastIndex].z < topZ) {
        // Add new point moving upward
        this.path.push({
          x: this.path[lastIndex].x,
          z: this.path[lastIndex].z - step // Move up exactly one grid cell
        });
        continue;
      }
      
      // Choose random direction
      let nextDir;
      if (validDirs.length === 0) {
        nextDir = { x: 0, z: -step, weight: 1 }; // Default to up one grid cell
      } else {
        // Weighted selection
        const totalWeight = validDirs.reduce((sum, d) => sum + d.weight, 0);
        let random = Math.random() * totalWeight;
        
        nextDir = validDirs[0]; // Default
        for (const dir of validDirs) {
          random -= dir.weight;
          if (random <= 0) {
            nextDir = dir;
            break;
          }
        }
      }
      
      // Ensure we're moving exactly on the grid lines by snapping to grid
      const nextX = Math.round((this.path[lastIndex].x + nextDir.x) / step) * step;
      const nextZ = Math.round((this.path[lastIndex].z + nextDir.z) / step) * step;
      
      // Add new point
      this.path.push({
        x: nextX,
        z: nextZ
      });
    }
  }
  
  // Get point at given distance
  getPointAt(distance: number): THREE.Vector3 {
    if (distance < 0) {
      return this.applyGridTransform(new THREE.Vector3(this.path[0].x, 0, this.path[0].z));
    }
    
    const index = Math.floor(distance);
    const fraction = distance - index;
    
    // Ensure path is long enough
    this.ensurePath(index);
    
    // Get the points to interpolate between
    const p0 = this.path[index];
    const p1 = this.path[index + 1];
    
    // Check for the grid top edge
    const topZ = -this.gridSize/2;
    
    // If we're exiting the grid (moving beyond the top edge)
    if (p0.z <= topZ || p1.z <= topZ) {
      // Create a smooth curve when exiting the grid
      const t = fraction;
      const point = new THREE.Vector3(
        p0.x + (p1.x - p0.x) * t,
        0,
        p0.z + (p1.z - p0.z) * t
      );
      
      // Add a slight curve upward as it exits
      if (p0.z <= topZ) {
        const exitProgress = Math.min(1, Math.abs(p0.z - topZ) / 5);
        point.y += exitProgress * 0.2; // Slight upward curve
      }
      
      return this.applyGridTransform(point);
    }
    
    // Linear interpolation exactly along grid lines
    const point = new THREE.Vector3(
      p0.x + (p1.x - p0.x) * fraction,
      0,
      p0.z + (p1.z - p0.z) * fraction
    );
    
    // Apply grid rotation and position to the point
    return this.applyGridTransform(point);
  }

  applyGridTransform(point: THREE.Vector3): THREE.Vector3 {
    // Create a copy of the point
    const transformed = new THREE.Vector3(point.x, point.y, point.z)
    
    // Apply rotation around X axis
    const cosTheta = Math.cos(this.gridRotationX);
    const sinTheta = Math.sin(this.gridRotationX);
    const y = transformed.y;
    const z = transformed.z;
    transformed.y = y * cosTheta - z * sinTheta;
    transformed.z = y * sinTheta + z * cosTheta;
    
    // Apply grid position offset
    transformed.y += this.gridY;
    transformed.z += this.gridZ;
    
    return transformed;
  }
  
  // Continue the path beyond the top edge for smooth exit
  findTopEdge(): number {
    const topZ = -this.gridSize/2;
    
    // Binary search for the crossing point
    let lo = 0;
    let hi = this.traveled;
    
    while (hi - lo > 0.01) {
      const mid = (lo + hi) / 2;
      const point = this.getPointAt(mid);
      
      if (point.z > topZ) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    
    // We need to continue the path a bit beyond the top edge
    const exitPoint = lo;
    
    return exitPoint;
  }
  
  // Update the pulse for this frame
  update(settings: Settings): boolean {
    this.traveled += this.speed;
    
    // Calculate head and tail positions
    const headD = this.traveled;
    const tailD = Math.max(0, headD - settings.length);
    
    const headPos = this.getPointAt(headD);
    const tailPos = this.getPointAt(tailD);
    
    // Check if completely out of bounds (tail has exited far enough)
    const topZ = -this.gridSize/2;
    const exitDistance = 5; // How far beyond the grid to continue showing the tail
    
    if (tailPos.z < topZ - exitDistance) {
      this.cleanup();
      return false;
    }
    
    // Update head position and visibility
    if (headPos.z < topZ - 1) {
      // Head has passed well beyond the top edge, gradually fade it out
      const fadeProgress = Math.min(1, Math.abs(headPos.z - topZ) / exitDistance);
      //@ts-ignore
      this.headMaterial.opacity = 1 - fadeProgress;
      //@ts-ignore
      this.headSphere.visible = this.headMaterial.opacity > 0.05;
    } else {
      //@ts-ignore
      this.headMaterial.opacity = 1;
      //@ts-ignore
      this.headSphere.visible = true;
    }
    
    this.headSphere.position.set(headPos.x, headPos.y, headPos.z);
    // Position head slightly above grid to avoid z-fighting
    this.headSphere.position.y = 0.1; 
    
    // Generate points for the tube
    const points: THREE.Vector3[] = [];
    
    // Use a fixed step size to ensure smooth curve along grid lines
    // This ensures we capture all grid points along the path
    const numSegments = Math.max(30, Math.ceil(settings.length * 2));
    const segmentLength = (headD - tailD) / numSegments;
    
    for (let i = 0; i <= numSegments; i++) {
      const d = tailD + i * segmentLength;
      const point = this.getPointAt(d);
      
      // Position the pulse slightly above the grid to avoid z-fighting
      point.y = 0.05;
      points.push(point);
    }
    
    // Need at least 2 points for tube
    if (points.length < 2) return true;
    
    // Remove old tubes
    if (this.mainTube) {
      this.scene.remove(this.mainTube);
      if (this.mainTube.geometry) this.mainTube.geometry.dispose();
    }
    
    if (this.glowTube) {
      this.scene.remove(this.glowTube);
      if (this.glowTube.geometry) this.glowTube.geometry.dispose();
    }
    
    // Create new tubes
    // Use CatmullRomCurve3 for smooth interpolation along grid points
    // @ts-ignore - Ignore for type checking as TubeGeometry structure varies between Three.js versions
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    
    // Main tube - use higher resolution for smoother look along grid lines
    const tubeRadius = settings.width / 100;
    const tubularSegments = points.length * 3; // Higher resolution
    const radialSegments = 8;
    
    // @ts-ignore - Ignore for type checking as TubeGeometry structure varies between Three.js versions
    const tubeGeometry = new THREE.TubeGeometry(
      curve, 
      tubularSegments, 
      tubeRadius, 
      radialSegments, 
      false
    );
    
    // Create vertex colors for opacity gradient
    const count = tubeGeometry.attributes.position.count;
    const colors = new Float32Array(count * 4);
    
    // Fill colors
    const color = new THREE.Color(settings.color);
    for (let i = 0; i < count; i++) {
      // Every radialSegments vertices forms a ring around the tube
      // Divide by radialSegments to get ring index, then divide by total rings
      const ringIndex = Math.floor(i / radialSegments);
      const totalRings = Math.floor(count / radialSegments);
      const progress = ringIndex / totalRings; // 0 at tail, 1 at head
      
      // Set RGB
      colors[i * 4] = color.r;
      colors[i * 4 + 1] = color.g;
      colors[i * 4 + 2] = color.b;
      
      // Set alpha - improve the fade with a smoother curve for grid line following
      colors[i * 4 + 3] = Math.pow(progress, 2);
    }
    
    // Apply colors
    tubeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    
    // Create main tube
    this.mainTube = new THREE.Mesh(tubeGeometry, this.tubeMaterial);
    this.scene.add(this.mainTube);
    
    // Create glow tube - slightly larger radius for glow effect
    // @ts-ignore - Ignore for type checking as TubeGeometry structure varies between Three.js versions
    const glowGeometry = new THREE.TubeGeometry(
      curve, 
      tubularSegments, 
      tubeRadius * 1.5, 
      radialSegments, 
      false
    );
    
    // Create vertex colors for glow opacity gradient (matching main tube but with more fade)
    const glowColors = new Float32Array(count * 4);
    
    // Fill glow colors with same progression as main tube
    for (let i = 0; i < count; i++) {
      const ringIndex = Math.floor(i / radialSegments);
      const totalRings = Math.floor(count / radialSegments);
      const progress = ringIndex / totalRings; // 0 at tail, 1 at head
      
      // Set RGB
      glowColors[i * 4] = color.r;
      glowColors[i * 4 + 1] = color.g;
      glowColors[i * 4 + 2] = color.b;
      
      // Set alpha - smoother fade for glow effect
      glowColors[i * 4 + 3] = Math.pow(progress, 2) * 0.4; // Max 0.4 opacity
    }
    
    // Apply colors to glow
    glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 4));
    
    this.glowTube = new THREE.Mesh(glowGeometry, this.glowMaterial);
    this.scene.add(this.glowTube);
    
    return true;
  }
  
  // Clean up all meshes
  cleanup(): boolean {
    if (this.mainTube) {
      this.scene.remove(this.mainTube);
      if (this.mainTube.geometry) this.mainTube.geometry.dispose();
    }
    
    if (this.glowTube) {
      this.scene.remove(this.glowTube);
      if (this.glowTube.geometry) this.glowTube.geometry.dispose();
    }
    
    if (this.headSphere) {
      this.scene.remove(this.headSphere);
      if (this.headSphere.geometry) this.headSphere.geometry.dispose();
    }
    
    return true;
  }
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ mouseX, mouseY }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<THREE.Object3D | null>(null);
  const gridLinesRef = useRef<THREE.Line[]>([]);
  const animationRef = useRef<number>(0);
  const pulseRef = useRef<GridPulse | null>(null);
  const pulseLines = useRef<PulseLine[]>([]);
  const pulseLinesRef = useRef<PulseLine[]>([]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const lastSpawnTime = useRef<number>(Date.now());
  
  // Settings for pulse lines
  const [settings] = useState({
    speed: 0.05,
    width: 50,
    length: 4,
    maxLines: 15,
    spawnRate: 15,
    color: '#fcd34d'
  });
  
  // Time tracking for pulse spawning
  const lastSpawnTimeRef = useRef<number>(Date.now());
  
  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    // Skip Three.js on low-end devices or mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(100, (window.innerWidth / 2) / window.innerHeight, 0.1, 1000);
    camera.position.set(0, -10, 200);
    // camera.position.set(0, -2000, 0);
    camera.rotation.z = Math.PI / 1
    // camera.rotation.y = -5
    // camera.rotation.x = -5
    
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      alpha: true,
      antialias: true
    });
    
    // Set renderer size to full window width
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Set the renderer's scissor to only render in the right half
    renderer.setScissor(window.innerWidth/2, 0, window.innerWidth/2, window.innerHeight);
    renderer.setScissorTest(false); // But don't enable scissor test since we want to render the grid everywhere
    
    // Add a yellow grid that spans the full screen
    const gridSize = 500; // Keep the size
    const gridDivisions = 50; // Keep the divisions
    
    const createPulse = () => {
      if (
        sceneRef.current && 
        pulseLines.current.length < settings.maxLines
      ) {
        // Create a new pulse line with the same grid parameters used in the grid creation
        pulseLines.current.push(new PulseLine(
          sceneRef.current, 
          gridSize, 
          settings, 
          customGrid.position.y, 
          customGrid.position.z, 
          customGrid.rotation.x
        ));
        
        lastSpawnTime.current = Date.now();
      }
    };

    // Create a custom grid with gradient opacity
    // Create a custom grid instead of using GridHelper for more control
    const createCustomGrid = () => {
      const gridGroup = new THREE.Group();
      const gridLines: THREE.Line[] = [];
      
      // Create horizontal lines (these will be the ones we fade)
      const horizontalLinesCount = gridDivisions + 1;
      const step = gridSize / gridDivisions;
      
      for (let i = 0; i <= gridDivisions; i++) {
        const y = (i - gridDivisions / 2) * step;
        const lineGeometry = new THREE.BufferGeometry();
        
        // Create a line from left to right
        const vertices = new Float32Array([
          -gridSize/2, 0, y,
          gridSize/2, 0, y
        ]);
        
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        // Calculate opacity based on position - top lines more transparent, bottom lines more opaque
        // Map y from -gridSize/2 to gridSize/2 to opacity values
        // Top of grid (negative y) should be very transparent
        // Bottom of grid (positive y) should be more opaque
        const normalizedY = (y + gridSize/2) / gridSize; // 0 at top, 1 at bottom
        const opacity = 0.1 + normalizedY * 0.6; // Range from 0.1 to 0.7
        
        const lineMaterial = new THREE.LineBasicMaterial({ 
          color: 0xf59e0b,
          transparent: true,
          opacity: opacity
        });
        
        const line = new THREE.Line(lineGeometry, lineMaterial);
        gridGroup.add(line);
        gridLines.push(line);
        
        // Store additional data with the line
        line.userData = {
          isHorizontal: true,
          normalizedPosition: normalizedY,
          baseOpacity: opacity,
          yPosition: y
        };
      }
      
      // Create vertical lines with uniform opacity
      for (let i = 0; i <= gridDivisions; i++) {
        const x = (i - gridDivisions / 2) * step;
        const lineGeometry = new THREE.BufferGeometry();
        
        // Create a line from top to bottom
        const vertices = new Float32Array([
          x, 0, -gridSize/2,
          x, 0, gridSize/2
        ]);
        
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        const lineMaterial = new THREE.LineBasicMaterial({ 
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.55 // Medium opacity for vertical lines
        });
        
        const line = new THREE.Line(lineGeometry, lineMaterial);
        gridGroup.add(line);
        gridLines.push(line);
        
        // Store additional data with the line
        line.userData = {
          isHorizontal: false,
          normalizedPosition: (x + gridSize/2) / gridSize,
          baseOpacity: 0.55,
          xPosition: x
        };
      }
      
      // Store reference to all grid lines
      gridLinesRef.current = gridLines;
      
      return gridGroup;
    };

    // Create and add the custom grid
    const customGrid = createCustomGrid();
    // customGrid.position.y = 275;
    // customGrid.position.z = -250; // Position it the same as before
    // customGrid.rotation.x = Math.PI / 6.5; // Same rotation as before
    customGrid.position.y = 0;
    customGrid.position.z = 0; // Position it the same as before
    customGrid.rotation.x = 0; // Same rotation as before
    // customGrid.rotation.x = Math.PI / 2; // Same rotation as before
    scene.add(customGrid);
    gridRef.current = customGrid;
    
    // Add ambient light for the pulse lines
    // @ts-ignore - THREE.AmbientLight exists but TypeScript doesn't recognize it
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    
    // Animation loop
    const animate = () => {
      // Check if we should spawn a new pulse
      const now = Date.now();
      const spawnInterval = settings.spawnRate * 100; // Fixed interval in milliseconds
      
      if (now - lastSpawnTime.current > spawnInterval && pulseLines.current.length < settings.maxLines) {
        createPulse();
        lastSpawnTime.current = now;
      }
    
      // Update all pulses
      for (let i = pulseLines.current.length - 1; i >= 0; i--) {
        if (!pulseLines.current[i].update(settings)) {
          pulseLines.current.splice(i, 1);
        }
      }
      
      // Render the scene
      renderer.render(scene, camera);
      
      // Continue animation loop
      animationRef.current = requestAnimationFrame(animate);
    };
    
    // Create initial pulse
    createPulse();

    // Start animation
    animate();
    
    // Handle window resize
    const handleResize = () => {
      if (canvasRef.current) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        
        // // Update camera position
        // camera.position.set(window.innerWidth/8, -10, 200);
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (gridRef.current) {
        scene.remove(gridRef.current);
      }
      
      // Clean up pulse lines
      pulseLinesRef.current.forEach(pulse => pulse.cleanup());
      pulseLinesRef.current = [];
      
      cancelAnimationFrame(animationRef.current);
      renderer.dispose();
    };
  }, [settings]);

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full"
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