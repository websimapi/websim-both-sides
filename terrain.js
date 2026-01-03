import * as THREE from 'three';

export function createTerrain(scene, texture, globalUniforms) {
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

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uResolution = globalUniforms.uResolution;
        shader.fragmentShader = 'uniform vec2 uResolution;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `
            #include <dithering_fragment>
            if (gl_FragCoord.x > uResolution.x * 0.5) {
                float gray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                // Dark, gloomy terrain
                gl_FragColor = vec4(vec3(gray * 0.4), gl_FragColor.a);
            }
            `
        );
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.y = -1; // Lower slightly
    scene.add(mesh);

    return { mesh, geometry };
}