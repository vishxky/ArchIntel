import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, SoftShadows } from '@react-three/drei';
import Wall from './Wall';
import Room from './Room';

export default function FloorPlanViewer({ parsedData, selectedWallId, onWallClick }) {
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
        <SoftShadows size={15} samples={10} focus={0.5} />
        
        <color attach="background" args={['#0f1115']} />
        
        {/* Environmental Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight 
          castShadow 
          position={[20, 30, 10]} 
          intensity={1.5} 
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <directionalLight position={[-10, 15, -10]} intensity={0.4} color="#8facff" />

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
              args={[80, 80]} 
              cellSize={1} 
              cellThickness={1} 
              cellColor="#1c202a" 
              sectionSize={5} 
              sectionThickness={1.5} 
              sectionColor="#2a303f" 
              fadeDistance={40} 
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
}
