import * as THREE from 'three';

// Helper to create tapered grass blade geometry
function createBladeGeometry() {
    // Width 0.1, Height 1.0, 4 vertical segments for bending
    const geometry = new THREE.PlaneGeometry(0.1, 1.0, 1, 4);
    geometry.translate(0, 0.5, 0); // Pivot at bottom

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const u = y / 1.0; // Normalized height
        
        // Taper Width: Convex curve for a grassy blade shape
        // At u=0 (bottom), taper=1. At u=1 (top), taper=0
        const taper = 1.0 - Math.pow(u, 1.5);
        
        let x = pos.getX(i);
        pos.setX(i, x * taper);
        
        // Add natural static curve (bend slightly forward/back)
        // Gives volume even without wind
        const curve = 0.15 * Math.pow(u, 2.0);
        pos.setZ(i, curve);
    }
    
    geometry.computeVertexNormals();
    return geometry;
}

 // Vertex Shader for Grass Wind (Procedural & Textured)
const grassVertexShader = `
    varying vec2 vUv;
    varying float vCloud;
    
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    void main() {
        vUv = uv;
        
        // World-space instance position (per blade)
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        
        // --- Large-scale noise field for soft gust zones ---
        // Slow-moving UVs for big, lazy patches of wind
        vec2 noiseUV = instancePos.xz * 0.01 + vec2(uTime * 0.015, uTime * 0.008);
        float noiseVal = texture2D(uNoiseTexture, noiseUV).r;
        vCloud = noiseVal;

        // Convert noise into "gust strength" with soft edges
        float gust = smoothstep(0.35, 0.75, noiseVal);

        // --- Time-varying wind direction (slowly drifting) ---
        float baseAngle = 1.2; // base direction in radians (roughly from left to right)
        float dirJitter = 0.4 * sin(uTime * 0.03); // very slow oscillation
        float angle = baseAngle + dirJitter;
        vec2 windDir = normalize(vec2(cos(angle), sin(angle)));

        // --- Motion layers (all low-frequency, smooth) ---

        // 1. Steady breeze: dominant, directional push
        float steadyPhase = uTime * 0.25 + (instancePos.x + instancePos.z) * 0.05;
        float steadyStrength = 0.18 + 0.04 * sin(steadyPhase);
        
        // 2. Gust modulation: gently raises/lowers the steady breeze strength
        float gustPhase = uTime * 0.12;
        float gustWave = 0.5 + 0.5 * sin(gustPhase + noiseVal * 6.2831);
        float gustStrength = mix(0.0, 0.22, gust * gustWave);

        // 3. Very subtle local variation along the field (removes uniformity without jitter)
        float fieldVariation = 0.03 * sin(uTime * 0.35 + instancePos.x * 0.15) * 
                               0.03 * cos(uTime * 0.31 + instancePos.z * 0.11);

        float totalStrength = steadyStrength + gustStrength + fieldVariation;

        // Final wind vector in XZ plane
        float windX = windDir.x * totalStrength;
        float windZ = windDir.y * totalStrength;

        // Stiffness gradient: base locked, tips fully flexible (smooth cubic)
        float stiffness = pow(uv.y, 3.0);
        
        vec3 finalPos = position;
        finalPos.x += windX * stiffness;
        finalPos.z += windZ * stiffness;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

 // Vertex Shader for Flower Head (Matches grass movement)
const flowerHeadVertexShader = `
    varying vec2 vUv;
    varying float vCloud;
    
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    void main() {
        vUv = uv;
        
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        
        // --- Shared Wind Logic (kept in sync with grassVertexShader) ---
        vec2 noiseUV = instancePos.xz * 0.01 + vec2(uTime * 0.015, uTime * 0.008);
        float noiseVal = texture2D(uNoiseTexture, noiseUV).r;
        vCloud = noiseVal;

        float gust = smoothstep(0.35, 0.75, noiseVal);

        float baseAngle = 1.2;
        float dirJitter = 0.4 * sin(uTime * 0.03);
        float angle = baseAngle + dirJitter;
        vec2 windDir = normalize(vec2(cos(angle), sin(angle)));

        float steadyPhase = uTime * 0.25 + (instancePos.x + instancePos.z) * 0.05;
        float steadyStrength = 0.18 + 0.04 * sin(steadyPhase);
        
        float gustPhase = uTime * 0.12;
        float gustWave = 0.5 + 0.5 * sin(gustPhase + noiseVal * 6.2831);
        float gustStrength = mix(0.0, 0.22, gust * gustWave);

        float fieldVariation = 0.03 * sin(uTime * 0.35 + instancePos.x * 0.15) * 
                               0.03 * cos(uTime * 0.31 + instancePos.z * 0.11);

        float totalStrength = steadyStrength + gustStrength + fieldVariation;

        float windX = windDir.x * totalStrength;
        float windZ = windDir.y * totalStrength;
        // ---------------------------------------------------------------

        // Flowers are at the very tip: they receive full deflection
        float stiffness = 1.0; 
        
        vec3 finalPos = position;
        finalPos.x += windX * stiffness;
        finalPos.z += windZ * stiffness;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

// Procedural Grass Shader (Gradient + Noise)
const grassFragmentShader = `
    varying vec2 vUv;
    varying float vCloud;
    
    uniform vec3 uColorBottom;
    uniform vec3 uColorTop;

    void main() {
        // Vertical gradient
        vec3 color = mix(uColorBottom, uColorTop, vUv.y);
        
        // Cloud shadows and variety
        float shadow = smoothstep(0.3, 0.8, vCloud);
        color *= mix(0.6, 1.1, shadow); 
        
        // Fake Ambient Occlusion at the very bottom
        color *= smoothstep(0.0, 0.15, vUv.y);

        gl_FragColor = vec4(color, 1.0);
    }
`;

const stemFragmentShader = `
    varying vec2 vUv;
    varying float vCloud;
    uniform vec3 uColor;

    void main() {
        vec3 finalColor = uColor;
        
        // Fake shading for 3D cylinder
        float light = 0.6 + 0.4 * sin(vUv.x * 6.28); 
        finalColor *= light;

        // Gradient
        finalColor *= mix(0.5, 1.0, vUv.y);
        
        // Shadows
        float shadow = smoothstep(0.3, 0.8, vCloud);
        finalColor *= mix(0.6, 1.1, shadow);
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

export function createFoliage(scene, assets, terrainMesh) {
    const instanceCount = 25000; // Increased count for lush AAA density
    const flowerCount = 200;

    // --- Grass Setup ---
    const grassGeo = createBladeGeometry();

    const uniforms = {
        uTime: { value: 0 },
        uNoiseTexture: { value: assets.noise },
        uColorBottom: { value: new THREE.Color(0x2d4c1e) }, // Dark organic green
        uColorTop: { value: new THREE.Color(0x7bb661) }     // Fresh light green
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
    const stemHeight = 1.1; 
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, stemHeight, 5);
    stemGeo.translate(0, stemHeight / 2, 0); 

    const stemUniforms = {
        uTime: { value: 0 },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0x4a6b36) } 
    };

    const stemMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader, // Compatible shared shader
        fragmentShader: stemFragmentShader,
        uniforms: stemUniforms, 
        side: THREE.DoubleSide
    });
    
    // 2. Head (Flower Sprite)
    const headGeo = new THREE.PlaneGeometry(0.4, 0.4);
    headGeo.rotateX(-Math.PI / 6); 
    headGeo.translate(0, stemHeight, 0); 

    const headUniforms = {
        uTime: { value: 0 },
        uMap: { value: assets.flower },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0xffffff) }
    };
    
    // Use grassFragmentShader for flower head but with texture support?
    // We need to re-add uMap support for the flower head specifically.
    // Let's create a specific material for flower heads that supports texture.
    const flowerHeadFragmentShader = `
        varying vec2 vUv;
        varying float vCloud;
        uniform sampler2D uMap;
        uniform vec3 uColor;
        void main() {
            vec4 texColor = texture2D(uMap, vUv);
            if (texColor.a < 0.5) discard;
            vec3 finalColor = texColor.rgb * uColor;
            finalColor *= mix(0.7, 1.2, vCloud);
            gl_FragColor = vec4(finalColor, texColor.a);
        }
    `;

    const headMat = new THREE.ShaderMaterial({
        vertexShader: flowerHeadVertexShader,
        fragmentShader: flowerHeadFragmentShader,
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
        // Distribute more densely in the center, sparse edges
        const rNorm = Math.sqrt(Math.random()); // Even distribution fix, or keep biased?
        const radius = rNorm * 28; // Slightly wider range
        
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        raycaster.set(new THREE.Vector3(x, 20, z), down);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            dummy.position.set(x, y, z);
            
            // Random rotation
            dummy.rotation.y = Math.random() * Math.PI * 2;
            
            // Random scale variation for natural look
            const h = 0.7 + Math.random() * 0.6; // Height variation
            const w = 0.8 + Math.random() * 0.4; // Width variation
            dummy.scale.set(w, h, w);
            
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        } else {
            dummy.position.set(0, -100, 0);
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }
    }

    // Populate Flowers
    for (let i = 0; i < flowerCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 22;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        raycaster.set(new THREE.Vector3(x, 20, z), down);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            
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