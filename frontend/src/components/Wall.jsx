import React, { useMemo } from 'react';
import * as THREE from 'three';

export default function Wall({ data, scale }) {
  const { start, end, type, length_m, thickness_m } = data;
  const px_per_meter = scale.px_per_meter;
  
  // Convert pixels to meters
  const x1 = start[0] / px_per_meter;
  const z1 = start[1] / px_per_meter;
  const x2 = end[0] / px_per_meter;
  const z2 = end[1] / px_per_meter;

  // Center point of the wall
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  
  // Angle for rotation
  const dx = x2 - x1;
  const dz = z2 - z1;
  const angle = Math.atan2(dz, dx);

  const HEIGHT = 3.0; // 3 meters tall
  
  // Wall materials based on structural classification
  const isLoadBearing = type === 'load_bearing';
  const color = isLoadBearing ? '#303f9f' : '#90a4ae';
  const roughness = isLoadBearing ? 0.6 : 0.8;
  const metalness = isLoadBearing ? 0.2 : 0.1;

  // Extend the box slightly by half thickness on both ends to hide corner gaps
  const cornerOverlap = isLoadBearing ? 0.05 : 0.02; 
  const displayLength = length_m + cornerOverlap;

  return (
    <mesh 
      position={[cx, HEIGHT / 2, cz]} 
      rotation={[0, -angle, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[displayLength, HEIGHT, thickness_m]} />
      <meshStandardMaterial 
        color={color} 
        roughness={roughness}
        metalness={metalness}
      />
    </mesh>
  );
}
