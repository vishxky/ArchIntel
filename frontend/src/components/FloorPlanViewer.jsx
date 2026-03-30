import React, { Suspense, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, SoftShadows } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import Wall from './Wall';
import Room from './Room';

// Internal component to get access to the scene
const ExportHelper = forwardRef((props, ref) => {
  const { scene } = useThree();
  
  useImperativeHandle(ref, () => ({
    exportGLB: (filename = "archintel_model.glb") => {
      const exporter = new GLTFExporter();
      exporter.parse(
        scene,
        (gltf) => {
          const blob = new Blob([gltf], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.style.display = 'none';
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        },
        (error) => {
          console.error('GLTF Export Failed:', error);
        },
        { binary: true } // Export as GLB
      );
    }
  }));
  return null;
});

const FloorPlanViewer = forwardRef(({ parsedData, selectedWallId, onWallClick }, ref) => {
  if (!parsedData || !parsedData.walls) {
    return null;
  }

  const { walls, rooms, scale } = parsedData;
  const px_per_meter = scale.px_per_meter;

  // Compute the centroid of all wall endpoints to center the model at origin
  const offset = useMemo(() => {
    let sumX = 0, sumZ = 0, count = 0;
    for (const w of walls) {
      sumX += w.start[0] / px_per_meter + w.end[0] / px_per_meter;
      sumZ += w.start[1] / px_per_meter + w.end[1] / px_per_meter;
      count += 2;
    }
    return { x: sumX / count, z: sumZ / count };
  }, [walls, px_per_meter]);
  
  return (
    <div className="canvas-container">
      <Canvas shadows camera={{ position: [-8, 18, 18], fov: 45 }}>
        <ExportHelper ref={ref} />
        <SoftShadows size={15} samples={10} focus={0.5} />
        
        <color attach="background" args={['#0a0a0a']} />
        
        {/* Soft Studio Lighting */}
        <ambientLight intensity={0.4} color="#ffffff" />
        <directionalLight position={[10, 20, 10]} intensity={1.5} color="#ffffff" castShadow />
        <directionalLight position={[-10, 10, -10]} intensity={0.5} color="#b0d0ff" />

        <Suspense fallback={null}>
          {/* Center the model at origin */}
          <group position={[-offset.x, 0, -offset.z]}>
            {/* Draw Rooms (Floor pads) */}
            {rooms && rooms.map(room => (
              <Room key={room.id} data={room} scale={scale} />
            ))}
            
            {/* Draw Walls */}
            {walls && walls.map(wall => (
              <Wall 
                key={wall.id} 
                data={wall} 
                scale={scale} 
                isSelected={selectedWallId === wall.id}
                onClick={() => onWallClick && onWallClick(wall)}
              />
            ))}
            
            {/* Base Grid helper */}
            <Grid 
              position={[offset.x, -0.01, offset.z]}
              args={[100, 100]} 
              cellSize={1} 
              cellThickness={0.8} 
              cellColor="#111111" 
              sectionSize={5} 
              sectionThickness={1.2} 
              sectionColor="#1a1a1a" 
              fadeDistance={60} 
            />
          </group>
        </Suspense>

        <OrbitControls 
          makeDefault 
          target={[0, 1.5, 0]} 
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={5}
          maxDistance={50}
        />
      </Canvas>
    </div>
  );
});

export default FloorPlanViewer;
