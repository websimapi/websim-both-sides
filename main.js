import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain } from './terrain.js';
import { createFoliage } from './foliage.js';

// --- Configuration ---
const CONFIG = {
    bgColor: 0x87CEEB,
    fogColor: 0xcce0ff,
    fogDensity: 0.02,
    camStartPos: { x: 0, y: 3, z: 8 },
    mobile: window.innerWidth < 768
};

// --- Scene Setup ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bgColor);
scene.fog = new THREE.FogExp2(CONFIG.fogColor, CONFIG.fogDensity);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.camStartPos.x, CONFIG.camStartPos.y, CONFIG.camStartPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.enableZoom = false; // Locked for title screen feel
controls.minPolarAngle = Math.PI / 4;
controls.maxPolarAngle = Math.PI / 2 - 0.1; // Don't go below ground
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

// --- Lighting ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffdfba, 1.2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
const d = 15;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// --- Content Generation ---
const textureLoader = new THREE.TextureLoader();

// Load Assets
const assets = {
    flower: textureLoader.load('flower_sprite.png'),
    terrain: textureLoader.load('terrain_texture.png'),
    noise: textureLoader.load('wind_noise.png')
};

// Fix textures
assets.terrain.wrapS = assets.terrain.wrapT = THREE.RepeatWrapping;
assets.noise.wrapS = assets.noise.wrapT = THREE.RepeatWrapping;

// Create World
const terrain = createTerrain(scene, assets.terrain);
const foliageSystem = createFoliage(scene, assets, terrain.mesh);

// --- Animation Loop ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const time = clock.getElapsedTime();
    const delta = clock.getDelta();

    controls.update();

    // Update Foliage Uniforms (Wind)
    foliageSystem.update(time);

    renderer.render(scene, camera);
}

// --- Resize Handler ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// Start loop
animate();