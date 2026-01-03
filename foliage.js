import * as THREE from 'three';

// Vertex Shader for Grass Wind
const grassVertexShader = `
    varying vec2 vUv;
    varying float vCloud;
    
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    void main() {
        vUv = uv;
        
        // Use instance position for noise consistency across the geometry
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        
        // Sample noise for wind based on instance root X/Z
        vec2 noiseUV = instancePos.xz * 0.03 + vec2(uTime * 0.03, uTime * 0.01);
        float noiseVal = texture2D(uNoiseTexture, noiseUV).r;
        vCloud = noiseVal;

        // Wind strength increases with height (uv.y)
        float windStrength = pow(uv.y, 2.0) * 1.2; 
        
        // Displacement - Calmer, slower swaying
        float xDisp = sin(uTime * 0.6 + instancePos.x * 0.5) * 0.2 + (noiseVal - 0.5) * 0.8;
        float zDisp = cos(uTime * 0.4 + instancePos.z * 0.5) * 0.2 + (noiseVal - 0.5) * 0.8;
        
        vec3 finalPos = position;
        finalPos.x += xDisp * windStrength;
        finalPos.z += zDisp * windStrength;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

// Vertex Shader for Flower Head (Attached to top of stem)
const flowerHeadVertexShader = `
    varying vec2 vUv;
    varying float vCloud;
    
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    void main() {
        vUv = uv;
        
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        
        vec2 noiseUV = instancePos.xz * 0.03 + vec2(uTime * 0.03, uTime * 0.01);
        float noiseVal = texture2D(uNoiseTexture, noiseUV).r;
        vCloud = noiseVal;

        // Constant max wind strength matching the stem tip
        float windStrength = 1.2; 
        
        // Matches grass displacement for visual sync
        float xDisp = sin(uTime * 0.6 + instancePos.x * 0.5) * 0.2 + (noiseVal - 0.5) * 0.8;
        float zDisp = cos(uTime * 0.4 + instancePos.z * 0.5) * 0.2 + (noiseVal - 0.5) * 0.8;
        
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

const stemFragmentShader = `
    varying vec2 vUv;
    varying float vCloud;
    uniform vec3 uColor;

    void main() {
        vec3 finalColor = uColor;
        
        // Fake shading for 3D cylinder effect using UV wrapping
        // uV.x goes 0-1 around the cylinder
        float light = 0.8 + 0.4 * sin(vUv.x * 6.28); 
        finalColor *= light;

        // Gradient from dark bottom to lighter top
        finalColor *= mix(0.6, 1.0, vUv.y);
        
        // Cloud shadows
        finalColor *= mix(0.7, 1.2, vCloud);
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

export function createFoliage(scene, assets, terrainMesh) {
    const instanceCount = 8000;
    const flowerCount = 200;

    // --- Grass Setup ---
    const grassGeo = new THREE.PlaneGeometry(0.2, 1.2, 1, 4);
    grassGeo.translate(0, 0.6, 0);

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
        side: THREE.DoubleSide
    });

    const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, instanceCount);
    grassMesh.receiveShadow = true;
    grassMesh.castShadow = true;

    // --- Flower Setup ---
    // 1. Stem (3D Cylinder)
    const stemHeight = 1.1; // Height to reach the flower head
    // Thin cylinder stem
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, stemHeight, 5);
    stemGeo.translate(0, stemHeight / 2, 0); // Pivot at bottom

    const stemUniforms = {
        uTime: { value: 0 },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0x66aa55) } // Stems are green
    };

    const stemMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader, // Standard grass wind
        fragmentShader: stemFragmentShader,
        uniforms: stemUniforms, 
        side: THREE.DoubleSide
    });
    
    // 2. Head (Flower Sprite)
    const headGeo = new THREE.PlaneGeometry(0.4, 0.4);
    headGeo.rotateX(-Math.PI / 6); // Tilt back slightly
    // Position exactly at the top of the stem
    headGeo.translate(0, stemHeight, 0); 

    const headUniforms = {
        uTime: { value: 0 },
        uMap: { value: assets.flower },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0xffffff) }
    };

    const headMat = new THREE.ShaderMaterial({
        vertexShader: flowerHeadVertexShader, // Constant wind strength
        fragmentShader: grassFragmentShader,
        uniforms: headUniforms,
        side: THREE.DoubleSide,
        transparent: false 
    });

    const stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, flowerCount);
    stemMesh.receiveShadow = true;
    stemMesh.castShadow = true;

    const headMesh = new THREE.InstancedMesh(headGeo, headMat, flowerCount);
    headMesh.castShadow = true;

    // --- Positioning Logic ---
    const dummy = new THREE.Object3D();
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    // Populate Grass
    for (let i = 0; i < instanceCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 25;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        raycaster.set(new THREE.Vector3(x, 20, z), down);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            const s = 0.8 + Math.random() * 0.5;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        } else {
            dummy.position.set(0, -100, 0);
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }
    }

    // Populate Flowers (Stem + Head)
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
            // No rotation.x here, geometry handles it
            
            const s = 0.8 + Math.random() * 0.4;
            dummy.scale.set(s, s, s);

            dummy.updateMatrix();
            stemMesh.setMatrixAt(i, dummy.matrix);
            headMesh.setMatrixAt(i, dummy.matrix);
        } else {
             dummy.position.set(0, -100, 0);
             dummy.updateMatrix();
             stemMesh.setMatrixAt(i, dummy.matrix);
             headMesh.setMatrixAt(i, dummy.matrix);
        }
    }

    grassMesh.instanceMatrix.needsUpdate = true;
    stemMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;

    scene.add(grassMesh);
    scene.add(stemMesh);
    scene.add(headMesh);

    return {
        update: (time) => {
            uniforms.uTime.value = time;
            stemUniforms.uTime.value = time;
            headUniforms.uTime.value = time;
        }
    };
}