import { Node } from '../../types/nodeTypes';
import { drawGrid, drawConnection, drawNode } from '../nodeRenderer';
import { findNodeRecursive } from '../nodeHandlers';

// Improved easing function for smoother animation
export const easeOutExpo = (t: number): number => {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
};

// Utility function to animate the canvas view to center on nodes
export const animateCenterView = (
  nodes: Node[],
  connections: any[],
  canvasRef: React.RefObject<HTMLCanvasElement>,
  animationFrameRef: React.MutableRefObject<number | null>,
  isAnimatingRef: React.MutableRefObject<boolean>,
  currentScale: number,
  currentOffset: { x: number, y: number },
  setScale: (scale: number) => void,
  setOffset: (offset: { x: number, y: number }) => void,
  drawToBackBuffer: () => void,
  drawToScreen: () => void,
  hoveredPort: any,
  selectedNode: string | null
): boolean => {
  if (nodes.length === 0 || !canvasRef.current) {
    console.warn('Cannot center view: no nodes or canvas not available');
    return false;
  }

  // Calculate the bounds of all nodes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Helper function to process each node
  const processNode = (node: Node) => {
    const nodeWidth = 200;
    const nodeHeight = node.isParent ? 
      (node.expanded ? (25 + node.inputs.length * 20) : 80) : 
      (25 + Math.max(node.inputs.length, node.outputs.length) * 20);
    
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + nodeWidth);
    maxY = Math.max(maxY, node.position.y + nodeHeight);

    if (node.isParent && node.children && node.expanded) {
      node.children.forEach(processNode);
    }
  };

  nodes.forEach(processNode);

  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
    console.warn('Invalid node bounds calculated');
    return false;
  }

  // Add padding to the bounds
  const padding = 200;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  // Calculate the dimensions and center of the node bounds
  const nodeWidth = maxX - minX;
  const nodeHeight = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Get canvas dimensions
  const canvasWidth = canvasRef.current.width;
  const canvasHeight = canvasRef.current.height;

  // Calculate scale to fit nodes in view with padding
  const scaleX = canvasWidth / nodeWidth;
  const scaleY = canvasHeight / nodeHeight;
  const targetScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.9, 0.1), 2.0);

  // Calculate target offset to center the nodes
  const targetOffset = {
    x: (canvasWidth / 2) - (centerX * targetScale),
    y: (canvasHeight / 2) - (centerY * targetScale)
  };

  // Cancel any existing animation
  if (animationFrameRef.current !== null) {
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }

  // Set animation flag
  isAnimatingRef.current = true;

  // Start with current values
  const startScale = currentScale;
  const startOffset = { ...currentOffset };

  const duration = 800;
  const startTime = performance.now();

  const animateFrame = (timestamp: number) => {
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = easeOutExpo(progress);

    // Calculate current values
    const newScale = startScale + (targetScale - startScale) * easeProgress;
    const newOffset = {
      x: startOffset.x + (targetOffset.x - startOffset.x) * easeProgress,
      y: startOffset.y + (targetOffset.y - startOffset.y) * easeProgress
    };

    // Update state
    setScale(newScale);
    setOffset(newOffset);

    // Redraw
    drawToBackBuffer();
    drawToScreen();

    if (progress < 1) {
      animationFrameRef.current = requestAnimationFrame(animateFrame);
    } else {
      // Set final values exactly
      setScale(targetScale);
      setOffset(targetOffset);
      drawToBackBuffer();
      drawToScreen();
      
      // Clear animation state
      isAnimatingRef.current = false;
      animationFrameRef.current = null;
    }
  };

  // Start the animation
  animationFrameRef.current = requestAnimationFrame(animateFrame);
  return true;
}; 