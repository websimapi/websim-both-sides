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

// Improved wind logic: Smoother, less jittery, clearer direction
const windShaderLogic = `
    uniform float uTime;
    uniform sampler2D uNoiseTexture;
    uniform vec2 uWindDirection; // Controlled by JS for smooth rotation
    uniform float uWindStrength;

    vec3 getWindDisplacement(vec3 position, vec3 instancePos, float stiffness) {
        
        // 1. Create a flow coordinate
        // This moves the noise texture along the wind direction
        vec2 flowUV = (instancePos.xz * 0.03) - (uWindDirection * uTime * 0.1);
        
        // 2. Sample low-frequency noise (Gusts)
        float noise = texture2D(uNoiseTexture, flowUV).r;
        
        // 3. Smooth the noise (Remap 0..1 to softer transitions)
        // This removes the "twitchy" look of raw Perlin noise
        float gust = smoothstep(0.3, 0.8, noise);
        
        // 4. Calculate local wind intensity
        // Base breeze + Gusts
        float intensity = 0.1 + gust * 0.9;
        
        // 5. Directional Variance
        // Grass shouldn't move in lockstep. Add slight deviation based on position.
        // But keep it coherent! No random jitter.
        float localAngle = (noise - 0.5) * 0.5; // +/- 0.25 rad
        float c = cos(localAngle);
        float s = sin(localAngle);
        vec2 localDir = vec2(
            uWindDirection.x * c - uWindDirection.y * s,
            uWindDirection.x * s + uWindDirection.y * c
        );
        
        // 6. Calculate Displacement Vector
        // Max bend distance
        float maxBend = 1.2 * uWindStrength;
        
        vec3 displacement = vec3(localDir.x, 0.0, localDir.y) * intensity * maxBend;
        
        // 7. Apply Stiffness (Bend more at top)
        displacement *= stiffness;
        
        // 8. Vertical Compensation (The "Arc")
        // As grass bends over, it must lower in Y to maintain length
        float dist = length(displacement.xz);
        // Approximation of arc: y = -x^2
        displacement.y = -dist * dist * 0.4;
        
        return displacement;
    }
    
    float getCloudShadow(vec3 instancePos) {
        vec2 uv = instancePos.xz * 0.005 + (uWindDirection * uTime * 0.05);
        float val = texture2D(uNoiseTexture, uv).r;
        return smoothstep(0.2, 0.9, val);
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
        
        // Stiffness gradient: rigid at bottom, loose at top
        float stiffness = pow(uv.y, 2.0);
        
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
        
        // Flower heads are at the tip of the stem (max height)
        float stiffness = 1.0; 
        
        vec3 windOffset = getWindDisplacement(position, instancePos, stiffness);
        
        vec3 finalPos = position + windOffset;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(finalPos, 1.0);
    }
`;

// Fragments remain mostly the same, just keeping them clean
const grassFragmentShader = `
    varying vec2 vUv;
    varying float vShadow;
    
    uniform vec3 uColorBottom;
    uniform vec3 uColorTop;
    uniform vec2 uResolution;

    void main() {
        vec3 color = mix(uColorBottom, uColorTop, vUv.y);
        color *= mix(0.4, 1.1, vShadow);
        color *= smoothstep(0.0, 0.1, vUv.y); // AO
        
        // Simple specular
        float sheen = smoothstep(0.7, 1.0, vUv.y) * 0.15;
        color += sheen;

        // Split Screen Logic: Right side is gloomy
        if (gl_FragCoord.x > uResolution.x * 0.5) {
            float gray = dot(color, vec3(0.299, 0.587, 0.114));
            // Dead grass: Darker, grayer
            color = vec3(gray * 0.5); 
        }

        gl_FragColor = vec4(color, 1.0);
    }
`;

const stemFragmentShader = `
    varying vec2 vUv;
    varying float vShadow;
    uniform vec3 uColor;
    uniform vec2 uResolution;

    void main() {
        vec3 finalColor = uColor;
        
        // Simple cylindrical lighting
        float light = 0.5 + 0.5 * sin((vUv.x + 0.25) * 6.28); 
        finalColor *= 0.6 + 0.4 * light;

        finalColor *= mix(0.6, 1.0, vUv.y);
        finalColor *= mix(0.5, 1.1, vShadow);

        // Split Screen Logic
        if (gl_FragCoord.x > uResolution.x * 0.5) {
            float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
            finalColor = vec3(gray * 0.4);
        }
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

const flowerHeadFragmentShader = `
    varying vec2 vUv;
    varying float vShadow;
    uniform sampler2D uMap;
    uniform vec3 uColor;
    uniform vec2 uResolution;

    void main() {
        vec4 texColor = texture2D(uMap, vUv);
        if (texColor.a < 0.4) discard;
        
        vec3 finalColor = texColor.rgb * uColor;
        finalColor *= mix(0.6, 1.1, vShadow);

        // Split Screen Logic
        if (gl_FragCoord.x > uResolution.x * 0.5) {
            // Sin City style: Deep Red
            vec3 redColor = vec3(0.8, 0.02, 0.02);
            // Maintain texture detail via luminance
            float detail = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
            finalColor = redColor * detail * 2.0 * mix(0.6, 1.1, vShadow);
        }
        
        gl_FragColor = vec4(finalColor, texColor.a);
    }
`;

// Frustum Culling Optimization: Chunking
// We split the world into a grid. Each cell is a separate InstancedMesh.
// Three.js automatically culls meshes whose bounding spheres are off-screen.
class FoliageChunk {
    constructor(scene, grassGeo, grassMat, stemGeo, stemMat, headGeo, headMat, xOffset, zOffset, size) {
        this.items = [];
        this.flowers = [];
        this.x = xOffset;
        this.z = zOffset;
        this.size = size;
        
        this.scene = scene;
        this.grassGeo = grassGeo;
        this.grassMat = grassMat;
        this.stemGeo = stemGeo;
        this.stemMat = stemMat;
        this.headGeo = headGeo;
        this.headMat = headMat;
    }

    addGrass(matrix) {
        this.items.push(matrix);
    }

    addFlower(matrix) {
        this.flowers.push(matrix);
    }

    build() {
        if (this.items.length > 0) {
            this.grassMesh = new THREE.InstancedMesh(this.grassGeo, this.grassMat, this.items.length);
            this.grassMesh.receiveShadow = true;
            this.grassMesh.castShadow = true;
            
            for (let i = 0; i < this.items.length; i++) {
                this.grassMesh.setMatrixAt(i, this.items[i]);
            }
            this.grassMesh.instanceMatrix.needsUpdate = true;
            
            // Critical for culling: Set bounding volume correctly
            this.grassMesh.computeBoundingSphere();
            this.scene.add(this.grassMesh);
        }

        if (this.flowers.length > 0) {
            this.stemMesh = new THREE.InstancedMesh(this.stemGeo, this.stemMat, this.flowers.length);
            this.stemMesh.receiveShadow = true;
            this.stemMesh.castShadow = true;
            
            this.headMesh = new THREE.InstancedMesh(this.headGeo, this.headMat, this.flowers.length);
            this.headMesh.castShadow = true;
            // No receive shadow on billboard flowers to avoid self-shadow artifacts usually

            for (let i = 0; i < this.flowers.length; i++) {
                this.stemMesh.setMatrixAt(i, this.flowers[i]);
                this.headMesh.setMatrixAt(i, this.flowers[i]);
            }
            this.stemMesh.instanceMatrix.needsUpdate = true;
            this.headMesh.instanceMatrix.needsUpdate = true;
            
            this.stemMesh.computeBoundingSphere();
            this.headMesh.computeBoundingSphere();

            this.scene.add(this.stemMesh);
            this.scene.add(this.headMesh);
        }
    }
}

export function createFoliage(scene, assets, terrainMesh, globalUniforms) {
    const GRASS_COUNT = 35000; // Even more dense since culling is active!
    const FLOWER_COUNT = 300;
    
    // Grid settings
    const CHUNK_SIZE = 15; // 60x60 terrain -> 4x4 chunks of 15x15
    const GRID_HALF_WIDTH = 30;
    
    // Shared Materials
    const sharedUniforms = {
        uTime: { value: 0 },
        uNoiseTexture: { value: assets.noise },
        uWindDirection: { value: new THREE.Vector2(1, 0) },
        uWindStrength: { value: 1.0 },
        uColorBottom: { value: new THREE.Color(0x1a2e1a) }, 
        uColorTop: { value: new THREE.Color(0x5c8a4b) },
        uColor: { value: new THREE.Color(0x3a5a3a) }, // Stem color
        uMap: { value: assets.flower },
        uResolution: globalUniforms.uResolution
    };

    const grassGeo = createBladeGeometry();
    const grassMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader,
        fragmentShader: grassFragmentShader,
        uniforms: sharedUniforms,
        side: THREE.DoubleSide
    });

    const stemHeight = 1.3; 
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, stemHeight, 5);
    stemGeo.translate(0, stemHeight / 2, 0); 
    const stemMat = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader,
        fragmentShader: stemFragmentShader,
        uniforms: sharedUniforms,
        side: THREE.DoubleSide
    });

    const headGeo = new THREE.PlaneGeometry(0.6, 0.6);
    headGeo.rotateX(-Math.PI / 8); 
    headGeo.translate(0, stemHeight, 0); 
    const headMat = new THREE.ShaderMaterial({
        vertexShader: flowerHeadVertexShader,
        fragmentShader: flowerHeadFragmentShader,
        uniforms: sharedUniforms,
        side: THREE.DoubleSide,
        transparent: false,
        alphaTest: 0.5
    });

    // Create Chunks
    const chunks = {};
    const getChunkKey = (x, z) => `${Math.floor((x + GRID_HALF_WIDTH) / CHUNK_SIZE)}_${Math.floor((z + GRID_HALF_WIDTH) / CHUNK_SIZE)}`;
    
    // Helper to get or create chunk
    const getChunk = (x, z) => {
        const key = getChunkKey(x, z);
        if (!chunks[key]) {
            chunks[key] = new FoliageChunk(scene, grassGeo, grassMat, stemGeo, stemMat, headGeo, headMat, x, z, CHUNK_SIZE);
        }
        return chunks[key];
    };

    // Raycaster for placement
    const dummy = new THREE.Object3D();
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    // Generate Grass
    for (let i = 0; i < GRASS_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const rNorm = Math.sqrt(Math.random());
        const radius = rNorm * 29; // Stay within bounds
        
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        raycaster.set(new THREE.Vector3(x, 20, z), down);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            const h = 0.6 + Math.random() * 0.7;
            const w = 0.7 + Math.random() * 0.6;
            dummy.scale.set(w, h, w);
            dummy.updateMatrix();
            
            getChunk(x, z).addGrass(dummy.matrix.clone());
        }
    }

    // Generate Flowers
    for (let i = 0; i < FLOWER_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 24;
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

            getChunk(x, z).addFlower(dummy.matrix.clone());
        }
    }

    // Build all chunks
    Object.values(chunks).forEach(chunk => chunk.build());

    // Wind animation state
    let windAngle = 0;

    return {
        update: (time) => {
            sharedUniforms.uTime.value = time;
            
            // Smoothly rotate wind direction over time for "swirling" effect
            // But make it slow (large cycle)
            windAngle = Math.sin(time * 0.05) * 0.5 + Math.cos(time * 0.02) * 0.5; 
            
            // Convert angle to vector
            // Main direction is (1, 0) rotated by windAngle
            const dirX = Math.cos(windAngle);
            const dirZ = Math.sin(windAngle);
            
            sharedUniforms.uWindDirection.value.set(dirX, dirZ);
            
            // Modulate strength: Lulls and gusts
            // Perlin-ish smooth oscillation
            const surge = Math.sin(time * 0.3) * Math.sin(time * 0.13 + 2.0);
            sharedUniforms.uWindStrength.value = 0.5 + surge * 0.4;
        }
    };
}