import * as THREE from 'three';

// Helper to create tapered grass blade geometry
function createBladeGeometry() {
    // Width 0.16, Height 1.15, 5 vertical segments for smoother bending
    const geometry = new THREE.PlaneGeometry(0.16, 1.15, 1, 5);
    geometry.translate(0, 0.575, 0); // Pivot at bottom

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const u = y / 1.15; // Normalized height
        
        // Taper Width: Convex curve for a grassy blade shape
        const taper = 1.0 - Math.pow(u, 2.0) * 0.5 - u * 0.5;
        
        let x = pos.getX(i);
        pos.setX(i, x * taper);
        
        // Add natural static curve (bend slightly forward/back)
        // Helps it catch light better
        const curve = 0.25 * Math.pow(u, 2.0);
        pos.setZ(i, curve);
    }
    
    geometry.computeVertexNormals();
    return geometry;
}

// Shared wind logic to ensure grass, stems, and flowers move in sync
const windShaderLogic = `
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    // Simulates a smooth, non-jittery wind field
    vec3 getWindDisplacement(vec3 position, vec3 instancePos, float stiffness) {
        
        // 1. Time-varying Direction
        // Wind slowly shifts direction (swirls) over time for natural variation
        float timeScale = uTime * 0.1;
        vec2 mainDir = normalize(vec2(cos(timeScale * 0.3), sin(timeScale * 0.2)));
        
        // 2. Multi-layered Noise Sampling
        // Layer A: Macro Gusts (Large, slow moving waves)
        vec2 uvMacro = (instancePos.xz * 0.012) - (mainDir * uTime * 0.06);
        float gust = texture2D(uNoiseTexture, uvMacro).r;
        
        // Layer B: Micro Variance (Breaks up uniformity, but keeps it smooth)
        vec2 uvMicro = (instancePos.xz * 0.04) - (mainDir * uTime * 0.1);
        float micro = texture2D(uNoiseTexture, uvMicro).r;
        
        // Combine for organic feel
        // "Remap" noise to create pauses (calm) and surges (windy)
        float combined = (gust * 0.8 + micro * 0.2);
        float windStrength = smoothstep(0.2, 0.9, combined);
        
        // Add a base breeze so nothing is ever totally frozen
        windStrength = 0.05 + windStrength * 0.8;
        
        // 3. Flow Waves
        // Adds a rhythmic "ripple" moving across the field
        float wave = sin(dot(instancePos.xz, mainDir) * 0.15 - uTime * 0.8);
        windStrength *= (0.85 + 0.15 * wave);

        // 4. Directional Swirl
        // Grass doesn't just bend straight; it swirls slightly in gusts
        float swirl = (micro - 0.5) * 0.8; 
        vec2 localDir = mainDir;
        // Rotate localDir slightly based on swirl
        float sa = sin(swirl * 0.4); 
        float ca = cos(swirl * 0.4);
        localDir = vec2(localDir.x * ca - localDir.y * sa, localDir.x * sa + localDir.y * ca);

        // 5. Calculate Final Displacement
        // Max bend amount
        float maxBend = 0.9;
        
        vec3 windVec = vec3(localDir.x, 0.0, localDir.y) * windStrength * maxBend;
        
        // Apply Stiffness
        vec3 finalDisp = windVec * stiffness;
        
        // 6. Vertical Compensation
        // Bend down as we move out (preserve length visual hack)
        float dist = length(finalDisp.xz);
        finalDisp.y = -dist * dist * 0.5; // Quadratic falloff
        
        return finalDisp;
    }
    
    float getCloudShadow(vec3 instancePos) {
        // Softer, larger cloud shadows
        vec2 uv = instancePos.xz * 0.01 + vec2(uTime * 0.02);
        float val = texture2D(uNoiseTexture, uv).r;
        return smoothstep(0.1, 0.9, val);
    }
`;

const grassVertexShader = `
    varying vec2 vUv;
    varying float vShadow;
    
    ${windShaderLogic}

    void main() {
        vUv = uv;
        
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vShadow = getCloudShadow(instancePos);
        
        // Calculate stiffness based on height (uv.y)
        // Base is rigid (0), tip is loose (1)
        float stiffness = pow(uv.y, 2.5);
        
        // Get displacement
        vec3 windOffset = getWindDisplacement(position, instancePos, stiffness);
        
        vec3 finalPos = position + windOffset;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

const flowerHeadVertexShader = `
    varying vec2 vUv;
    varying float vShadow;
    
    ${windShaderLogic}

    void main() {
        vUv = uv;
        
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vShadow = getCloudShadow(instancePos);
        
        // Flower heads are at the very top of the stem.
        // The stem bends based on height. The top of the stem has max stiffness.
        // So the head must also have max stiffness to stick to the stem tip.
        float stiffness = 1.0; 
        
        vec3 windOffset = getWindDisplacement(position, instancePos, stiffness);
        
        vec3 finalPos = position + windOffset;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

const grassFragmentShader = `
    varying vec2 vUv;
    varying float vShadow;
    
    uniform vec3 uColorBottom;
    uniform vec3 uColorTop;

    void main() {
        vec3 color = mix(uColorBottom, uColorTop, vUv.y);
        
        // Add subtle variations based on shadow
        color *= mix(0.5, 1.1, vShadow);
        
        // Fake Ambient Occlusion
        color *= smoothstep(0.0, 0.1, vUv.y);
        
        // Specular sheen for "realism"
        // Simple trick: lighter top tips
        float sheen = smoothstep(0.8, 1.0, vUv.y) * 0.2;
        color += sheen;

        gl_FragColor = vec4(color, 1.0);
    }
`;

const stemFragmentShader = `
    varying vec2 vUv;
    varying float vShadow;
    uniform vec3 uColor;

    void main() {
        vec3 finalColor = uColor;
        
        // Cylinder shading approximation
        // vUv.x wraps 0..1 around the cylinder
        float light = 0.5 + 0.5 * sin((vUv.x + 0.25) * 6.28); 
        finalColor *= 0.5 + 0.5 * light; // Soft lighting

        // Vertical gradient
        finalColor *= mix(0.6, 1.0, vUv.y);
        
        // Cloud shadow
        finalColor *= mix(0.5, 1.1, vShadow);
        
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
        // More realistic, less saturated, earthy greens
        uColorBottom: { value: new THREE.Color(0x112211) }, 
        uColorTop: { value: new THREE.Color(0x4a7a3a) }     
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
    const stemHeight = 1.2; 
    const stemGeo = new THREE.CylinderGeometry(0.015, 0.02, stemHeight, 5);
    stemGeo.translate(0, stemHeight / 2, 0); 

    const stemUniforms = {
        uTime: { value: 0 },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0x2a4a2a) } // Darker, richer stem green
    };

    const stemMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader, // Compatible shared shader (uses height based stiffness)
        fragmentShader: stemFragmentShader,
        uniforms: stemUniforms, 
        side: THREE.DoubleSide
    });
    
    // 2. Head (Flower Sprite)
    const headGeo = new THREE.PlaneGeometry(0.5, 0.5);
    // Orient to face somewhat upwards/forward
    headGeo.rotateX(-Math.PI / 8); 
    headGeo.translate(0, stemHeight, 0); // Position exactly at top of stem

    const headUniforms = {
        uTime: { value: 0 },
        uMap: { value: assets.flower },
        uNoiseTexture: { value: assets.noise },
        uColor: { value: new THREE.Color(0xffffff) }
    };
    
    const flowerHeadFragmentShader = `
        varying vec2 vUv;
        varying float vShadow;
        uniform sampler2D uMap;
        uniform vec3 uColor;
        void main() {
            vec4 texColor = texture2D(uMap, vUv);
            if (texColor.a < 0.4) discard;
            
            vec3 finalColor = texColor.rgb * uColor;
            
            // Apply cloud shadow
            finalColor *= mix(0.6, 1.1, vShadow);
            
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