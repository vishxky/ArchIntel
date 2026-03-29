import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, SoftShadows, Sky } from '@react-three/drei';
import Wall from './Wall';
import Room from './Room';

export default function FloorPlanViewer({ parsedData }) {
  if (!parsedData || !parsedData.walls) {
    return null;
  }

  const { walls, rooms, scale } = parsedData;

  // The floor plan is parsed with (0,0) at top-left.
  // We want to center the model.
  // We can let OrbitControls handle framing or just center it.
  
  return (
    <div className="canvas-container">
      <Canvas shadows camera={{ position: [-15, 25, 25], fov: 45 }}>
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
        <directionalLight position={[-10, 15, -10]} intensity={0.5} color="#8facff" />

        <Suspense fallback={null}>
          <group position={[0, 0, 0]}>
            {/* Draw Rooms (Floor pads) */}
            {rooms && rooms.map(room => (
              <Room key={room.id} data={room} scale={scale} />
            ))}
            
            {/* Draw Walls */}
            {walls && walls.map(wall => (
              <Wall key={wall.id} data={wall} scale={scale} />
            ))}
            
            {/* Base Grid helper */}
            <Grid 
              position={[0, -0.01, 0]}
              args={[100, 100]} 
              cellSize={1} 
              cellThickness={1} 
              cellColor="#1c202a" 
              sectionSize={5} 
              sectionThickness={1.5} 
              sectionColor="#2a303f" 
              fadeDistance={50} 
            />
          </group>
        </Suspense>

        <OrbitControls 
          makeDefault 
          target={[0, 0, 0]} 
          maxPolarAngle={Math.PI / 2 - 0.05} 
        />
      </Canvas>
    </div>
  );
}
