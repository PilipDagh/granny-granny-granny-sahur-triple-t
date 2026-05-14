import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- GLOBAL VARIABLES ---
let scene, camera, renderer, controls, socket;
let isMultiplayer = false;
let myId = null;
let remotePlayers = {};
let itemMeshes = {};
let granny = null; 
let collidableObjects = []; // NEW: Used to stop walking through walls!

// Player State
let lives = 5;
let isDead = false;
let inventory = null;
let currentDay = 1;
let ammo = 3; // NEW: Crossbow ammo

// Stealth & Distraction State
let isHiding = false;
window.noiseTarget = null;
window.noiseTimer = 0;

// NEW: Tung Tung Knockout State
let tungTungKnockedOut = false;
let tungTungKnockoutTimer = 0;

// Movement & Mobile State
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isSprinting = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let mobileEnabled = false;
let lookSensitivity = 0.005;
let mobileMoveData = { x: 0, y: 0 };

// --- DOM ELEMENTS ---
const uiMainMenu = document.getElementById('main-menu');
const uiSettings = document.getElementById('settings-menu');
const uiPause = document.getElementById('pause-menu');
const uiGame = document.getElementById('game-ui');
const uiDeath = document.getElementById('death-screen');
const uiDayText = document.getElementById('day-text');
const uiLives = document.getElementById('lives-display');
const uiInventory = document.getElementById('inventory-display');
const uiInteract = document.getElementById('interact-prompt');
const uiAmmo = document.getElementById('ammo-display'); // NEW

// --- PROCEDURAL TEXTURE GENERATOR ---
function createWoodTexture(baseColor, lineColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 512, 512);
    
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    for (let i = 0; i < 100; i++) {
        ctx.beginPath();
        let x = Math.random() * 512;
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (Math.random()*50 - 25), 170, x + (Math.random()*50 - 25), 340, x + (Math.random()*50 - 25), 512);
        ctx.stroke();
    }
    
    ctx.strokeStyle = '#110a05';
    ctx.lineWidth = 4;
    for (let i = 0; i < 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

const wallTexture = createWoodTexture('#3d2b22', '#2a1a10');
const floorTexture = createWoodTexture('#1a1008', '#0a0502');
floorTexture.repeat.set(4, 4);

const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.9 });
const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8 });

// --- WEB AUDIO API: SCARY TUNG TUNG SYNTHESIZER ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTungSound(distance) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (tungTungKnockedOut) return; // Don't play sound if he's knocked out!
    
    let vol = Math.max(0, 1 - (distance / 40)); 
    if (vol <= 0) return;

    // 1. The Wood Block Sound
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.1); 
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15); 
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);

    // 2. NEW: Scary Granny Creak/Groan Sound
    if (Math.random() > 0.5) {
        const creakOsc = audioCtx.createOscillator();
        const creakGain = audioCtx.createGain();
        creakOsc.type = 'sawtooth';
        creakOsc.frequency.setValueAtTime(80 + Math.random()*40, audioCtx.currentTime);
        creakOsc.frequency.linearRampToValueAtTime(40, audioCtx.currentTime + 0.5);
        creakGain.gain.setValueAtTime(vol * 0.3, audioCtx.currentTime);
        creakGain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        creakOsc.connect(creakGain);
        creakGain.connect(audioCtx.destination);
        creakOsc.start();
        creakOsc.stop(audioCtx.currentTime + 0.5);
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

// --- ENGINE INITIALIZATION (BRIGHTER & FIXED CAMERA) ---
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.FogExp2(0x050505, 0.05); // NEW: Thinner fog so it's brighter!

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.7, 0);
    camera.rotation.order = 'YXZ'; // NEW: CRITICAL FIX! Prevents camera roll/spaceship tilting!

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    const flashlight = new THREE.SpotLight(0xffffff, 2.0, 30, Math.PI / 4, 0.5, 1); // Brighter flashlight
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);

    const ambientLight = new THREE.AmbientLight(0x444444); // NEW: Brighter ambient light
    scene.add(ambientLight);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, false);
}

// --- UI & MENU LOGIC ---
document.getElementById('btn-settings').addEventListener('click', () => {
    uiMainMenu.classList.add('hidden');
    uiSettings.classList.remove('hidden');
});

document.getElementById('btn-back-settings').addEventListener('click', () => {
    uiSettings.classList.add('hidden');
    uiMainMenu.classList.remove('hidden');
});

document.getElementById('sensitivity').addEventListener('input', (e) => {
    document.getElementById('sens-val').innerText = e.target.value;
    lookSensitivity = e.target.value * 0.001;
});

document.getElementById('mobile-toggle').addEventListener('change', (e) => {
    mobileEnabled = e.target.checked;
});

document.getElementById('btn-singleplayer').addEventListener('click', () => startGame(false));
document.getElementById('btn-multiplayer').addEventListener('click', () => startGame(true));

function startGame(multi) {
    isMultiplayer = multi;
    const username = document.getElementById('username-input').value || 'Guest-' + Math.floor(Math.random() * 9000);
    
    uiMainMenu.classList.add('hidden');
    uiGame.classList.remove('hidden');
    
    if (audioCtx.state === 'suspended') audioCtx.resume();

    initEngine();
    setupMobileControls(); 

    if (isMultiplayer) {
        connectToServer(username); 
    } else {
        buildHouse();
        buildItems(null); 
        spawnTungTung();
        
        if (!mobileEnabled) controls.lock();
        animate(); 
    }
}

// --- UPGRADED HOUSE CONSTRUCTION (WEAPONS ROOM & COLLISIONS) ---
function createWall(x, y, z, width, rotationY = 0) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 4, 0.5), wallMaterial);
    wall.position.set(x, y, z);
    wall.rotation.y = rotationY;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    collidableObjects.push(wall); // NEW: Add to collision array!
    return wall;
}

function buildHouse() {
    collidableObjects = []; // Reset collisions

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4;
    scene.add(ceiling);

    // Bedroom
    createWall(0, 2, -5, 10); 
    createWall(-5, 2, 0, 10, Math.PI / 2); 
    createWall(5, 2, 2.5, 5, Math.PI / 2); 
    createWall(0, 2, 5, 10); 

    const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 6), new THREE.MeshStandardMaterial({color: 0x331111}));
    bed.position.set(-3, 0.4, -1);
    bed.name = "OBSTACLE_bed"; 
    scene.add(bed);
    collidableObjects.push(bed);

    // Hallways
    createWall(10, 2, 5, 20, Math.PI / 2); 
    createWall(15, 2, -5, 10); 
    createWall(20, 2, 0, 10, Math.PI / 2); 
    
    // NEW: WEAPONS ROOM
    createWall(25, 2, 5, 10, Math.PI / 2); // Back wall of weapons room
    createWall(20, 2, 10, 10); // Side wall
    
    // Weapons Case (Needs Weapons Key)
    const weaponsCase = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({color: 0x222222}));
    weaponsCase.position.set(22, 0.5, 8);
    weaponsCase.name = "OBSTACLE_weaponsCase";
    scene.add(weaponsCase);
    collidableObjects.push(weaponsCase);

    // Basement
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 12), floorMaterial);
    ramp.position.set(15, -2, -15);
    ramp.rotation.x = Math.PI / 5;
    scene.add(ramp);
    
    const basementFloor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMaterial);
    basementFloor.position.set(15, -4, -25);
    basementFloor.rotation.x = -Math.PI / 2;
    scene.add(basementFloor);

    createWall(15, -2, -35, 20); 
    createWall(5, -2, -25, 20, Math.PI/2); 
    createWall(25, -2, -25, 20, Math.PI/2); 

    // Main Entrance
    createWall(0, 2, 20, 20); 
    createWall(-10, 2, 12.5, 15, Math.PI / 2); 
    createWall(10, 2, 12.5, 15, Math.PI / 2); 

    const doorGroup = new THREE.Group();
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.2), new THREE.MeshStandardMaterial({color: 0x550000}));
    doorMesh.position.set(0, 1.9, 19.9);
    doorGroup.add(doorMesh);
    collidableObjects.push(doorMesh);

    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 0.3), new THREE.MeshStandardMaterial({map: wallTexture}));
    plank.position.set(0, 2, 19.7);
    plank.name = "OBSTACLE_barricade";
    doorGroup.add(plank);

    const wires = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), new THREE.MeshStandardMaterial({color: 0x00ff00}));
    wires.position.set(1.2, 1.5, 19.7);
    wires.name = "OBSTACLE_circuitBox";
    doorGroup.add(wires);

    const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), new THREE.MeshStandardMaterial({color: 0xaaaaaa}));
    padlock.position.set(-0.5, 1.8, 19.7);
    padlock.name = "OBSTACLE_mainDoor";
    doorGroup.add(padlock);

    scene.add(doorGroup);
}

// --- TUNG TUNG SAHUR MONSTER ---
function createTungTungModel() {
    const group = new THREE.Group();

    const bodyGeom = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ map: wallTexture, color: 0x5c4033 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 1.5;
    group.add(body);

    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    slit.position.set(0.45, 1.5, 0);
    group.add(slit);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), bodyMat);
    head.position.y = 2.7;
    group.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
    leftEye.position.set(0.2, 2.8, 0.3);
    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
    rightEye.position.set(-0.2, 2.8, 0.3);
    
    const eyeLight = new THREE.PointLight(0xff0000, 1, 5);
    eyeLight.position.set(0, 2.8, 0.4);
    group.add(leftEye, rightEye, eyeLight);

    const armGeom = new THREE.CylinderGeometry(0.05, 0.05, 1.2);
    const leftArm = new THREE.Mesh(armGeom, bodyMat);
    leftArm.position.set(0.6, 1.5, 0);
    leftArm.rotation.z = Math.PI / 8;
    const rightArm = new THREE.Mesh(armGeom, bodyMat);
    rightArm.position.set(-0.6, 1.5, 0);
    rightArm.rotation.z = -Math.PI / 8;
    group.add(leftArm, rightArm);

    return group;
}

function spawnTungTung() {
    granny = createTungTungModel();
    granny.position.set(0, 0, 15); 
    scene.add(granny);
}
// --- CONTINUING FROM PART 1 ---

// --- MULTIPLAYER AVATAR GENERATOR ---
function createPlayerAvatar(id, username) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), new THREE.MeshStandardMaterial({color: 0x2244aa}));
    body.position.y = 0.7;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({color: 0xffccaa}));
    head.position.y = 1.65;
    group.add(head);

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.font = '32px Courier Prime';
    ctx.textAlign = 'center';
    ctx.fillText(username, 128, 40);
    
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.y = 2.2;
    sprite.scale.set(2, 0.5, 1);
    group.add(sprite);

    group.name = id;
    group.userData = { isHiding: false };
    scene.add(group);
    return group;
}

// --- ITEM GENERATION (ADDED CROSSBOW & WEAPONS KEY) ---
function createItemMesh(type) {
    const group = new THREE.Group();
    if (type === 'hammer') {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6), new THREE.MeshStandardMaterial({color: 0x8b4513}));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.15), new THREE.MeshStandardMaterial({color: 0x555555}));
        head.position.y = 0.3;
        group.add(handle, head);
    } else if (type === 'pliers') {
        const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), new THREE.MeshStandardMaterial({color: 0xcc0000}));
        h1.position.set(0.05, 0, 0); h1.rotation.z = 0.2;
        const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), new THREE.MeshStandardMaterial({color: 0xcc0000}));
        h2.position.set(-0.05, 0, 0); h2.rotation.z = -0.2;
        group.add(h1, h2);
    } else if (type === 'master_key') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), new THREE.MeshStandardMaterial({color: 0xffd700}));
        const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.05), new THREE.MeshStandardMaterial({color: 0xffd700}));
        teeth.position.set(0.1, 0.15, 0);
        group.add(base, teeth);
    } else if (type === 'weapons_key') {
        // Silver Key
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), new THREE.MeshStandardMaterial({color: 0xcccccc}));
        const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.05), new THREE.MeshStandardMaterial({color: 0xcccccc}));
        teeth.position.set(0.1, 0.15, 0);
        group.add(base, teeth);
    } else if (type === 'crossbow') {
        // Crossbow Model
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), new THREE.MeshStandardMaterial({color: 0x3d2b22}));
        const bow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), new THREE.MeshStandardMaterial({color: 0x555555}));
        bow.position.set(0, 0, -0.3);
        group.add(stock, bow);
    }
    return group;
}

function buildItems(initialState) {
    const itemsData = initialState ? initialState.items : {
        'hammer': { pos: {x: 15, y: -3.5, z: -25}, visible: true },
        'pliers': { pos: {x: 12, y: 0.5, z: 5}, visible: true },
        'master_key': { pos: {x: 0, y: 4.5, z: 0}, visible: true },
        'weapons_key': { pos: {x: -3, y: 0.5, z: 8}, visible: true },
        'crossbow': { pos: {x: 22, y: 0.5, z: 8}, visible: false } // Hidden until case is opened
    };

    for (const [id, data] of Object.entries(itemsData)) {
        const mesh = createItemMesh(id);
        mesh.position.set(data.pos.x, data.pos.y, data.pos.z);
        mesh.name = `ITEM_${id}`;
        mesh.visible = data.visible;
        scene.add(mesh);
        itemMeshes[id] = mesh;
    }
}

// --- INTERACTION RAYCASTER & STEALTH ---
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
let currentTarget = null;

function checkInteractions() {
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    currentTarget = null;
    uiInteract.innerText = isHiding ? "HIDING (Press E to exit)" : "";

    if (intersects.length > 0 && !isHiding) {
        let obj = intersects[0].object;
        while (obj.parent && obj.parent.type !== 'Scene') {
            if (obj.name.startsWith("ITEM_") || obj.name.startsWith("OBSTACLE_")) break;
            obj = obj.parent;
        }

        if (intersects[0].distance < 3.0) {
            if (obj.name.startsWith("ITEM_") && obj.visible) {
                const itemName = obj.name.replace("ITEM_", "");
                uiInteract.innerText = `Press E to pick up ${itemName.replace('_', ' ')}`;
                currentTarget = { type: 'item', id: itemName, obj: obj };
            } 
            else if (obj.name.startsWith("OBSTACLE_") && obj.visible) {
                const obsName = obj.name.replace("OBSTACLE_", "");
                
                if (obsName === 'bed') {
                    uiInteract.innerText = "Press E to hide under bed";
                    currentTarget = { type: 'obstacle', id: obsName, obj: obj };
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
        isHiding = false;
        camera.position.set(-3, 1.7, 1); 
        if (isMultiplayer) socket.emit('setHiding', false);
        return;
    }

    if (!currentTarget) return;

    if (currentTarget.type === 'item') {
        if (inventory) dropItem();
        inventory = currentTarget.id;
        uiInventory.innerText = `Holding: ${inventory.replace('_', ' ')}`;
        
        // Show Ammo UI if holding crossbow
        if (inventory === 'crossbow') {
            uiAmmo.classList.remove('hidden');
            uiAmmo.innerText = `Arrows: ${ammo}`;
            document.getElementById('mobile-shoot').classList.remove('hidden');
        } else {
            uiAmmo.classList.add('hidden');
            document.getElementById('mobile-shoot').classList.add('hidden');
        }

        if (isMultiplayer) socket.emit('itemAction', { itemId: inventory, action: 'pickup' });
        else currentTarget.obj.visible = false;
    } 
    else if (currentTarget.type === 'obstacle') {
        if (currentTarget.id === 'bed') {
            isHiding = true;
            camera.position.set(-3, 0.2, -1); 
            if (isMultiplayer) socket.emit('setHiding', true);
            return;
        }

        if (isMultiplayer) socket.emit('puzzleSolved', { obstacleId: currentTarget.id });
        else {
            currentTarget.obj.visible = false;
            if (currentTarget.id === 'weaponsCase') {
                itemMeshes['crossbow'].visible = true; // Spawn crossbow locally
            }
            if (currentTarget.id === 'mainDoor') winGame();
        }
        inventory = null;
        uiInventory.innerText = `Holding: Nothing`;
    }
}

function dropItem() {
    if (!inventory || isHiding) return;
    
    const dropPos = new THREE.Vector3();
    camera.getWorldDirection(dropPos);
    dropPos.multiplyScalar(1.5).add(camera.position);
    dropPos.y = camera.position.y > 0 ? 0.5 : -3.5; 

    window.noiseTarget = dropPos.clone();
    window.noiseTimer = 8.0; 
    
    if (isMultiplayer) {
        socket.emit('itemAction', { itemId: inventory, action: 'drop', pos: dropPos });
        socket.emit('makeNoise', dropPos);
    } else {
        const mesh = itemMeshes[inventory];
        mesh.position.copy(dropPos);
        mesh.visible = true;
    }
    
    inventory = null;
    uiInventory.innerText = `Holding: Nothing`;
    uiAmmo.classList.add('hidden');
    document.getElementById('mobile-shoot').classList.add('hidden');
}

// --- SHOOTING MECHANIC ---
function shootCrossbow() {
    if (inventory !== 'crossbow' || ammo <= 0 || tungTungKnockedOut) return;

    ammo--;
    uiAmmo.innerText = `Arrows: ${ammo}`;

    // Play shoot sound (simple snap)
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);

    // Raycast to see if we hit Tung Tung
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    for (let i = 0; i < intersects.length; i++) {
        let obj = intersects[i].object;
        let hitTungTung = false;
        
        // Check if the hit object is part of the granny group
        while (obj.parent && obj.parent.type !== 'Scene') {
            if (obj === granny || obj.parent === granny) {
                hitTungTung = true;
                break;
            }
            obj = obj.parent;
        }

        if (hitTungTung) {
            triggerTungTungKnockout();
            if (isMultiplayer) socket.emit('shootTungTung');
            break; // Stop raycast after hitting him
        } else if (collidableObjects.includes(obj)) {
            break; // Hit a wall first, arrow blocked!
        }
    }
}

function triggerTungTungKnockout() {
    if (!granny || tungTungKnockedOut) return;
    
    tungTungKnockedOut = true;
    tungTungKnockoutTimer = 90.0; // 1 minute 30 seconds!

    // Ragdoll effect (fall over)
    granny.rotation.x = -Math.PI / 2;
    granny.position.y = 0.5; // Lower to ground
}

// --- MULTIPLAYER SYNC ---
function connectToServer(username) {
    socket = io();
    socket.on('connect', () => socket.emit('setUsername', username));

    socket.on('init', (data) => {
        myId = data.id;
        buildHouse();
        buildItems(data.gameState);
        spawnTungTung();

        for (const [obsId, obsData] of Object.entries(data.gameState.puzzles)) {
            if (obsData.solved) {
                const mesh = scene.getObjectByName(`OBSTACLE_${obsId}`);
                if (mesh) mesh.visible = false;
            }
        }

        for (const [id, pData] of Object.entries(data.players)) {
            if (id !== myId && !pData.isDead) {
                remotePlayers[id] = createPlayerAvatar(id, pData.username);
                remotePlayers[id].position.copy(pData.pos);
                if (pData.isHiding) remotePlayers[id].visible = false;
            }
        }
        if (!mobileEnabled) controls.lock();
        animate();
    });

    socket.on('playerJoined', (pData) => remotePlayers[pData.id] = createPlayerAvatar(pData.id, pData.username));
    
    socket.on('playerMoved', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].position.copy(data.pos);
            remotePlayers[data.id].rotation.y = data.rot;
        }
    });

    socket.on('playerHiding', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].userData.isHiding = data.isHiding;
            remotePlayers[data.id].visible = !data.isHiding;
        }
    });

    socket.on('noiseMade', (pos) => {
        window.noiseTarget = new THREE.Vector3(pos.x, pos.y, pos.z);
        window.noiseTimer = 8.0;
    });

    // NEW: Sync Knockout
    socket.on('tungTungKnockedOut', () => {
        triggerTungTungKnockout();
    });

    socket.on('playerLeft', (id) => { if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }});
    socket.on('playerEliminated', (id) => { if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }});
    
    socket.on('itemUpdate', (data) => {
        const mesh = itemMeshes[data.itemId];
        if (mesh) {
            mesh.visible = data.itemState.visible;
            if (data.itemState.pos) mesh.position.copy(data.itemState.pos);
        }
    });

    socket.on('puzzleUpdate', (data) => {
        const mesh = scene.getObjectByName(`OBSTACLE_${data.obstacleId}`);
        if (mesh) mesh.visible = false;
        
        // If weapons case opened by someone else, show crossbow
        if (data.obstacleId === 'weaponsCase') {
            itemMeshes['crossbow'].visible = true;
        }
    });

    socket.on('gameWon', (winnerName) => { alert(`ESCAPE SUCCESSFUL! ${winnerName} unlocked the door!`); location.reload(); });
    socket.on('gameOverAll', () => { alert(`TUNG TUNG SAHUR KILLED EVERYONE. Game Over.`); location.reload(); });
}
