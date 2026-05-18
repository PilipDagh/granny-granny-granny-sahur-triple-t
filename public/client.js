import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- GLOBAL VARIABLES ---
let scene, camera, renderer, controls, socket;
let isMultiplayer = false;
let myId = null;
let remotePlayers = {};
let itemMeshes = {};
let granny = null; 

// Physics & Collision Arrays
let collidableObjects = []; // Walls, doors, furniture
let interactableObjects = []; // Paintings, Wardrobe
let floorMeshes = []; // Floors and Ramps for smooth walking
let physicsItems = []; // Items currently falling with gravity

// Player State
let lives = 5;
let isDead = false;
let inventory = null;
let currentDay = 1;
let myCustomization = { hair: '#000000', clothes: '#2244aa', skin: '#ffccaa', pants: '#111111', shoes: '#333333' };

// NEW: Advanced Mechanics State
let isCrouching = false;
let isCrossbowLoaded = false;
let loadedArrowId = null;
let activeProjectiles = []; // Fired arrows

// Stealth, Distraction & Domain State
let isHiding = false;
window.noiseTarget = null;
window.noiseTimer = 0;
let hasDomain = false;
let domainCooldown = 0;
let domainActive = false;

// Tung Tung State
let tungTungKnockedOut = false;
let tungTungKnockoutTimer = 0;
let isKillingPlayer = false; 
let tungTungState = 'patrol'; // 'patrol', 'investigate', 'chase', 'lookAround'
let tungTungWaitTimer = 0;

// Movement & Mobile State
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isSprinting = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let mobileEnabled = false;
let lookSensitivity = 0.0005; 
let mobileMoveData = { x: 0, y: 0 };
let moveTouchId = null, lookTouchId = null, lastLookX = 0, lastLookY = 0;

// Floor Raycaster (For smooth stairs)
const floorRaycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

// --- DOM ELEMENTS ---
const uiMainMenu = document.getElementById('main-menu');
const uiSettings = document.getElementById('settings-menu');
const uiWardrobe = document.getElementById('wardrobe-menu');
const uiPause = document.getElementById('pause-menu');
const uiGame = document.getElementById('game-ui');
const uiDeath = document.getElementById('death-screen');
const uiDayText = document.getElementById('day-text');
const uiLives = document.getElementById('lives-display');
const uiInventory = document.getElementById('inventory-display');
const uiInteract = document.getElementById('interact-prompt');
const uiAmmo = document.getElementById('ammo-display'); 
const uiDomain = document.getElementById('domain-display');

// --- PROCEDURAL TEXTURE GENERATOR ---
function createWoodTexture(baseColor, lineColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = baseColor; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
    for (let i = 0; i < 100; i++) {
        ctx.beginPath(); let x = Math.random() * 512; ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (Math.random()*50 - 25), 170, x + (Math.random()*50 - 25), 340, x + (Math.random()*50 - 25), 512);
        ctx.stroke();
    }
    ctx.strokeStyle = '#110a05'; ctx.lineWidth = 4;
    for (let i = 0; i < 512; i += 64) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke(); }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

const wallTexture = createWoodTexture('#4a3525', '#2a1a10'); 
const floorTexture = createWoodTexture('#2a1c12', '#0a0502');
floorTexture.repeat.set(4, 4);

const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.9 });
const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8 });
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1.0 }); // Solid dark ceilings

// --- WEB AUDIO API: SCARY TUNG TUNG ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTungSound(distance) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (tungTungKnockedOut || domainActive) return; 
    let vol = Math.max(0, 1 - (distance / 40)); 
    if (vol <= 0) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.1); 
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15); 
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);

    if (Math.random() > 0.6) {
        const creakOsc = audioCtx.createOscillator();
        const creakGain = audioCtx.createGain();
        creakOsc.type = 'sawtooth'; creakOsc.frequency.setValueAtTime(60 + Math.random()*30, audioCtx.currentTime);
        creakOsc.frequency.linearRampToValueAtTime(30, audioCtx.currentTime + 0.6);
        creakGain.gain.setValueAtTime(vol * 0.4, audioCtx.currentTime);
        creakGain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        creakOsc.connect(creakGain); creakGain.connect(audioCtx.destination);
        creakOsc.start(); creakOsc.stop(audioCtx.currentTime + 0.6);
    }
}

setInterval(() => {
    if (granny && camera && !isDead && uiGame.classList.contains('hidden') === false) {
        const dist = granny.position.distanceTo(camera.position);
        if (dist < 40) {
            playTungSound(dist);
            setTimeout(() => playTungSound(dist), 300);
            setTimeout(() => playTungSound(dist), 600);
        }
    }
}, 2500);

// --- ENGINE INITIALIZATION ---
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.035); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 9.7, 0); 
    camera.rotation.order = 'YXZ'; 

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    const flashlight = new THREE.SpotLight(0xffffff, 1.8, 35, Math.PI / 4, 0.5, 1); 
    flashlight.position.set(0, 0, 0); flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight); camera.add(flashlight.target); scene.add(camera);

    const ambientLight = new THREE.AmbientLight(0x555555); 
    scene.add(ambientLight);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, false);
}

// --- UI & MENU LOGIC ---
document.getElementById('btn-settings').addEventListener('click', () => { uiMainMenu.classList.add('hidden'); uiSettings.classList.remove('hidden'); });
document.getElementById('btn-back-settings').addEventListener('click', () => { uiSettings.classList.add('hidden'); uiMainMenu.classList.remove('hidden'); });
document.getElementById('sensitivity').addEventListener('input', (e) => { lookSensitivity = e.target.value * 0.0001; document.getElementById('sens-val').innerText = lookSensitivity.toFixed(4); });
document.getElementById('mobile-toggle').addEventListener('change', (e) => mobileEnabled = e.target.checked);
document.getElementById('btn-save-wardrobe').addEventListener('click', () => {
    myCustomization = { hair: document.getElementById('color-hair').value, skin: document.getElementById('color-skin').value, clothes: document.getElementById('color-clothes').value, pants: document.getElementById('color-pants').value, shoes: document.getElementById('color-shoes').value };
    if (isMultiplayer && socket) socket.emit('updateCustomization', myCustomization);
    uiWardrobe.classList.add('hidden'); if (!mobileEnabled) controls.lock();
});

document.getElementById('btn-singleplayer').addEventListener('click', () => startGame(false));
document.getElementById('btn-multiplayer').addEventListener('click', () => startGame(true));

function startGame(multi) {
    isMultiplayer = multi;
    const username = document.getElementById('username-input').value || 'Guest-' + Math.floor(Math.random() * 9000);
    uiMainMenu.classList.add('hidden'); uiGame.classList.remove('hidden');
    if (audioCtx.state === 'suspended') audioCtx.resume();

    initEngine();
    setupMobileControls(); 

    if (isMultiplayer) {
        connectToServer(username); 
    } else {
        buildHouse();
        // Single player mock preset
        const mockPreset = { items: {
            'hammer': { pos: {x: 15, y: -3.5, z: -25}, visible: true },
            'pliers': { pos: {x: 12, y: 0.5, z: 5}, visible: true },
            'master_key': { pos: {x: 0, y: 8.5, z: 0}, visible: true },
            'weapons_key': { pos: {x: -3, y: 0.5, z: 8}, visible: true },
            'crossbow': { pos: {x: 22, y: 1.5, z: 8}, visible: false },
            'arrow_1': { pos: {x: 22.2, y: 1.5, z: 8}, visible: false },
            'arrow_2': { pos: {x: 22.4, y: 1.5, z: 8}, visible: false },
            'arrow_3': { pos: {x: 22.6, y: 1.5, z: 8}, visible: false },
            'gas_can': { pos: {x: 25, y: -3.5, z: -25}, visible: true },
            'car_key': { pos: {x: 5, y: 8.5, z: 5}, visible: true },
            'battery': { pos: {x: 10, y: 0.5, z: -5}, visible: true }
        }};
        buildItems(mockPreset); 
        spawnTungTung();
        if (Math.random() < 0.0067) { hasDomain = true; uiDomain.classList.remove('hidden'); }
        if (!mobileEnabled) controls.lock();
        animate(); 
    }
}

// --- UPGRADED MAP BUILDER (CEILINGS, VENTS, WEAPONS BOX) ---
function createWall(x, y, z, width, rotationY = 0, height = 4) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.5), wallMaterial);
    wall.position.set(x, y + height/2, z); 
    wall.rotation.y = rotationY;
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall); collidableObjects.push(wall);
    return wall;
}

function createFloor(x, y, z, width, depth) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMaterial);
    floor.rotation.x = -Math.PI / 2; floor.position.set(x, y, z); floor.receiveShadow = true;
    scene.add(floor); floorMeshes.push(floor); // Added to raycaster array!
    return floor;
}

function createCeiling(x, y, z, width, depth) {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2; ceiling.position.set(x, y, z);
    scene.add(ceiling);
}

function createRamp(x, y, z, width, depth, rotationX) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, depth), floorMaterial);
    ramp.position.set(x, y, z); ramp.rotation.x = rotationX;
    scene.add(ramp); floorMeshes.push(ramp); // Raycaster will smoothly walk up this!
    return ramp;
}

function createVent(x, y, z, rotationY) {
    // A vent is just a hole in the wall. We build walls AROUND the hole.
    // Hole is 1.5 wide, 1.5 high.
    const ventGroup = new THREE.Group();
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(1.25, 4, 0.5), wallMaterial); leftWall.position.set(-1.375, 2, 0);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(1.25, 4, 0.5), wallMaterial); rightWall.position.set(1.375, 2, 0);
    const topWall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.5), wallMaterial); topWall.position.set(0, 2.75, 0);
    
    ventGroup.add(leftWall, rightWall, topWall);
    ventGroup.position.set(x, y, z); ventGroup.rotation.y = rotationY;
    scene.add(ventGroup);
    
    // Add colliders individually
    const boxL = new THREE.Box3().setFromObject(leftWall); collidableObjects.push(leftWall);
    const boxR = new THREE.Box3().setFromObject(rightWall); collidableObjects.push(rightWall);
    const boxT = new THREE.Box3().setFromObject(topWall); collidableObjects.push(topWall);
}
// --- CONTINUING FROM PART 1 ---

function buildHouse() {
    collidableObjects = [];
    interactableObjects = [];
    floorMeshes = [];

    // ==========================================
    // 1. UPSTAIRS (Y = 8)
    // ==========================================
    createFloor(0, 8, 0, 40, 40);
    createCeiling(0, 12, 0, 40, 40); // Solid Roof

    // Bedroom (Spawn)
    createWall(0, 8, -5, 10); 
    createWall(-5, 8, 0, 10, Math.PI / 2); 
    createWall(5, 8, 2.5, 5, Math.PI / 2); 
    createWall(0, 8, 5, 10); 

    const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 6), new THREE.MeshStandardMaterial({color: 0x331111}));
    bed.position.set(-3, 8.4, -1); bed.name = "OBSTACLE_bed"; 
    scene.add(bed); collidableObjects.push(bed);

    const wardrobe = new THREE.Mesh(new THREE.BoxGeometry(2, 3.5, 1.5), new THREE.MeshStandardMaterial({color: 0x2a1a10}));
    wardrobe.position.set(3, 9.75, -3.5); wardrobe.name = "INTERACT_wardrobe";
    scene.add(wardrobe); collidableObjects.push(wardrobe);

    // Hallway & Vent
    createWall(10, 8, 5, 20, Math.PI / 2); 
    createWall(15, 8, -5, 10); 
    createVent(20, 8, 0, Math.PI / 2); // Vent hole you must crouch through!

    // Stairs Down to Main Floor
    createRamp(15, 4, 15, 4, 14, -Math.PI / 4.5);

    // ==========================================
    // 2. MAIN FLOOR (Y = 0)
    // ==========================================
    createFloor(0, 0, 0, 60, 60);
    createCeiling(0, 4, 0, 60, 60); // Solid ceiling between Main and Upstairs

    createWall(0, 0, 20, 20); 
    createWall(-10, 0, 12.5, 15, Math.PI / 2); 
    createWall(10, 0, 12.5, 15, Math.PI / 2); 

    // Front Door Puzzles
    const doorGroup = new THREE.Group();
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.2), new THREE.MeshStandardMaterial({color: 0x550000}));
    doorMesh.position.set(0, 1.9, 19.9); doorGroup.add(doorMesh); collidableObjects.push(doorMesh);

    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 0.3), new THREE.MeshStandardMaterial({map: wallTexture}));
    plank.position.set(0, 2, 19.7); plank.name = "OBSTACLE_barricade"; doorGroup.add(plank);
    const wires = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), new THREE.MeshStandardMaterial({color: 0x00ff00}));
    wires.position.set(1.2, 1.5, 19.7); wires.name = "OBSTACLE_circuitBox"; doorGroup.add(wires);
    const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), new THREE.MeshStandardMaterial({color: 0xaaaaaa}));
    padlock.position.set(-0.5, 1.8, 19.7); padlock.name = "OBSTACLE_mainDoor"; doorGroup.add(padlock);
    scene.add(doorGroup);

    // Weapons Room & Wall-Mounted Box
    createWall(25, 0, 5, 10, Math.PI / 2); 
    createWall(20, 0, 10, 10); 
    
    // The Wall-Mounted Weapons Case
    const weaponsCase = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.3), new THREE.MeshStandardMaterial({color: 0x222222}));
    weaponsCase.position.set(22, 1.5, 9.8); // Mounted high on the wall
    weaponsCase.name = "OBSTACLE_weaponsCase";
    scene.add(weaponsCase); collidableObjects.push(weaponsCase);

    // Garage
    createWall(-20, 0, 0, 20); 
    createWall(-10, 0, -10, 20, Math.PI/2); 
    
    const carGroup = new THREE.Group();
    const carBody = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 8), new THREE.MeshStandardMaterial({color: 0x1111aa}));
    carBody.position.set(-20, 1, -10); carGroup.add(carBody);
    const carTop = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 4), new THREE.MeshStandardMaterial({color: 0x1111aa}));
    carTop.position.set(-20, 2.2, -10); carGroup.add(carTop);
    carGroup.name = "OBSTACLE_car"; scene.add(carGroup); collidableObjects.push(carBody);

    // Stairs Down to Basement
    createRamp(15, -2, -15, 4, 12, Math.PI / 5);

    // ==========================================
    // 3. BASEMENT (Y = -4)
    // ==========================================
    createFloor(15, -4, -25, 30, 30);
    createCeiling(15, 0, -25, 30, 30); // Solid ceiling between Basement and Main
    createWall(15, -4, -40, 30); 
    createWall(0, -4, -25, 30, Math.PI/2); 
    createWall(30, -4, -25, 30, Math.PI/2); 
}

// --- TUNG TUNG SAHUR MONSTER ---
function createTungTungModel() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ map: wallTexture, color: 0x5c4033 });
    
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), bodyMat);
    body.position.y = 1.5; group.add(body);
    
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    slit.position.set(0.45, 1.5, 0); group.add(slit);
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), bodyMat);
    head.position.y = 2.7; group.add(head);
    
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat); leftEye.position.set(0.2, 2.8, 0.3);
    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat); rightEye.position.set(-0.2, 2.8, 0.3);
    const eyeLight = new THREE.PointLight(0xff0000, 1.5, 8); eyeLight.position.set(0, 2.8, 0.4);
    group.add(leftEye, rightEye, eyeLight);
    
    const armGeom = new THREE.CylinderGeometry(0.05, 0.05, 1.2);
    const leftArm = new THREE.Mesh(armGeom, bodyMat); leftArm.position.set(0.6, 1.5, 0); leftArm.rotation.z = Math.PI / 8; leftArm.name = "LeftArm";
    const rightArm = new THREE.Mesh(armGeom, bodyMat); rightArm.position.set(-0.6, 1.5, 0); rightArm.rotation.z = -Math.PI / 8; rightArm.name = "RightArm";
    group.add(leftArm, rightArm);
    
    return group;
}

function spawnTungTung() {
    granny = createTungTungModel();
    if (Math.random() > 0.5) granny.position.set(15, -4, -30); 
    else granny.position.set(15, 8, 0); 
    scene.add(granny);
}

// --- ITEM GENERATION (WITH ARROWS) ---
function createItemMesh(type) {
    const group = new THREE.Group();
    if (type === 'hammer') {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6), new THREE.MeshStandardMaterial({color: 0x8b4513}));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.15), new THREE.MeshStandardMaterial({color: 0x555555}));
        head.position.y = 0.3; group.add(handle, head);
    } else if (type === 'pliers') {
        const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), new THREE.MeshStandardMaterial({color: 0xcc0000})); h1.position.set(0.05, 0, 0); h1.rotation.z = 0.2;
        const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), new THREE.MeshStandardMaterial({color: 0xcc0000})); h2.position.set(-0.05, 0, 0); h2.rotation.z = -0.2;
        group.add(h1, h2);
    } else if (type === 'master_key') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), new THREE.MeshStandardMaterial({color: 0xffd700}));
        const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.05), new THREE.MeshStandardMaterial({color: 0xffd700})); teeth.position.set(0.1, 0.15, 0); group.add(base, teeth);
    } else if (type === 'weapons_key') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), new THREE.MeshStandardMaterial({color: 0xcccccc}));
        const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.05), new THREE.MeshStandardMaterial({color: 0xcccccc})); teeth.position.set(0.1, 0.15, 0); group.add(base, teeth);
    } else if (type === 'crossbow') {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), new THREE.MeshStandardMaterial({color: 0x3d2b22}));
        const bow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), new THREE.MeshStandardMaterial({color: 0x555555})); bow.position.set(0, 0, -0.3); group.add(stock, bow);
    } else if (type.startsWith('arrow')) {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5), new THREE.MeshStandardMaterial({color: 0x8b4513}));
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), new THREE.MeshStandardMaterial({color: 0xaaaaaa})); tip.position.y = 0.25;
        shaft.rotation.x = Math.PI/2; tip.rotation.x = Math.PI/2; group.add(shaft, tip);
    } else if (type === 'gas_can') {
        const can = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), new THREE.MeshStandardMaterial({color: 0xdd0000}));
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2), new THREE.MeshStandardMaterial({color: 0xdd0000})); spout.position.set(0.1, 0.3, 0); spout.rotation.z = -0.5; group.add(can, spout);
    } else if (type === 'battery') {
        const bat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), new THREE.MeshStandardMaterial({color: 0x111111}));
        const term1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1), new THREE.MeshStandardMaterial({color: 0xaaaaaa})); term1.position.set(0.1, 0.2, 0);
        const term2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1), new THREE.MeshStandardMaterial({color: 0xaaaaaa})); term2.position.set(-0.1, 0.2, 0); group.add(bat, term1, term2);
    } else if (type === 'car_key') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.05), new THREE.MeshStandardMaterial({color: 0x111111}));
        const metal = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2), new THREE.MeshStandardMaterial({color: 0xaaaaaa})); metal.position.y = 0.15; group.add(base, metal);
    }
    
    // Add physics properties to the group
    group.userData = { velocity: new THREE.Vector3(0,0,0), isFalling: false };
    return group;
}

function buildItems(presetData) {
    for (const [id, data] of Object.entries(presetData.items)) {
        const mesh = createItemMesh(id);
        mesh.position.set(data.pos.x, data.pos.y, data.pos.z);
        mesh.name = `ITEM_${id}`;
        mesh.visible = data.visible;
        scene.add(mesh);
        itemMeshes[id] = mesh;
    }
}

// --- INTERACTION RAYCASTER ---
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
let currentTarget = null;
let carState = { gas: false, battery: false, key: false };

function checkInteractions() {
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    currentTarget = null;
    uiInteract.innerText = isHiding ? "HIDING (Press E to exit)" : "";

    if (intersects.length > 0 && !isHiding) {
        let obj = intersects[0].object;
        while (obj.parent && obj.parent.type !== 'Scene') {
            if (obj.name.startsWith("ITEM_") || obj.name.startsWith("OBSTACLE_") || obj.name.startsWith("INTERACT_")) break;
            obj = obj.parent;
        }

        if (intersects[0].distance < 3.0) {
            if (obj.name.startsWith("ITEM_") && obj.visible) {
                const itemName = obj.name.replace("ITEM_", "");
                
                // Special logic for loading arrows
                if (itemName.startsWith("arrow") && inventory === 'crossbow') {
                    uiInteract.innerText = "Press E to Load Arrow";
                } else {
                    uiInteract.innerText = `Press E to pick up ${itemName.replace('_', ' ')}`;
                }
                currentTarget = { type: 'item', id: itemName, obj: obj };
            } 
            else if (obj.name.startsWith("INTERACT_wardrobe")) {
                uiInteract.innerText = "Press E to Customize Character";
                currentTarget = { type: 'wardrobe', obj: obj };
            }
            else if (obj.name.startsWith("OBSTACLE_") && obj.visible) {
                const obsName = obj.name.replace("OBSTACLE_", "");
                
                if (obsName === 'bed') {
                    uiInteract.innerText = "Press E to hide under bed";
                    currentTarget = { type: 'obstacle', id: obsName, obj: obj };
                    return;
                }

                if (obsName === 'car') {
                    if (inventory === 'gas_can' && !carState.gas) uiInteract.innerText = "Press E to fuel car";
                    else if (inventory === 'battery' && !carState.battery) uiInteract.innerText = "Press E to place battery";
                    else if (inventory === 'car_key' && carState.gas && carState.battery) uiInteract.innerText = "Press E to start car and ESCAPE!";
                    else uiInteract.innerText = `Car needs: ${!carState.gas?'Gas ':''}${!carState.battery?'Battery ':''}${(!carState.key && carState.gas && carState.battery)?'Key':''}`;
                    
                    if (inventory === 'gas_can' || inventory === 'battery' || inventory === 'car_key') {
                        currentTarget = { type: 'car', id: inventory, obj: obj };
                    }
                    return;
                }

                let req = "";
                if (obsName === 'barricade') req = 'hammer';
                if (obsName === 'circuitBox') req = 'pliers';
                if (obsName === 'mainDoor') req = 'master_key';
                if (obsName === 'weaponsCase') req = 'weapons_key';

                if (inventory === req) {
                    uiInteract.innerText = `Press E to use ${req.replace('_', ' ')}`;
                    currentTarget = { type: 'obstacle', id: obsName, obj: obj };
                } else {
                    uiInteract.innerText = `Requires: ${req.replace('_', ' ')}`;
                }
            }
        }
    }
}

function performInteraction() {
    if (isHiding) {
        isHiding = false; camera.position.set(-3, 9.7, 1); 
        if (isMultiplayer) socket.emit('setHiding', false);
        return;
    }

    if (!currentTarget) return;

    if (currentTarget.type === 'item') {
        // Loading an arrow into the crossbow
        if (currentTarget.id.startsWith("arrow") && inventory === 'crossbow') {
            ammo++;
            uiAmmo.innerText = `Arrows: ${ammo}`;
            if (isMultiplayer) socket.emit('itemAction', { itemId: currentTarget.id, action: 'pickup' });
            else currentTarget.obj.visible = false;
            return; // Don't drop the crossbow!
        }

        if (inventory) dropItem();
        inventory = currentTarget.id;
        uiInventory.innerText = `Holding: ${inventory.replace('_', ' ')}`;
        
        if (inventory === 'crossbow') {
            uiAmmo.classList.remove('hidden'); uiAmmo.innerText = `Arrows: ${ammo}`;
            document.getElementById('mobile-shoot').classList.remove('hidden');
        } else {
            uiAmmo.classList.add('hidden'); document.getElementById('mobile-shoot').classList.add('hidden');
        }

        if (isMultiplayer) socket.emit('itemAction', { itemId: inventory, action: 'pickup' });
        else currentTarget.obj.visible = false;
    } 
    else if (currentTarget.type === 'wardrobe') {
        uiWardrobe.classList.remove('hidden');
        if (!mobileEnabled) controls.unlock();
    }
    else if (currentTarget.type === 'car') {
        const part = currentTarget.id;
        if (part === 'gas_can') carState.gas = true;
        if (part === 'battery') carState.battery = true;
        if (part === 'car_key') carState.key = true;

        if (isMultiplayer) socket.emit('carPartAdded', part.split('_')[0]); 
        else { if (carState.gas && carState.battery && carState.key) winGame('Car'); }
        inventory = null; uiInventory.innerText = `Holding: Nothing`;
    }
    else if (currentTarget.type === 'obstacle') {
        if (currentTarget.id === 'bed') {
            isHiding = true; camera.position.set(-3, 8.2, -1); 
            if (isMultiplayer) socket.emit('setHiding', true);
            return;
        }

        if (isMultiplayer) socket.emit('puzzleSolved', { obstacleId: currentTarget.id });
        else {
            currentTarget.obj.visible = false;
            if (currentTarget.id === 'weaponsCase') {
                itemMeshes['crossbow'].visible = true;
                itemMeshes['arrow_1'].visible = true;
                itemMeshes['arrow_2'].visible = true;
                itemMeshes['arrow_3'].visible = true;
            }
            if (currentTarget.id === 'mainDoor') winGame('Front Door');
        }
        inventory = null; uiInventory.innerText = `Holding: Nothing`;
    }
}

// --- GRAVITY ITEM DROPS ---
function dropItem() {
    if (!inventory || isHiding) return;
    
    // 1. Calculate toss trajectory
    const dropPos = new THREE.Vector3();
    camera.getWorldDirection(dropPos);
    
    // Toss it slightly forward and up
    const tossVelocity = new THREE.Vector3(dropPos.x * 3, 2, dropPos.z * 3);
    
    dropPos.multiplyScalar(1.0).add(camera.position);

    const mesh = itemMeshes[inventory];
    mesh.position.copy(dropPos);
    mesh.userData.velocity = tossVelocity;
    mesh.userData.isFalling = true;
    
    if (!physicsItems.includes(mesh)) physicsItems.push(mesh);

    window.noiseTarget = dropPos.clone();
    window.noiseTimer = 8.0; 
    
    if (isMultiplayer) {
        socket.emit('itemAction', { itemId: inventory, action: 'drop', pos: dropPos });
        socket.emit('makeNoise', dropPos);
    } else {
        mesh.visible = true;
    }
    
    inventory = null; uiInventory.innerText = `Holding: Nothing`;
    uiAmmo.classList.add('hidden'); document.getElementById('mobile-shoot').classList.add('hidden');
}
// --- CONTINUING FROM PART 2 ---

// --- DOMAIN EXPANSION: INFINITE VOID ---
let domainSphere = null;
let domainParticles = null;
let domainTimer = 0;

function triggerDomainExpansion(pos) {
    if (domainActive) return;
    domainActive = true;
    domainTimer = 12.0; 
    domainCooldown = 37.0; 

    const geo = new THREE.SphereGeometry(15, 32, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    domainSphere = new THREE.Mesh(geo, mat);
    domainSphere.position.copy(pos);
    scene.add(domainSphere);

    const partGeo = new THREE.BufferGeometry();
    const partCount = 500;
    const posArray = new Float32Array(partCount * 3);
    for(let i=0; i < partCount * 3; i++) posArray[i] = (Math.random() - 0.5) * 2;
    partGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const partMat = new THREE.PointsMaterial({ color: 0x5c4033, size: 0.2 }); 
    domainParticles = new THREE.Points(partGeo, partMat);
    domainParticles.position.copy(pos);
    scene.add(domainParticles);

    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(50, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 2);
    osc.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 2);

    uiDomain.innerText = "DOMAIN EXPANSION: ACTIVE!";
    uiDomain.style.color = "#ff0000";
}

function updateDomain(delta) {
    if (domainCooldown > 0) {
        domainCooldown -= delta;
        if (!domainActive && hasDomain) {
            uiDomain.innerText = `DOMAIN COOLDOWN: ${Math.ceil(domainCooldown)}s`;
            uiDomain.style.color = "#aaaaaa";
        }
    } else if (hasDomain && !domainActive) {
        uiDomain.innerText = "DOMAIN EXPANSION: READY (Press J)";
        uiDomain.style.color = "#cc00ff";
    }

    if (domainActive) {
        domainTimer -= delta;
        if (domainParticles) {
            const positions = domainParticles.geometry.attributes.position.array;
            for(let i=0; i < positions.length; i+=3) {
                positions[i] *= 1.05; positions[i+1] *= 1.05; positions[i+2] *= 1.05;
                if (Math.abs(positions[i]) > 15) {
                    positions[i] = (Math.random() - 0.5) * 2;
                    positions[i+1] = (Math.random() - 0.5) * 2;
                    positions[i+2] = (Math.random() - 0.5) * 2;
                }
            }
            domainParticles.geometry.attributes.position.needsUpdate = true;
        }

        if (domainTimer <= 0) {
            domainActive = false;
            scene.remove(domainSphere); scene.remove(domainParticles);
            domainSphere = null; domainParticles = null;
        }
    }
}

// --- SHOOTING MECHANIC (WITH PROJECTILE PHYSICS) ---
function shootCrossbow() {
    if (inventory !== 'crossbow' || ammo <= 0 || tungTungKnockedOut || isKillingPlayer) return;

    ammo--;
    uiAmmo.innerText = `Arrows: ${ammo}`;

    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.1);

    // Spawn Arrow Projectile
    const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8), new THREE.MeshStandardMaterial({color: 0x8b4513}));
    arrow.rotation.x = Math.PI / 2;
    
    // Align arrow with camera direction
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    
    arrow.position.copy(camera.position).add(dir.clone().multiplyScalar(0.5)); // Spawn slightly in front
    arrow.lookAt(camera.position.clone().add(dir));
    
    arrow.userData = { velocity: dir.multiplyScalar(25) }; // Arrow flies at 25 units/sec
    scene.add(arrow);
    activeProjectiles.push(arrow);
}

function triggerTungTungKnockout() {
    if (!granny || tungTungKnockedOut || isKillingPlayer) return;
    tungTungKnockedOut = true;
    tungTungKnockoutTimer = 90.0; // 1 minute 30 seconds!
    granny.rotation.x = -Math.PI / 2; // Ragdoll faceplant
    
    if (granny.position.y > 4) granny.position.y = 8.5; 
    else if (granny.position.y > -2) granny.position.y = 0.5; 
    else granny.position.y = -3.5; 
}

// --- TUNG TUNG WAYPOINT AI ---
const tungTungWaypoints = [
    new THREE.Vector3(0, 8, 0), new THREE.Vector3(10, 8, 5), new THREE.Vector3(20, 8, 0), // Upstairs
    new THREE.Vector3(0, 0, 15), new THREE.Vector3(-10, 0, -5), new THREE.Vector3(20, 0, 5), // Main Floor
    new THREE.Vector3(15, -4, -30), new THREE.Vector3(5, -4, -25) // Basement
];
let currentWaypoint = tungTungWaypoints[0];

function updateTungTungAI(delta) {
    if (!granny || isDead || domainActive) return; 

    if (isKillingPlayer) {
        camera.lookAt(granny.position.x, granny.position.y + 2.7, granny.position.z);
        const leftArm = granny.getObjectByName("LeftArm");
        const rightArm = granny.getObjectByName("RightArm");
        if (leftArm && leftArm.rotation.x > -Math.PI/2) leftArm.rotation.x -= delta * 5;
        if (rightArm && rightArm.rotation.x > -Math.PI/2) rightArm.rotation.x -= delta * 5;
        return;
    }

    if (tungTungKnockedOut) {
        tungTungKnockoutTimer -= delta;
        if (tungTungKnockoutTimer <= 0) {
            // WAKE UP and respawn in basement
            tungTungKnockedOut = false;
            granny.rotation.x = 0; 
            granny.position.set(15, -4, -30);
            tungTungState = 'patrol';
        }
        return;
    }

    let targetPos = null;
    let minDistance = Infinity;
    let playerSpotted = false;

    // 1. Check for Players (Agro System)
    if (isMultiplayer) {
        for (const [id, pMesh] of Object.entries(remotePlayers)) {
            if (pMesh.userData.isHiding) continue; 
            const dist = granny.position.distanceTo(pMesh.position);
            if (dist < 15) { minDistance = dist; targetPos = pMesh.position; playerSpotted = true; }
        }
    }
    if (!isHiding) {
        const dist = granny.position.distanceTo(camera.position);
        if (dist < 15) { minDistance = dist; targetPos = camera.position; playerSpotted = true; }
    }

    // State Machine
    if (playerSpotted) {
        tungTungState = 'chase';
    } else if (window.noiseTarget && window.noiseTimer > 0) {
        tungTungState = 'investigate';
        targetPos = window.noiseTarget;
        window.noiseTimer -= delta;
        if (granny.position.distanceTo(window.noiseTarget) < 1.5) window.noiseTarget = null;
    } else {
        if (tungTungState === 'chase' || tungTungState === 'investigate') {
            tungTungState = 'lookAround';
            tungTungWaitTimer = 3.0; // Look around for 3 seconds after losing target
        }
    }

    if (tungTungState === 'lookAround') {
        tungTungWaitTimer -= delta;
        granny.rotation.y += delta; // Spin slowly to look around
        if (tungTungWaitTimer <= 0) {
            tungTungState = 'patrol';
            currentWaypoint = tungTungWaypoints[Math.floor(Math.random() * tungTungWaypoints.length)];
        }
        return; // Don't move while looking around
    }

    if (tungTungState === 'patrol') {
        targetPos = currentWaypoint;
        if (granny.position.distanceTo(targetPos) < 2.0) {
            tungTungState = 'lookAround';
            tungTungWaitTimer = 2.0; // Pause at waypoint
        }
    }

    // Move Tung Tung
    if (targetPos) {
        // Floor Raycaster for Tung Tung (Smooth stairs)
        const rayOrigin = new THREE.Vector3(granny.position.x, granny.position.y + 2, granny.position.z);
        floorRaycaster.set(rayOrigin, downVector);
        const floorIntersects = floorRaycaster.intersectObjects(floorMeshes);
        
        if (floorIntersects.length > 0) {
            const targetY = floorIntersects[0].point.y;
            granny.position.y += (targetY - granny.position.y) * 10 * delta; // Smooth Y adjustment
        }

        const lookTarget = new THREE.Vector3(targetPos.x, granny.position.y, targetPos.z);
        granny.lookAt(lookTarget);
        
        const speed = (tungTungState === 'chase') ? (isMultiplayer ? 4.0 : 3.5) : 2.0; // Faster when chasing
        granny.translateZ(speed * delta);

        if (tungTungState === 'chase' && targetPos === camera.position && minDistance < 1.5 && !isHiding) {
            startKillAnimation();
        }
    }
}

function startKillAnimation() {
    isKillingPlayer = true;
    moveForward = false; moveBackward = false; moveLeft = false; moveRight = false;
    if (!mobileEnabled) controls.unlock();
    
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 1);
    osc.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 1.5);

    setTimeout(triggerDeath, 1500); 
}

// --- INPUT LISTENERS (ADDED CROUCH & SHOOT) ---
window.addEventListener('keydown', (e) => {
    if (isDead || isKillingPlayer) return;
    if (e.code === 'KeyE') performInteraction();
    if (e.code === 'KeyQ') dropItem();
    if (e.code === 'KeyC') isCrouching = !isCrouching; // CROUCH TOGGLE
    if (e.code === 'KeyF') shootCrossbow(); // SHOOT
    if (e.code === 'KeyJ' && hasDomain && domainCooldown <= 0 && !domainActive) {
        triggerDomainExpansion(camera.position);
        if (isMultiplayer) socket.emit('activateDomain', camera.position);
    }
    switch (e.code) {
        case 'ArrowUp': case 'KeyW': moveForward = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward = true; break;
        case 'ArrowRight': case 'KeyD': moveRight = true; break;
        case 'ShiftLeft': case 'ShiftRight': isSprinting = true; break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'ArrowUp': case 'KeyW': moveForward = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward = false; break;
        case 'ArrowRight': case 'KeyD': moveRight = false; break;
        case 'ShiftLeft': case 'ShiftRight': isSprinting = false; break;
    }
});

window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && document.pointerLockElement === document.body) shootCrossbow();
});

function setupMobileControls() {
    if (!mobileEnabled) return;
    
    document.getElementById('joystick-move').classList.remove('hidden');
    document.getElementById('joystick-look').classList.remove('hidden');
    document.getElementById('mobile-interact').classList.remove('hidden');
    document.getElementById('mobile-drop').classList.remove('hidden');
    document.getElementById('mobile-crouch').classList.remove('hidden');

    document.getElementById('mobile-interact').addEventListener('touchstart', performInteraction);
    document.getElementById('mobile-drop').addEventListener('touchstart', dropItem);
    document.getElementById('mobile-shoot').addEventListener('touchstart', shootCrossbow); 
    document.getElementById('mobile-crouch').addEventListener('touchstart', () => isCrouching = !isCrouching); 

    const moveZone = document.getElementById('joystick-move');
    const lookZone = document.getElementById('joystick-look');

    moveZone.addEventListener('touchstart', (e) => { e.preventDefault(); moveTouchId = e.changedTouches[0].identifier; }, { passive: false });
    moveZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i=0; i<e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === moveTouchId) {
                const rect = moveZone.getBoundingClientRect();
                mobileMoveData.x = Math.max(-1, Math.min(1, (e.changedTouches[i].clientX - (rect.left + rect.width/2)) / 40));
                mobileMoveData.y = Math.max(-1, Math.min(1, (e.changedTouches[i].clientY - (rect.top + rect.height/2)) / 40));
            }
        }
    }, { passive: false });
    moveZone.addEventListener('touchend', (e) => { for (let i=0; i<e.changedTouches.length; i++) { if (e.changedTouches[i].identifier === moveTouchId) { moveTouchId = null; mobileMoveData = {x:0, y:0}; } } });

    lookZone.addEventListener('touchstart', (e) => { e.preventDefault(); lookTouchId = e.changedTouches[0].identifier; lastLookX = e.changedTouches[0].clientX; lastLookY = e.changedTouches[0].clientY; }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i=0; i<e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === lookTouchId) {
                camera.rotation.y -= (e.changedTouches[i].clientX - lastLookX) * lookSensitivity * 10;
                camera.rotation.x -= (e.changedTouches[i].clientY - lastLookY) * lookSensitivity * 10;
                camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
                lastLookX = e.changedTouches[i].clientX; lastLookY = e.changedTouches[i].clientY;
            }
        }
    }, { passive: false });
    lookZone.addEventListener('touchend', (e) => { for (let i=0; i<e.changedTouches.length; i++) { if (e.changedTouches[i].identifier === lookTouchId) lookTouchId = null; } });
}
// --- CONTINUING FROM PART 3 ---

// --- DEATH & RESPAWN ---
function triggerDeath() {
    if (isDead) return;
    isDead = true; isKillingPlayer = false; lives--; currentDay++;
    if (isMultiplayer) socket.emit('playerDied');

    uiGame.classList.add('hidden');
    uiDeath.classList.remove('hidden');
    
    if (lives > 0) {
        uiDayText.innerText = `DAY ${currentDay}`;
        setTimeout(respawnPlayer, 3000);
    } else {
        uiDayText.innerText = "GAME OVER";
        uiDayText.style.color = "#ff0000";
        if (!isMultiplayer) setTimeout(() => location.reload(), 3000);
    }
}

function respawnPlayer() {
    isDead = false; isHiding = false; isCrouching = false;
    uiDeath.classList.add('hidden');
    uiGame.classList.remove('hidden');
    uiLives.innerText = `Lives: ${lives}`;
    camera.position.set(0, 9.7, 0); // Respawn UPSTAIRS
    camera.rotation.set(0, 0, 0);
    
    if (granny && !isMultiplayer) {
        granny.position.set(15, -4, -30); // Reset Tung Tung to basement
        tungTungKnockedOut = false;
        tungTungState = 'patrol';
        granny.rotation.x = 0;
        const leftArm = granny.getObjectByName("LeftArm");
        const rightArm = granny.getObjectByName("RightArm");
        if (leftArm) leftArm.rotation.x = Math.PI / 8;
        if (rightArm) rightArm.rotation.x = -Math.PI / 8;
    }
    if (!mobileEnabled) controls.lock();
}

function winGame(type) {
    alert(`ESCAPE SUCCESSFUL! You escaped via the ${type}!`);
    location.reload();
}

// --- MAIN ANIMATION LOOP (PHYSICS & RAYCASTING) ---
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    updateDomain(delta);

    if (!isDead && !isKillingPlayer && (controls.isLocked || mobileEnabled)) {
        checkInteractions();

        if (!isHiding && !domainActive) {
            const oldPosition = camera.position.clone();

            // 1. Player Movement Physics
            velocity.x -= velocity.x * 10.0 * delta;
            velocity.z -= velocity.z * 10.0 * delta;

            direction.z = Number(moveForward) - Number(moveBackward);
            direction.x = Number(moveRight) - Number(moveLeft);
            direction.normalize();

            if (mobileEnabled) { direction.x += mobileMoveData.x; direction.z -= mobileMoveData.y; }

            // Slower if crouching
            const currentSpeed = isCrouching ? 15.0 : (isSprinting ? 50.0 : 25.0); 
            if (moveForward || moveBackward || mobileMoveData.y !== 0) velocity.z -= direction.z * currentSpeed * delta;
            if (moveLeft || moveRight || mobileMoveData.x !== 0) velocity.x -= direction.x * currentSpeed * delta;

            controls.moveRight(-velocity.x * delta);
            controls.moveForward(-velocity.z * delta);

            // 2. Wall Collisions
            const playerHeight = isCrouching ? 0.8 : 1.5;
            const playerBox = new THREE.Box3().setFromCenterAndSize(
                new THREE.Vector3(camera.position.x, camera.position.y - (playerHeight/2), camera.position.z), 
                new THREE.Vector3(0.6, playerHeight, 0.6)
            );
            
            let hitWall = false;
            for (let i = 0; i < collidableObjects.length; i++) {
                const wallBox = new THREE.Box3().setFromObject(collidableObjects[i]);
                if (playerBox.intersectsBox(wallBox)) { hitWall = true; break; }
            }
            if (hitWall) {
                camera.position.copy(oldPosition);
                velocity.x = 0; velocity.z = 0;
            }

            // 3. Floor Raycaster (Smooth Stairs & Ramps)
            const rayOrigin = new THREE.Vector3(camera.position.x, camera.position.y + 2, camera.position.z);
            floorRaycaster.set(rayOrigin, downVector);
            const floorIntersects = floorRaycaster.intersectObjects(floorMeshes);
            
            if (floorIntersects.length > 0) {
                // Target height depends on if we are crouching (0.8) or standing (1.7)
                const targetHeight = floorIntersects[0].point.y + (isCrouching ? 0.8 : 1.7);
                camera.position.y += (targetHeight - camera.position.y) * 15 * delta; // Smooth interpolation
            }
        }

        // 4. Gravity Item Drops Physics
        for (let i = physicsItems.length - 1; i >= 0; i--) {
            const item = physicsItems[i];
            if (item.userData.isFalling) {
                item.userData.velocity.y -= 9.8 * delta; // Gravity
                item.position.add(item.userData.velocity.clone().multiplyScalar(delta));
                
                // Check if it hit the floor
                floorRaycaster.set(new THREE.Vector3(item.position.x, item.position.y + 1, item.position.z), downVector);
                const floorHits = floorRaycaster.intersectObjects(floorMeshes);
                
                if (floorHits.length > 0 && item.position.y <= floorHits[0].point.y + 0.2) {
                    item.position.y = floorHits[0].point.y + 0.2;
                    item.userData.isFalling = false;
                    physicsItems.splice(i, 1); // Remove from physics array
                }
            }
        }

        // 5. Arrow Projectile Physics
        for (let i = activeProjectiles.length - 1; i >= 0; i--) {
            const arrow = activeProjectiles[i];
            arrow.position.add(arrow.userData.velocity.clone().multiplyScalar(delta));
            
            // Check Arrow Collisions
            const arrowBox = new THREE.Box3().setFromObject(arrow);
            let hitSomething = false;

            // Hit Tung Tung?
            if (granny && !tungTungKnockedOut) {
                const grannyBox = new THREE.Box3().setFromObject(granny);
                if (arrowBox.intersectsBox(grannyBox)) {
                    triggerTungTungKnockout();
                    if (isMultiplayer) socket.emit('shootTungTung');
                    hitSomething = true;
                }
            }

            // Hit Wall?
            if (!hitSomething) {
                for (let w = 0; w < collidableObjects.length; w++) {
                    const wallBox = new THREE.Box3().setFromObject(collidableObjects[w]);
                    if (arrowBox.intersectsBox(wallBox)) { hitSomething = true; break; }
                }
            }

            if (hitSomething) {
                scene.remove(arrow);
                activeProjectiles.splice(i, 1);
            }
        }

        updateTungTungAI(delta);

        if (isMultiplayer && socket && socket.connected) {
            socket.emit('move', { pos: camera.position, rot: camera.rotation.y, isCrouching: isCrouching });
        }
    }

    renderer.render(scene, camera);
}

// --- MULTIPLAYER SYNC ---
function connectToServer(username) {
    socket = io();
    socket.on('connect', () => {
        socket.emit('setUsername', username);
        socket.emit('updateCustomization', myCustomization);
    });

    socket.on('init', (data) => {
        myId = data.id;
        hasDomain = data.players[myId].hasDomain;
        if (hasDomain) uiDomain.classList.remove('hidden');

        buildHouse();
        buildItems(data.gameState);
        spawnTungTung();

        for (const [obsId, obsData] of Object.entries(data.gameState.puzzles)) {
            if (obsData.solved) {
                const mesh = scene.getObjectByName(`OBSTACLE_${obsId}`);
                if (mesh) mesh.visible = false;
            }
            if (obsId === 'weaponsCase' && obsData.isOpen) {
                itemMeshes['crossbow'].visible = true;
                itemMeshes['arrow_1'].visible = true;
                itemMeshes['arrow_2'].visible = true;
                itemMeshes['arrow_3'].visible = true;
            }
        }

        for (const [id, pData] of Object.entries(data.players)) {
            if (id !== myId && !pData.isDead) {
                remotePlayers[id] = createPlayerAvatar(id, pData.username, pData.customization);
                remotePlayers[id].position.copy(pData.pos);
                if (pData.isHiding) remotePlayers[id].visible = false;
                if (pData.isCrouching) remotePlayers[id].scale.y = 0.5; // Squish avatar if crouching
            }
        }
        if (!mobileEnabled) controls.lock();
        animate();
    });

    socket.on('playerJoined', (pData) => remotePlayers[pData.id] = createPlayerAvatar(pData.id, pData.username, pData.customization));
    socket.on('playerCustomized', (data) => {
        if (remotePlayers[data.id]) {
            scene.remove(remotePlayers[data.id]);
            remotePlayers[data.id] = createPlayerAvatar(data.id, "Player", data.colors);
        }
    });
    
    socket.on('playerMoved', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].position.copy(data.pos);
            remotePlayers[data.id].rotation.y = data.rot;
            // Sync crouching visual
            remotePlayers[data.id].scale.y = data.isCrouching ? 0.5 : 1.0;
        }
    });

    socket.on('playerHiding', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].userData.isHiding = data.isHiding;
            remotePlayers[data.id].visible = !data.isHiding;
        }
    });

    socket.on('noiseMade', (pos) => { window.noiseTarget = new THREE.Vector3(pos.x, pos.y, pos.z); window.noiseTimer = 8.0; });
    socket.on('tungTungKnockedOut', triggerTungTungKnockout);
    socket.on('domainActivated', (data) => triggerDomainExpansion(new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z)));

    socket.on('playerLeft', (id) => { if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }});
    socket.on('playerEliminated', (id) => { if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }});
    
    socket.on('itemUpdate', (data) => {
        const mesh = itemMeshes[data.itemId];
        if (mesh) {
            mesh.visible = data.itemState.visible;
            if (data.itemState.pos) mesh.position.copy(data.itemState.pos);
            
            // If dropped by another player, apply gravity physics locally
            if (data.itemState.visible && !data.itemState.holder) {
                mesh.userData.velocity = new THREE.Vector3(0, 2, 0); // Small pop up
                mesh.userData.isFalling = true;
                if (!physicsItems.includes(mesh)) physicsItems.push(mesh);
            }
        }
    });

    socket.on('puzzleUpdate', (data) => {
        const mesh = scene.getObjectByName(`OBSTACLE_${data.obstacleId}`);
        if (mesh) mesh.visible = false;
        if (data.obstacleId === 'weaponsCase') {
            itemMeshes['crossbow'].visible = true;
            itemMeshes['arrow_1'].visible = true;
            itemMeshes['arrow_2'].visible = true;
            itemMeshes['arrow_3'].visible = true;
        }
    });

    socket.on('carUpdate', (carStateServer) => { carState = carStateServer; });
    socket.on('gameWon', (data) => winGame(data.type));
    socket.on('gameOverAll', () => { alert(`TUNG TUNG SAHUR KILLED EVERYONE. Game Over.`); location.reload(); });
}

// --- PAUSE MENU LOGIC ---
document.getElementById('pause-btn').addEventListener('click', () => {
    if (!isMultiplayer && !mobileEnabled) controls.unlock();
    uiPause.classList.remove('hidden');
});

document.getElementById('btn-resume').addEventListener('click', () => {
    uiPause.classList.add('hidden');
    if (!isMultiplayer && !mobileEnabled) controls.lock();
});

document.getElementById('btn-leave').addEventListener('click', () => location.reload());

if (controls) {
    controls.addEventListener('lock', () => { uiPause.classList.add('hidden'); uiWardrobe.classList.add('hidden'); });
    controls.addEventListener('unlock', () => {
        if (!isDead && !isKillingPlayer && uiMainMenu.classList.contains('hidden') && uiWardrobe.classList.contains('hidden')) {
            uiPause.classList.remove('hidden');
        }
    });
}
