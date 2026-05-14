import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- GLOBAL VARIABLES ---
let scene, camera, renderer, controls, socket;
let isMultiplayer = false;
let myId = null;
let remotePlayers = {};
let itemMeshes = {};
let granny = null; 

// Player State
let lives = 5;
let isDead = false;
let inventory = null;
let currentDay = 1;

// NEW: Stealth & Distraction State
let isHiding = false;
window.noiseTarget = null;
window.noiseTimer = 0;

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

// --- WEB AUDIO API: TUNG TUNG SYNTHESIZER ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTungSound(distance) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    let vol = Math.max(0, 1 - (distance / 30)); 
    if (vol <= 0) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1); 
    
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15); 
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

setInterval(() => {
    if (granny && camera && !isDead && uiGame.classList.contains('hidden') === false) {
        const dist = granny.position.distanceTo(camera.position);
        if (dist < 30) {
            playTungSound(dist);
            setTimeout(() => playTungSound(dist), 250);
            setTimeout(() => playTungSound(dist), 500);
        }
    }
}, 2000);

// --- ENGINE INITIALIZATION ---
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);
    scene.fog = new THREE.FogExp2(0x020202, 0.12);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.7, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    const flashlight = new THREE.SpotLight(0xffffff, 1.5, 20, Math.PI / 5, 0.5, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);

    const ambientLight = new THREE.AmbientLight(0x111111);
    scene.add(ambientLight);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, false);
}

// --- UI & MENU LOGIC (FIXED FOR MODULE SCOPE) ---
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

// The Start Game Listeners
document.getElementById('btn-singleplayer').addEventListener('click', () => startGame(false));
document.getElementById('btn-multiplayer').addEventListener('click', () => startGame(true));

function startGame(multi) {
    isMultiplayer = multi;
    const username = document.getElementById('username-input').value || 'Guest-' + Math.floor(Math.random() * 9000);
    
    uiMainMenu.classList.add('hidden');
    uiGame.classList.remove('hidden');
    
    if (audioCtx.state === 'suspended') audioCtx.resume();

    initEngine();
    setupMobileControls(); // Will be defined in Part 2

    if (isMultiplayer) {
        connectToServer(username); // Will be defined in Part 2
    } else {
        buildHouse();
        buildItems(null); // null uses local defaults (Defined in Part 2)
        spawnTungTung();
        
        if (!mobileEnabled) controls.lock();
        animate(); // Will be defined in Part 2
    }
}

// --- UPGRADED HOUSE CONSTRUCTION (BASEMENT & HIDING) ---
function createWall(x, y, z, width, rotationY = 0) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 4, 0.5), wallMaterial);
    wall.position.set(x, y, z);
    wall.rotation.y = rotationY;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    return wall;
}

function buildHouse() {
    // Main Floor & Ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4;
    scene.add(ceiling);

    // Bedroom (Spawn Room)
    createWall(0, 2, -5, 10); 
    createWall(-5, 2, 0, 10, Math.PI / 2); 
    createWall(5, 2, 2.5, 5, Math.PI / 2); 
    createWall(0, 2, 5, 10); 

    // THE BED (Interactive Hiding Spot)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 6), new THREE.MeshStandardMaterial({color: 0x331111}));
    bed.position.set(-3, 0.4, -1);
    bed.name = "OBSTACLE_bed"; 
    scene.add(bed);

    // Hallways
    createWall(10, 2, 5, 20, Math.PI / 2); 
    createWall(15, 2, -5, 10); 
    createWall(20, 2, 0, 10, Math.PI / 2); 
    
    // THE BASEMENT
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 12), floorMaterial);
    ramp.position.set(15, -2, -15);
    ramp.rotation.x = Math.PI / 5;
    scene.add(ramp);
    
    const basementFloor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMaterial);
    basementFloor.position.set(15, -4, -25);
    basementFloor.rotation.x = -Math.PI / 2;
    scene.add(basementFloor);

    createWall(15, -2, -35, 20); // Basement Back
    createWall(5, -2, -25, 20, Math.PI/2); // Basement Left
    createWall(25, -2, -25, 20, Math.PI/2); // Basement Right

    // Main Entrance & Door
    createWall(0, 2, 20, 20); 
    createWall(-10, 2, 12.5, 15, Math.PI / 2); 
    createWall(10, 2, 12.5, 15, Math.PI / 2); 

    const doorGroup = new THREE.Group();
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.2), new THREE.MeshStandardMaterial({color: 0x550000}));
    doorMesh.position.set(0, 1.9, 19.9);
    doorGroup.add(doorMesh);

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

// --- ITEM GENERATION ---
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
    }
    return group;
}

function buildItems(initialState) {
    const itemsData = initialState ? initialState.items : {
        'hammer': { pos: {x: 15, y: -3.5, z: -25}, visible: true }, // Basement!
        'pliers': { pos: {x: 12, y: 0.5, z: 5}, visible: true },
        'master_key': { pos: {x: 0, y: 4.5, z: 0}, visible: true }
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

                let req = obsName === 'barricade' ? 'hammer' : (obsName === 'circuitBox' ? 'pliers' : 'master_key');
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
        // Exit hiding
        isHiding = false;
        camera.position.set(-3, 1.7, 1); // Stand up next to bed
        if (isMultiplayer) socket.emit('setHiding', false);
        return;
    }

    if (!currentTarget) return;

    if (currentTarget.type === 'item') {
        if (inventory) dropItem();
        inventory = currentTarget.id;
        uiInventory.innerText = `Holding: ${inventory.replace('_', ' ')}`;
        if (isMultiplayer) socket.emit('itemAction', { itemId: inventory, action: 'pickup' });
        else currentTarget.obj.visible = false;
    } 
    else if (currentTarget.type === 'obstacle') {
        if (currentTarget.id === 'bed') {
            isHiding = true;
            camera.position.set(-3, 0.2, -1); // Move camera under bed
            if (isMultiplayer) socket.emit('setHiding', true);
            return;
        }

        if (isMultiplayer) socket.emit('puzzleSolved', { obstacleId: currentTarget.id });
        else {
            currentTarget.obj.visible = false;
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
    dropPos.y = camera.position.y > 0 ? 0.5 : -3.5; // Drop on floor or basement floor

    // NOISE DISTRACTION AI
    window.noiseTarget = dropPos.clone();
    window.noiseTimer = 8.0; // Tung Tung investigates for 8 seconds
    
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
}

// --- CONTROLS & MOBILE ---
window.addEventListener('keydown', (e) => {
    if (isDead) return;
    if (e.code === 'KeyE') performInteraction();
    if (e.code === 'KeyQ') dropItem();
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

function setupMobileControls() {
    if (!mobileEnabled) return;
    
    document.getElementById('joystick-move').classList.remove('hidden');
    document.getElementById('joystick-look').classList.remove('hidden');
    document.getElementById('mobile-interact').classList.remove('hidden');
    document.getElementById('mobile-drop').classList.remove('hidden');

    document.getElementById('mobile-interact').addEventListener('touchstart', performInteraction);
    document.getElementById('mobile-drop').addEventListener('touchstart', dropItem);

    const moveZone = document.getElementById('joystick-move');
    const lookZone = document.getElementById('joystick-look');

    moveZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = moveZone.getBoundingClientRect();
        mobileMoveData.x = Math.max(-1, Math.min(1, (touch.clientX - (rect.left + rect.width/2)) / 40));
        mobileMoveData.y = Math.max(-1, Math.min(1, (touch.clientY - (rect.top + rect.height/2)) / 40));
    }, { passive: false });

    moveZone.addEventListener('touchend', () => mobileMoveData = { x: 0, y: 0 });

    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = lookZone.getBoundingClientRect();
        camera.rotation.y -= (touch.clientX - (rect.left + rect.width/2)) * lookSensitivity;
        camera.rotation.x -= (touch.clientY - (rect.top + rect.height/2)) * lookSensitivity;
        camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
    }, { passive: false });
}

// --- TUNG TUNG SMART AI ---
function updateTungTungAI(delta) {
    if (!granny || isDead) return;

    let targetPos = null;
    let minDistance = Infinity;

    // 1. PRIORITY: Investigate Noise!
    if (window.noiseTarget && window.noiseTimer > 0) {
        targetPos = window.noiseTarget;
        window.noiseTimer -= delta;
        if (granny.position.distanceTo(window.noiseTarget) < 1.5) window.noiseTarget = null;
    } 
    // 2. Hunt Players
    else {
        if (isMultiplayer) {
            for (const [id, pMesh] of Object.entries(remotePlayers)) {
                if (pMesh.userData.isHiding) continue; // Ignore hiding players
                const dist = granny.position.distanceTo(pMesh.position);
                if (dist < minDistance) { minDistance = dist; targetPos = pMesh.position; }
            }
            if (!isHiding) {
                const dist = granny.position.distanceTo(camera.position);
                if (dist < minDistance) { minDistance = dist; targetPos = camera.position; }
            }
        } else {
            if (!isHiding) {
                targetPos = camera.position;
                minDistance = granny.position.distanceTo(camera.position);
            }
        }
    }

    // Move Tung Tung
    if (targetPos) {
        // Keep Tung Tung at the correct height (Basement vs Main Floor)
        const targetY = targetPos.y < 0 ? -2.5 : 0; 
        granny.position.y += (targetY - granny.position.y) * 5 * delta; // Smooth Y transition on ramps

        const lookTarget = new THREE.Vector3(targetPos.x, granny.position.y, targetPos.z);
        granny.lookAt(lookTarget);
        
        const speed = isMultiplayer ? 3.0 : 2.5;
        granny.translateZ(speed * delta);

        if (targetPos === camera.position && minDistance < 1.2 && !isHiding) {
            triggerDeath();
        }
    }
}

// --- DEATH & RESPAWN ---
function triggerDeath() {
    if (isDead) return;
    isDead = true; lives--; currentDay++;
    if (isMultiplayer) socket.emit('playerDied');

    camera.lookAt(granny.position);
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
    isDead = false; isHiding = false;
    uiDeath.classList.add('hidden');
    uiGame.classList.remove('hidden');
    uiLives.innerText = `Lives: ${lives}`;
    camera.position.set(0, 1.7, 0);
    camera.rotation.set(0, 0, 0);
    if (granny && !isMultiplayer) granny.position.set(0, 0, 15);
}

function winGame() {
    alert("ESCAPE SUCCESSFUL! You unlocked the door!");
    location.reload();
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
    });

    socket.on('gameWon', (winnerName) => { alert(`ESCAPE SUCCESSFUL! ${winnerName} unlocked the door!`); location.reload(); });
    socket.on('gameOverAll', () => { alert(`TUNG TUNG SAHUR KILLED EVERYONE. Game Over.`); location.reload(); });
}

// --- MAIN ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    if (!isDead && (controls.isLocked || mobileEnabled)) {
        checkInteractions();

        if (!isHiding) {
            velocity.x -= velocity.x * 10.0 * delta;
            velocity.z -= velocity.z * 10.0 * delta;

            direction.z = Number(moveForward) - Number(moveBackward);
            direction.x = Number(moveRight) - Number(moveLeft);
            direction.normalize();

            if (mobileEnabled) { direction.x += mobileMoveData.x; direction.z -= mobileMoveData.y; }

            const currentSpeed = isSprinting ? 60.0 : 30.0;
            if (moveForward || moveBackward || mobileMoveData.y !== 0) velocity.z -= direction.z * currentSpeed * delta;
            if (moveLeft || moveRight || mobileMoveData.x !== 0) velocity.x -= direction.x * currentSpeed * delta;

            controls.moveRight(-velocity.x * delta);
            controls.moveForward(-velocity.z * delta);

            // --- BASEMENT RAMP PHYSICS ---
            // If player is in the ramp area (x: 13 to 17, z: -9 to -21)
            if (camera.position.x > 13 && camera.position.x < 17 && camera.position.z < -9 && camera.position.z > -21) {
                // Interpolate height based on Z position
                const rampProgress = (camera.position.z + 9) / -12; // 0 at top, 1 at bottom
                camera.position.y = 1.7 - (rampProgress * 4.0); // 1.7 down to -2.3
            } 
            // If player is fully in the basement (z < -21)
            else if (camera.position.z <= -21 && camera.position.x > 5) {
                camera.position.y = -2.3; // Basement head height
            } 
            // Normal floor
            else {
                camera.position.y = 1.7;
            }
        }

        updateTungTungAI(delta);

        if (isMultiplayer && socket && socket.connected) {
            socket.emit('move', { pos: camera.position, rot: camera.rotation.y });
        }
    }

    renderer.render(scene, camera);
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
    controls.addEventListener('lock', () => uiPause.classList.add('hidden'));
    controls.addEventListener('unlock', () => {
        if (!isDead && uiMainMenu.classList.contains('hidden')) uiPause.classList.remove('hidden');
    });
}
