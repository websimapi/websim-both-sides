import * as THREE from 'three';

// Helper to create tapered grass blade geometry
function createBladeGeometry() {
    // Width 0.12, Height 1.0, 5 vertical segments for smoother bending
    const geometry = new THREE.PlaneGeometry(0.12, 1.0, 1, 5);
    geometry.translate(0, 0.5, 0); // Pivot at bottom

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const u = y / 1.0; // Normalized height
        
        // Taper Width: Convex curve for a grassy blade shape
        const taper = 1.0 - Math.pow(u, 2.0) * 0.6 - u * 0.4;
        
        let x = pos.getX(i);
        pos.setX(i, x * taper);
        
        // Add natural static curve (bend slightly forward/back)
        // Helps it catch light better
        const curve = 0.2 * Math.pow(u, 2.0);
        pos.setZ(i, curve);
    }
    
    geometry.computeVertexNormals();
    return geometry;
}

// Shared wind logic to ensure grass, stems, and flowers move in sync
const windShaderLogic = `
    uniform float uTime;
    uniform sampler2D uNoiseTexture;

    vec3 getWindDisplacement(vec3 position, vec3 instancePos, float stiffness) {
        // --- Wind Settings ---
        vec2 windDir = normalize(vec2(0.6, 0.3)); // Dominant wind direction
        float windSpeed = 0.12; // Slow, realistic breeze
        float noiseScale = 0.035; // Larger scale = larger "waves"

        // --- Sampling ---
        // Scroll the noise texture along the wind direction
        vec2 uv = instancePos.xz * noiseScale - windDir * uTime * windSpeed;
        
        // Sample two noise layers for turbulence
        // Layer 1: Main waves
        float nMain = texture2D(uNoiseTexture, uv).r;
        // Layer 2: Faster, smaller ripples
        float nTurb = texture2D(uNoiseTexture, uv * 2.7 + vec2(uTime * 0.05)).r;
        
        // Combine noise: dominantly the main wave, subtly the turbulence
        float combinedNoise = nMain * 0.7 + nTurb * 0.3;
        
        // Shape the wind strength
        // "Power" function makes gusts peakier and calms flat areas
        float strength = pow(combinedNoise, 2.0) * 1.5 + 0.2; 
        
        // --- Directional Variance ---
        // Wind isn't perfectly unidirectional. It swirls.
        float localSwirl = sin(uTime * 0.2 + instancePos.x * 0.1 + instancePos.z * 0.1);
        vec2 localDir = normalize(windDir + vec2(localSwirl * 0.3, -localSwirl * 0.1));

        // --- Displacement ---
        // Apply wind strength
        vec3 windVec = vec3(localDir.x, 0.0, localDir.y) * strength;
        
        // Apply stiffness (how much this specific vertex can move)
        // Typically stiffness is based on height^2 or height^3
        vec3 disp = windVec * stiffness;
        
        // Cheap bending approximation (preserves length visually)
        // As xz movement increases, y should decrease slightly
        disp.y = -length(windVec) * 0.4 * stiffness;
        
        return disp;
    }
    
    float getCloudShadow(vec3 instancePos) {
        vec2 uv = instancePos.xz * 0.02 + vec2(uTime * 0.02);
        return smoothstep(0.3, 0.7, texture2D(uNoiseTexture, uv).r);
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
        uColorBottom: { value: new THREE.Color(0x1a331a) }, 
        uColorTop: { value: new THREE.Color(0x5a8a4a) }     
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
        uColor: { value: new THREE.Color(0x3a5a2a) } // Darker, richer stem green
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