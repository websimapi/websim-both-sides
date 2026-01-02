import * as THREE from 'three';

export function createTerrain(scene, texture) {
    const geometry = new THREE.PlaneGeometry(60, 60, 128, 128);
    
    // Displace vertices for uneven terrain
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        // Simple procedural noise simulation
        const z = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 1.5 + 
                  Math.sin(x * 0.3 + y * 0.2) * 0.5;
        pos.setZ(i, z);
    }
    
    geometry.computeVertexNormals();
    // Rotate to be flat on ground
    geometry.rotateX(-Math.PI / 2);

    texture.repeat.set(8, 8);

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.1,
        color: 0x555555 // Darken the texture slightly
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.y = -1; // Lower slightly
    scene.add(mesh);

    return { mesh, geometry };
}