import React, { useState, useRef } from 'react';
import * as THREE from 'three';

const MIN_THICKNESS = 0.12; // Clamp to 120mm minimum for visual rendering

export default function Wall({ data, scale, isSelected, onClick }) {
  const [hovered, setHovered] = useState(false);
  const meshRef = useRef();
  
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

  const HEIGHT = 3.0;
  
  const isLoadBearing = type === 'load_bearing';
  
  // Colors: Load-bearing = deep indigo, Partition = warm grey
  // Selected = bright highlight, Hovered = subtle glow
  let color = isLoadBearing ? '#303f9f' : '#78909c';
  if (isSelected) color = isLoadBearing ? '#5c6bc0' : '#b0bec5';
  if (hovered && !isSelected) color = isLoadBearing ? '#3f51b5' : '#90a4ae';

  const emissive = isSelected ? '#2a40c0' : hovered ? '#1a237e' : '#000000';
  const emissiveIntensity = isSelected ? 0.4 : hovered ? 0.15 : 0;

  // Render thickness: clamp to minimum for visibility
  const renderThickness = Math.max(thickness_m, MIN_THICKNESS);
  
  // Extend slightly for clean corners
  const cornerOverlap = isLoadBearing ? 0.06 : 0.03;
  const displayLength = length_m + cornerOverlap;

  return (
    <mesh 
      ref={meshRef}
      position={[cx, HEIGHT / 2, cz]} 
      rotation={[0, -angle, 0]}
      castShadow
      receiveShadow
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
    >
      <boxGeometry args={[displayLength, HEIGHT, renderThickness]} />
      <meshStandardMaterial 
        color={color} 
        roughness={isLoadBearing ? 0.55 : 0.75}
        metalness={isLoadBearing ? 0.2 : 0.05}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
      />
    </mesh>
  );
}
