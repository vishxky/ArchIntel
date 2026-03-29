import React, { useMemo } from 'react';
import * as THREE from 'three';

export default function Room({ data, scale }) {
  const { polygon, id } = data;
  const px_per_meter = scale.px_per_meter;
  
  // Create an extruded shape representing the floor inside the walls
  const geometry = useMemo(() => {
    if (!polygon || polygon.length < 3) return null;
    
    const shape = new THREE.Shape();
    // Convert px to meters
    shape.moveTo(polygon[0][0] / px_per_meter, polygon[0][1] / px_per_meter);
    
    for (let i = 1; i < polygon.length; i++) {
        shape.lineTo(polygon[i][0] / px_per_meter, polygon[i][1] / px_per_meter);
    }
    
    // Extrude slightly downwards 
    const extrudeSettings = {
        depth: 0.05, // 5cm floor thickness
        bevelEnabled: false,
    };
    
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // ExtrudeGeometry builds into Z instead of Y, so we must rotate it flat
    geom.rotateX(Math.PI / 2);
    // the floor is built top-down now, so we move it down by 0.05
    geom.translate(0, -0.05, 0); 
    
    return geom;
  }, [polygon, px_per_meter]);

  if (!geometry) return null;

  // Create subtle alternating colors based on Room ID to differentiate them naturally
  const hue = (parseInt(id.replace('R', '')) * 137.5) % 360;
  const roomColor = new THREE.Color(`hsl(${hue}, 20%, 35%)`);

  return (
    <mesh 
      geometry={geometry} 
      receiveShadow
    >
      <meshStandardMaterial 
        color={roomColor}
        transparent={true} 
        opacity={0.8}
        roughness={0.9} 
      />
    </mesh>
  );
}
