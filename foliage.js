import * as THREE from 'three';

// Vertex Shader for Grass Wind
const grassVertexShader = `
    varying vec2 vUv;
    varying float vCloud;
    
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    void main() {
        vUv = uv;
        
        // Get world position of the instance
        vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
        
        // Sample noise for wind based on world X/Z
        vec2 noiseUV = worldPosition.xz * 0.05 + vec2(uTime * 0.05, uTime * 0.02);
        float noiseVal = texture2D(uNoiseTexture, noiseUV).r;
        vCloud = noiseVal;

        // Wind strength increases with height (uv.y)
        float windStrength = pow(uv.y, 2.0) * 2.0; 
        
        // Displacement
        float xDisp = sin(uTime * 1.0 + worldPosition.x) * 0.1 + (noiseVal - 0.5) * 1.5;
        float zDisp = cos(uTime * 0.8 + worldPosition.z) * 0.1 + (noiseVal - 0.5) * 1.5;
        
        vec3 finalPos = position;
        finalPos.x += xDisp * windStrength;
        finalPos.z += zDisp * windStrength;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

const grassFragmentShader = `
    varying vec2 vUv;
    varying float vCloud;
    uniform sampler2D uMap;
    uniform vec3 uColor;

    void main() {
        vec4 texColor = texture2D(uMap, vUv);
        
        if (texColor.a < 0.5) discard;
        
        // Mix color slightly based on noise (cloud shadows)
        vec3 finalColor = texColor.rgb * uColor;
        finalColor *= mix(0.7, 1.2, vCloud); // Light variation
        
        gl_FragColor = vec4(finalColor, texColor.a);
    }
`;

export function createFoliage(scene, assets, terrainMesh) {
    const instanceCount = 8000; // Adjustable for performance
    const flowerCount = 200;

    // --- Grass Geometry ---
    // Simple plane for a blade of grass
    const grassGeo = new THREE.PlaneGeometry(0.2, 1.2, 1, 4);
    grassGeo.translate(0, 0.6, 0); // Pivot at bottom

    // --- Shader Material ---
    const uniforms = {
        uTime: { value: 0 },
        uMap: { value: assets.grass },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0x88cc44) }
    };

    const grassMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader,
        fragmentShader: grassFragmentShader,
        uniforms: uniforms,
        side: THREE.DoubleSide,
        transparent: false // Alpha test used in shader
    });

    const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, instanceCount);
    grassMesh.receiveShadow = true;
    grassMesh.castShadow = true;

    // --- Flower Material ---
    const flowerUniforms = {
        uTime: { value: 0 },
        uMap: { value: assets.flower },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0xffffff) }
    };
    
    const flowerMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader, // Reuse wind logic
        fragmentShader: grassFragmentShader,
        uniforms: flowerUniforms,
        side: THREE.DoubleSide,
        transparent: false 
    });
    
    const flowerGeo = new THREE.PlaneGeometry(0.6, 0.6);
    flowerGeo.translate(0, 0.4, 0);
    const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);


    // --- Positioning Logic ---
    const dummy = new THREE.Object3D();
    const _pos = new THREE.Vector3();
    const _normal = new THREE.Vector3(0, 1, 0); // simplified
    const _yAxis = new THREE.Vector3(0, 1, 0);

    // Raycaster to find terrain height
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    // Populate Grass
    for (let i = 0; i < instanceCount; i++) {
        // Random position within radius
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 25; // 25 unit radius
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        // Find height
        raycaster.set(new THREE.Vector3(x, 20, z), down);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            dummy.position.set(x, y, z);
            
            // Random rotation
            dummy.rotation.y = Math.random() * Math.PI * 2;
            
            // Random scale
            const s = 0.8 + Math.random() * 0.5;
            dummy.scale.set(s, s, s);

            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        } else {
            // Hide if off terrain
            dummy.position.set(0, -100, 0);
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }
    }

    // Populate Flowers
    for (let i = 0; i < flowerCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 20;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        raycaster.set(new THREE.Vector3(x, 20, z), down);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            const s = 1.0 + Math.random() * 0.5;
            dummy.scale.set(s, s, s);
            
            // Billboard effect approx by just facing up slightly
            dummy.rotation.x = -Math.PI / 6; 

            dummy.updateMatrix();
            flowerMesh.setMatrixAt(i, dummy.matrix);
        } else {
             dummy.position.set(0, -100, 0);
             dummy.updateMatrix();
             flowerMesh.setMatrixAt(i, dummy.matrix);
        }
    }

    grassMesh.instanceMatrix.needsUpdate = true;
    flowerMesh.instanceMatrix.needsUpdate = true;

    scene.add(grassMesh);
    scene.add(flowerMesh);

    return {
        update: (time) => {
            uniforms.uTime.value = time;
            flowerUniforms.uTime.value = time;
        }
    };
}