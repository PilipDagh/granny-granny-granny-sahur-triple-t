import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ==========================================
// 1. MASSIVE GLOBAL STATE & PHYSICS ARRAYS
// ==========================================
let scene, camera, renderer, controls, socket;
let isMultiplayer = false, myId = null;
let remotePlayers = {}, itemMeshes = {}, doors = {};
let granny = null, spider = null; // Tung Tung & Tralalelo Tralala

// Physics & Raycasting Arrays
let collidableObjects = [];   // Walls, furniture, closed doors, car
let floorMeshes = [];         // Sectional floors and ramps for smooth walking
let interactableObjects = []; // Doors, items, wardrobe, car parts, paintings
let physicsItems = [];        // Items currently falling/bouncing with gravity
let activeProjectiles = [];   // Fired crossbow arrows

// Player State
let lives = 5, currentDay = 1, ammo = 0;
let isDead = false, isHiding = false, isCrouching = false, isKillingPlayer = false;
let inventory = null;
let myCustomization = { skin: '#ffccaa', hair: '#221100', shirt: '#2244aa', pants: '#111111', shoes: '#333333' };

// Domain Expansion State (0.67% Chance)
let hasDomain = false, domainActive = false, domainCooldown = 0;
let domainSphere = null, domainParticles = null, domainTimer = 0;

// Tung Tung AI State
let tungTungState = 'patrol'; // patrol, investigate, chase, lookAround
let tungTungKnockedOut = false, tungTungKnockoutTimer = 0, tungTungWaitTimer = 0;
window.noiseTarget = null;
window.noiseTimer = 0;

// Movement & Input State
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, isSprinting = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3(), direction = new THREE.Vector3();
const floorRaycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

// Mobile State (Fixed Touch Tracking)
let mobileEnabled = false, lookSensitivity = 0.0005; // Ultra-low sensitivity
let mobileMoveData = { x: 0, y: 0 }, moveTouchId = null, lookTouchId = null, lastLookX = 0, lastLookY = 0;

// ==========================================
// 2. AUDIO MAPPING ENGINE
// ==========================================
/* 
   GITHUB AUDIO FOLDER MAPPING:
   Place these files in your `public/audio/` folder:
   - chase_music.mp3      (Intense chase music)
   - ambient_bgm.mp3      (Creepy background wind/drone)
   - tung_idle_1.mp3      (Tung Tung saying "Hehehe")
   - tung_idle_2.mp3      (Tung Tung saying "I see you...")
   - spider_hiss.mp3      (Tralalelo Tralala hiss)
   - item_drop.mp3        (Thud sound for physics drops)
   - door_creak.mp3       (Opening/closing doors)
   - crossbow_fire.mp3    (Thwip sound)
   - jumpscare.mp3        (Loud noise for kill animation)
*/
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// We will load real audio buffers in Chunk 4, but for now, we use synthesized fallbacks 
// to prevent crashes if the mp3 files are missing from GitHub.
function playSynthesizedSound(type, distance = 0) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let vol = Math.max(0, 1 - (distance / 40)); 
    if (vol <= 0) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    if (type === 'drop') {
        osc.type = 'square'; osc.frequency.setValueAtTime(100, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    } else if (type === 'shoot') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(vol * 0.5, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    }
    
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);
}

// ==========================================
// 3. PROCEDURAL TEXTURES & MATERIALS
// ==========================================
function createWoodTexture(baseColor, lineColor, isFloor = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = baseColor; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = lineColor; ctx.lineWidth = isFloor ? 4 : 2;
    
    for (let i = 0; i < (isFloor ? 50 : 100); i++) {
        ctx.beginPath(); let x = Math.random() * 512; ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (Math.random()*50 - 25), 170, x + (Math.random()*50 - 25), 340, x + (Math.random()*50 - 25), 512);
        ctx.stroke();
    }
    ctx.strokeStyle = '#0a0502'; ctx.lineWidth = 6;
    for (let i = 0; i < 512; i += 64) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke(); }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

const wallMat = new THREE.MeshStandardMaterial({ map: createWoodTexture('#4a3525', '#2a1a10'), roughness: 0.9 });
const floorMat = new THREE.MeshStandardMaterial({ map: createWoodTexture('#2a1c12', '#1a0a05', true), roughness: 0.8 });
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 }); // Solid dark ceilings
const doorMat = new THREE.MeshStandardMaterial({ map: createWoodTexture('#3a2010', '#1a0a05'), roughness: 0.9 });
const furnMat = new THREE.MeshStandardMaterial({ map: createWoodTexture('#5c3a21', '#3a2010'), roughness: 0.7 });

// ==========================================
// 4. ENGINE INITIALIZATION (BLANK SCREEN FIX)
// ==========================================
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Dark grey, prevents pitch black void
    scene.fog = new THREE.FogExp2(0x111111, 0.025); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 9.7, 2); // Safe spawn upstairs, offset Z to avoid wall clipping
    camera.rotation.order = 'YXZ'; // Prevents spaceship camera roll

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    // Brighter ambient light so textures are visible
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); 
    scene.add(ambientLight);

    // Player Flashlight
    const flashlight = new THREE.SpotLight(0xffffff, 2.5, 40, Math.PI / 4, 0.5, 1); 
    flashlight.position.set(0, 0, 0); flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight); camera.add(flashlight.target); scene.add(camera);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
    }, false);
}

// ==========================================
// 5. INPUT & MOBILE CONTROLS
// ==========================================
window.addEventListener('keydown', (e) => {
    if (isDead || isKillingPlayer) return;
    if (e.code === 'KeyE') { if(typeof performInteraction === 'function') performInteraction(); }
    if (e.code === 'KeyQ') { if(typeof dropItem === 'function') dropItem(); }
    if (e.code === 'KeyC') isCrouching = !isCrouching; 
    if (e.code === 'KeyF') { if(typeof shootCrossbow === 'function') shootCrossbow(); }
    if (e.code === 'KeyJ' && hasDomain && domainCooldown <= 0 && !domainActive) {
        if(typeof triggerDomainExpansion === 'function') triggerDomainExpansion(camera.position);
        if (isMultiplayer && socket) socket.emit('activateDomain', camera.position);
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
    if (e.button === 0 && document.pointerLockElement === document.body) {
        if(typeof shootCrossbow === 'function') shootCrossbow();
    }
});

function setupMobileControls() {
    if (!mobileEnabled) return;
    
    // Unhide mobile UI
    ['joystick-move', 'joystick-look', 'btn-mobile-interact', 'btn-mobile-drop', 'btn-mobile-crouch'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.remove('hidden');
    });

    const btnInteract = document.getElementById('btn-mobile-interact');
    const btnDrop = document.getElementById('btn-mobile-drop');
    const btnShoot = document.getElementById('btn-mobile-shoot');
    const btnCrouch = document.getElementById('btn-mobile-crouch');

    if(btnInteract) btnInteract.addEventListener('touchstart', () => { if(typeof performInteraction === 'function') performInteraction(); });
    if(btnDrop) btnDrop.addEventListener('touchstart', () => { if(typeof dropItem === 'function') dropItem(); });
    if(btnShoot) btnShoot.addEventListener('touchstart', () => { if(typeof shootCrossbow === 'function') shootCrossbow(); });
    if(btnCrouch) btnCrouch.addEventListener('touchstart', () => isCrouching = !isCrouching);

    const moveZone = document.getElementById('joystick-move');
    const lookZone = document.getElementById('joystick-look');

    if(moveZone) {
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
    }

    if(lookZone) {
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
}

// ==========================================
// 6. GAME START EXPOSURE (MODULE FIX)
// ==========================================
window.startGame = function(multi) {
    isMultiplayer = multi;
    const uiMainMenu = document.getElementById('main-menu');
    const uiGame = document.getElementById('game-ui');
    
    if(uiMainMenu) uiMainMenu.classList.add('hidden');
    if(uiGame) uiGame.classList.remove('hidden');
    
    if (audioCtx.state === 'suspended') audioCtx.resume();

    initEngine();
    setupMobileControls(); 

    if (isMultiplayer) {
        if(typeof connectToServer === 'function') connectToServer(); 
    } else {
        if(typeof buildHouse === 'function') buildHouse();
        if(typeof buildItems === 'function') buildItems(); 
        if(typeof spawnTungTung === 'function') spawnTungTung();
        if(typeof spawnSpider === 'function') spawnSpider();
        
        // 0.67% chance for Domain Expansion
        if (Math.random() < 0.0067) { 
            hasDomain = true; 
            const uiDomain = document.getElementById('domain-display');
            if(uiDomain) uiDomain.classList.remove('hidden'); 
        }
        
        if (!mobileEnabled) controls.lock();
        if(typeof animate === 'function') animate(); 
    }
};
// ==========================================
// 7. MAP BUILDER HELPER FUNCTIONS
// ==========================================
function createWall(x, y, z, w, h, d, rotY = 0) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    wall.position.set(x, y + h/2, z); wall.rotation.y = rotY;
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall); collidableObjects.push(wall); return wall;
}

function createFloorSection(x, y, z, w, d) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(x, y, z); floor.receiveShadow = true;
    scene.add(floor); floorMeshes.push(floor); return floor;
}

function createCeilingSection(x, y, z, w, d) {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(x, y, z);
    scene.add(ceil);
}

function createRamp(x, y, z, w, d, rotX) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), floorMat);
    ramp.position.set(x, y, z); ramp.rotation.x = rotX; ramp.receiveShadow = true;
    scene.add(ramp); floorMeshes.push(ramp); return ramp;
}

function createDoor(id, x, y, z, w, h, rotY, swingDir) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z); pivot.rotation.y = rotY;
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), doorMat);
    doorMesh.position.set(w/2, h/2, 0); doorMesh.castShadow = true; doorMesh.receiveShadow = true;
    
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.15), new THREE.MeshStandardMaterial({color: 0xaaaaaa}));
    knob.position.set(w - 0.2, h/2, 0.15); doorMesh.add(knob);
    
    doorMesh.name = `INTERACT_door_${id}`;
    pivot.add(doorMesh); scene.add(pivot);
    interactableObjects.push(doorMesh); collidableObjects.push(doorMesh);
    
    doors[id] = { pivot: pivot, mesh: doorMesh, isOpen: false, closedRot: rotY, openRot: rotY + (Math.PI/2 * swingDir), currentRot: rotY };
}

function createVent(x, y, z, rotY) {
    const ventGroup = new THREE.Group();
    const lWall = new THREE.Mesh(new THREE.BoxGeometry(1.25, 4, 0.5), wallMat); lWall.position.set(-1.375, 2, 0);
    const rWall = new THREE.Mesh(new THREE.BoxGeometry(1.25, 4, 0.5), wallMat); rWall.position.set(1.375, 2, 0);
    const tWall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.5), wallMat); tWall.position.set(0, 2.75, 0);
    ventGroup.add(lWall, rWall, tWall); ventGroup.position.set(x, y, z); ventGroup.rotation.y = rotY;
    scene.add(ventGroup); collidableObjects.push(lWall, rWall, tWall);
}

function createFurniture(type, x, y, z, rotY) {
    const group = new THREE.Group();
    if (type === 'table') {
        const top = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3), furnMat); top.position.y = 1.5;
        const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), furnMat); l1.position.set(-1.8, 0.75, -1.3);
        const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), furnMat); l2.position.set(1.8, 0.75, -1.3);
        const l3 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), furnMat); l3.position.set(-1.8, 0.75, 1.3);
        const l4 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), furnMat); l4.position.set(1.8, 0.75, 1.3);
        group.add(top, l1, l2, l3, l4);
    } else if (type === 'chair') {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), furnMat); seat.position.y = 0.8;
        const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2), furnMat); back.position.set(0, 1.4, -0.4);
        const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), furnMat); legs.position.y = 0.4;
        group.add(seat, back, legs);
    }
    group.position.set(x, y, z); group.rotation.y = rotY;
    scene.add(group); collidableObjects.push(group);
}

function createPainting(x, y, z, rotY) {
    const paintingGroup = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 0.1), new THREE.MeshStandardMaterial({color: 0x221100}));
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.3), new THREE.MeshStandardMaterial({color: 0x888888}));
    canvas.position.z = 0.06; paintingGroup.add(frame, canvas);
    
    paintingGroup.position.set(x, y, z); paintingGroup.rotation.y = rotY;
    paintingGroup.name = "KNOCKABLE_painting"; paintingGroup.userData = { isKnocked: false };
    scene.add(paintingGroup); interactableObjects.push(paintingGroup);
}

// ==========================================
// 8. THE 1:1 GRANNY HOUSE BUILDER
// ==========================================
function buildHouse() {
    collidableObjects = []; floorMeshes = []; interactableObjects = []; doors = {};

    // ------------------------------------------
    // FLOOR 4: THE ATTIC (Y = 16) - Spider Room
    // ------------------------------------------
    createFloorSection(0, 16, 0, 26, 40);
    createFloorSection(21, 16, 0, 16, 40);
    createFloorSection(15, 16, -4, 4, 24);
    createFloorSection(15, 16, 26, 4, 12); // Hole at (15, 16, 15) for stairs down
    createCeilingSection(0, 20, 0, 40, 40); // Attic Roof

    createWall(0, 16, -20, 40, 4, 0.5); // Back
    createWall(-20, 16, 0, 40, 4, 0.5, Math.PI/2); // Left
    createWall(20, 16, 0, 40, 4, 0.5, Math.PI/2); // Right
    createWall(0, 16, 20, 40, 4, 0.5); // Front

    // Spider Room Enclosure
    createWall(-10, 16, -10, 10, 4, 0.5);
    createWall(-5, 16, -15, 10, 4, 0.5, Math.PI/2);
    createDoor('spider_room', -5, 16, -10, 2, 3.8, Math.PI/2, -1);

    // Stairs down to Upstairs
    createRamp(15, 12, 15, 4, 14, -Math.PI / 4.5);

    // ------------------------------------------
    // FLOOR 3: UPSTAIRS (Y = 8) - Spawn & Bedrooms
    // ------------------------------------------
    createFloorSection(0, 8, 0, 26, 40);   
    createFloorSection(21, 8, 0, 16, 40);  
    createFloorSection(15, 8, -4, 4, 24);  
    createFloorSection(15, 8, 26, 4, 12);  // Hole at (15, 8, 15) for stairs down to Main
    createCeilingSection(0, 12, 0, 40, 40); 

    // Bedroom (Spawn)
    createWall(0, 8, -5, 10, 4, 0.5); 
    createWall(-5, 8, 0, 10, 4, 0.5, Math.PI/2); 
    createWall(0, 8, 5, 10, 4, 0.5); 
    createWall(5, 8, 3.5, 3, 4, 0.5, Math.PI/2); 
    createDoor('bedroom', 5, 8, 2, 2, 3.8, Math.PI/2, -1);
    
    // Hiding Bed & Wardrobe
    const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 6), new THREE.MeshStandardMaterial({color: 0x331111}));
    bed.position.set(-3, 8.4, -1); bed.name = "OBSTACLE_bed"; scene.add(bed); collidableObjects.push(bed);
    
    const wardrobe = new THREE.Mesh(new THREE.BoxGeometry(2, 3.5, 1.5), furnMat);
    wardrobe.position.set(3, 9.75, -3.5); wardrobe.name = "INTERACT_wardrobe"; scene.add(wardrobe); collidableObjects.push(wardrobe);

    // Upstairs Hallway & Vent
    createWall(10, 8, 5, 20, 4, 0.5, Math.PI/2); 
    createWall(15, 8, -5, 10, 4, 0.5); 
    createVent(20, 8, 0, Math.PI/2); // Crouch to enter!
    createPainting(9.7, 10, 0, Math.PI/2); // Knockable painting

    // Stairs down to Main Floor
    createRamp(15, 4, 15, 4, 14, -Math.PI / 4.5);

    // ------------------------------------------
    // FLOOR 2: MAIN FLOOR (Y = 0) - Escape & Garage
    // ------------------------------------------
    createFloorSection(0, 0, 0, 26, 40);   
    createFloorSection(21, 0, 0, 16, 40);  
    createFloorSection(15, 0, 5, 4, 30);   
    createFloorSection(15, 0, -25, 4, 10); // Hole at (15, 0, -15) for stairs to Basement
    createCeilingSection(0, 4, 0, 40, 40); 

    // Front Door Area & Puzzles
    createWall(0, 0, 20, 20, 4, 0.5); 
    createWall(-10, 0, 12.5, 15, 4, 0.5, Math.PI/2); 
    createWall(10, 0, 12.5, 15, 4, 0.5, Math.PI/2); 

    const doorGroup = new THREE.Group();
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.2), new THREE.MeshStandardMaterial({color: 0x550000}));
    doorMesh.position.set(0, 1.9, 19.9); doorGroup.add(doorMesh); collidableObjects.push(doorMesh);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 0.3), wallMat); plank.position.set(0, 2, 19.7); plank.name = "OBSTACLE_barricade"; doorGroup.add(plank);
    const wires = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), new THREE.MeshStandardMaterial({color: 0x00ff00})); wires.position.set(1.2, 1.5, 19.7); wires.name = "OBSTACLE_circuitBox"; doorGroup.add(wires);
    const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), new THREE.MeshStandardMaterial({color: 0xaaaaaa})); padlock.position.set(-0.5, 1.8, 19.7); padlock.name = "OBSTACLE_mainDoor"; doorGroup.add(padlock);
    scene.add(doorGroup);

    // Weapons Room
    createWall(25, 0, 5, 10, 4, 0.5, Math.PI/2); 
    createWall(20, 0, 11, 8, 4, 0.5); 
    createDoor('weapons_room', 19, 0, 10, 2, 3.8, 0, 1);
    
    const weaponsCase = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.3), new THREE.MeshStandardMaterial({color: 0x222222}));
    weaponsCase.position.set(22, 1.5, 9.8); weaponsCase.name = "OBSTACLE_weaponsCase"; scene.add(weaponsCase); collidableObjects.push(weaponsCase);

    // Dining Room Furniture
    createFurniture('table', -5, 0, 5, 0);
    createFurniture('chair', -5, 0, 3, 0);
    createFurniture('chair', -5, 0, 7, Math.PI);

    // Garage & Detailed Car
    createWall(-20, 0, 0, 20, 4, 0.5); 
    createWall(-10, 0, -10, 20, 4, 0.5, Math.PI/2); 
    
    const carGroup = new THREE.Group();
    const carBody = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 8), new THREE.MeshStandardMaterial({color: 0x1111aa})); carBody.position.set(-20, 1, -10); carGroup.add(carBody);
    const carTop = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 4), new THREE.MeshStandardMaterial({color: 0x1111aa})); carTop.position.set(-20, 2.1, -10.5); carGroup.add(carTop);
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4), new THREE.MeshStandardMaterial({color: 0x111111})); w1.position.set(-17.8, 0.6, -7); w1.rotation.z = Math.PI/2; carGroup.add(w1);
    const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4), new THREE.MeshStandardMaterial({color: 0x111111})); w2.position.set(-22.2, 0.6, -7); w2.rotation.z = Math.PI/2; carGroup.add(w2);
    const w3 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4), new THREE.MeshStandardMaterial({color: 0x111111})); w3.position.set(-17.8, 0.6, -13); w3.rotation.z = Math.PI/2; carGroup.add(w3);
    const w4 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4), new THREE.MeshStandardMaterial({color: 0x111111})); w4.position.set(-22.2, 0.6, -13); w4.rotation.z = Math.PI/2; carGroup.add(w4);
    carGroup.name = "OBSTACLE_car"; scene.add(carGroup); collidableObjects.push(carBody, carTop);

    // Stairs Down to Basement
    createRamp(15, -2, -15, 4, 12, Math.PI / 5);
    createDoor('basement_top', 13, 0, -9, 4, 3.8, 0, 1);

    // ------------------------------------------
    // FLOOR 1: BASEMENT (Y = -4)
    // ------------------------------------------
    createFloorSection(15, -4, -25, 30, 30);
    createCeilingSection(15, 0, -25, 30, 30); 
    createWall(15, -4, -40, 30, 4, 0.5); 
    createWall(0, -4, -25, 30, 4, 0.5, Math.PI/2); 
    createWall(30, -4, -25, 30, 4, 0.5, Math.PI/2); 
}
// --- CONTINUING FROM PART 2 ---

// ==========================================
// 9. MULTIPLAYER AVATAR GENERATOR
// ==========================================
function createPlayerAvatar(id, username, colors) {
    const group = new THREE.Group();
    
    const bodyMat = new THREE.MeshStandardMaterial({color: colors ? colors.shirt : '#2244aa'});
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), bodyMat); 
    body.position.y = 1.0; group.add(body);
    
    const pantsMat = new THREE.MeshStandardMaterial({color: colors ? colors.pants : '#111111'});
    const pants = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.4), pantsMat); 
    pants.position.y = 0.3; group.add(pants);
    
    const skinMat = new THREE.MeshStandardMaterial({color: colors ? colors.skin : '#ffccaa'});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat); 
    head.position.y = 1.65; group.add(head);
    
    const hairMat = new THREE.MeshStandardMaterial({color: colors ? colors.hair : '#221100'});
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.55), hairMat); 
    hair.position.y = 1.95; group.add(hair);

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.font = '32px Courier Prime'; ctx.textAlign = 'center'; 
    ctx.fillText(username, 128, 40);
    
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.y = 2.4; sprite.scale.set(2, 0.5, 1); group.add(sprite);

    group.name = id; group.userData = { isHiding: false };
    scene.add(group); return group;
}

// ==========================================
// 10. ITEM GENERATION & PHYSICS SETUP
// ==========================================
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
    
    // Add physics properties for gravity drops
    group.userData = { velocity: new THREE.Vector3(0,0,0), isFalling: false };
    return group;
}

function buildItems(presetData) {
    if (!presetData || !presetData.items) return;
    for (const [id, data] of Object.entries(presetData.items)) {
        const mesh = createItemMesh(id);
        mesh.position.set(data.pos.x, data.pos.y, data.pos.z);
        mesh.name = `ITEM_${id}`;
        mesh.visible = data.visible;
        scene.add(mesh);
        itemMeshes[id] = mesh;
    }
}

// ==========================================
// 11. AI MODELS (TUNG TUNG & SPIDER)
// ==========================================
function createTungTungModel() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ map: wallMat.map, color: 0x5c4033 });
    
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
    // Spawn in Basement to start
    granny.position.set(15, -4, -30); 
    scene.add(granny);
}

function createSpiderModel() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({color: 0x111111, roughness: 0.9});
    
    // Thorax & Abdomen
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), bodyMat);
    body.position.y = 0.8; group.add(body);
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 16), bodyMat);
    abdomen.position.set(0, 1.0, -1.2); group.add(abdomen);

    // 8 Red Eyes
    const eyeMat = new THREE.MeshBasicMaterial({color: 0xff0000});
    for(let i=0; i<4; i++) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1), eyeMat);
        eye.position.set(-0.3 + (i*0.2), 1.2, 0.7); group.add(eye);
    }

    // 8 Creepy Legs
    const legMat = new THREE.MeshStandardMaterial({color: 0x0a0a0a});
    for(let i=0; i<8; i++) {
        const legGroup = new THREE.Group();
        const legPart1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5), legMat);
        legPart1.position.y = 0.75; legGroup.add(legPart1);
        
        const angle = (i / 8) * Math.PI * 2;
        legGroup.position.set(Math.cos(angle) * 0.8, 0.5, Math.sin(angle) * 0.8);
        legGroup.lookAt(Math.cos(angle) * 2, -1, Math.sin(angle) * 2);
        legGroup.rotateX(Math.PI/2);
        group.add(legGroup);
    }
    return group;
}

function spawnSpider() {
    spider = createSpiderModel();
    spider.position.set(-5, 16, -15); // Attic spider room
    scene.add(spider);
}
// --- CONTINUING FROM PART 3 ---

// ==========================================
// 12. DOMAIN EXPANSION: INFINITE VOID
// ==========================================
function triggerDomainExpansion(pos) {
    if (domainActive) return;
    domainActive = true;
    domainTimer = 12.0; 
    domainCooldown = 37.0; 

    // The Black Hole Sphere (Inverted)
    const geo = new THREE.SphereGeometry(15, 32, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    domainSphere = new THREE.Mesh(geo, mat);
    domainSphere.position.copy(pos);
    scene.add(domainSphere);

    // The Particle "Scat" Effect
    const partGeo = new THREE.BufferGeometry();
    const partCount = 500;
    const posArray = new Float32Array(partCount * 3);
    for(let i=0; i < partCount * 3; i++) posArray[i] = (Math.random() - 0.5) * 2;
    partGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const partMat = new THREE.PointsMaterial({ color: 0x5c4033, size: 0.2 }); 
    domainParticles = new THREE.Points(partGeo, partMat);
    domainParticles.position.copy(pos);
    scene.add(domainParticles);

    // Audio Cue (Deep bass sweep)
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(50, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 2);
    osc.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 2);

    const uiDomain = document.getElementById('domain-display');
    if (uiDomain) {
        uiDomain.innerText = "DOMAIN EXPANSION: ACTIVE!";
        uiDomain.style.color = "#ff0000";
    }
}

function updateDomain(delta) {
    const uiDomain = document.getElementById('domain-display');
    if (domainCooldown > 0) {
        domainCooldown -= delta;
        if (!domainActive && hasDomain && uiDomain) {
            uiDomain.innerText = `DOMAIN COOLDOWN: ${Math.ceil(domainCooldown)}s`;
            uiDomain.style.color = "#aaaaaa";
        }
    } else if (hasDomain && !domainActive && uiDomain) {
        uiDomain.innerText = "DOMAIN EXPANSION: READY [J]";
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

// ==========================================
// 13. ADVANCED RAYCASTER & INTERACTIONS
// ==========================================
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
let currentTarget = null;
let carState = { gas: false, battery: false, key: false };

function checkInteractions() {
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    currentTarget = null;
    const uiInteract = document.getElementById('interact-prompt');
    if (!uiInteract) return;

    uiInteract.innerText = isHiding ? "HIDING (Press E to exit)" : "";

    if (intersects.length > 0 && !isHiding) {
        let obj = intersects[0].object;
        while (obj.parent && obj.parent.type !== 'Scene') {
            if (obj.name.startsWith("ITEM_") || obj.name.startsWith("OBSTACLE_") || obj.name.startsWith("INTERACT_") || obj.name.startsWith("KNOCKABLE_")) break;
            obj = obj.parent;
        }

        if (intersects[0].distance < 3.0) {
            if (obj.name.startsWith("ITEM_") && obj.visible) {
                const itemName = obj.name.replace("ITEM_", "");
                if (itemName.startsWith("arrow") && inventory === 'crossbow') uiInteract.innerText = "Press E to Load Arrow";
                else uiInteract.innerText = `Press E to pick up ${itemName.replace('_', ' ')}`;
                currentTarget = { type: 'item', id: itemName, obj: obj };
            } 
            else if (obj.name.startsWith("INTERACT_wardrobe")) {
                uiInteract.innerText = "Press E to Customize Character";
                currentTarget = { type: 'wardrobe', obj: obj };
            }
            else if (obj.name.startsWith("INTERACT_door_")) {
                const doorId = obj.name.replace("INTERACT_door_", "");
                const action = doors[doorId].isOpen ? "Close" : "Open";
                uiInteract.innerText = `Press E to ${action} Door`;
                currentTarget = { type: 'door', id: doorId, obj: obj };
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
                    
                    if (inventory === 'gas_can' || inventory === 'battery' || inventory === 'car_key') currentTarget = { type: 'car', id: inventory, obj: obj };
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

window.performInteraction = function() {
    if (isHiding) {
        isHiding = false; camera.position.set(-3, 9.7, 1); // Stand up next to bed
        if (isMultiplayer && socket) socket.emit('setHiding', false);
        return;
    }

    if (!currentTarget) return;
    const uiInventory = document.getElementById('inventory-text');
    const uiAmmo = document.getElementById('ammo-display');
    const btnShoot = document.getElementById('btn-mobile-shoot');

    if (currentTarget.type === 'item') {
        if (currentTarget.id.startsWith("arrow") && inventory === 'crossbow') {
            ammo++; if(uiAmmo) uiAmmo.innerText = `ARROWS: ${ammo}`;
            if (isMultiplayer && socket) socket.emit('itemAction', { itemId: currentTarget.id, action: 'pickup' });
            else currentTarget.obj.visible = false;
            return; 
        }

        if (inventory) dropItem();
        inventory = currentTarget.id;
        if(uiInventory) uiInventory.innerText = `Holding: ${inventory.replace('_', ' ')}`;
        
        if (inventory === 'crossbow') {
            if(uiAmmo) { uiAmmo.classList.remove('hidden'); uiAmmo.innerText = `ARROWS: ${ammo}`; }
            if(btnShoot) btnShoot.classList.remove('hidden');
        } else {
            if(uiAmmo) uiAmmo.classList.add('hidden'); 
            if(btnShoot) btnShoot.classList.add('hidden');
        }

        if (isMultiplayer && socket) socket.emit('itemAction', { itemId: inventory, action: 'pickup' });
        else currentTarget.obj.visible = false;
    } 
    else if (currentTarget.type === 'wardrobe') {
        const uiWardrobe = document.getElementById('wardrobe-menu');
        if(uiWardrobe) uiWardrobe.classList.remove('hidden');
        if (!mobileEnabled) controls.unlock();
    }
    else if (currentTarget.type === 'door') {
        const doorId = currentTarget.id;
        doors[doorId].isOpen = !doors[doorId].isOpen;
        playSynthesizedSound('drop', 5); // Door creak placeholder
        if (isMultiplayer && socket) socket.emit('doorAction', { id: doorId, open: doors[doorId].isOpen });
    }
    else if (currentTarget.type === 'car') {
        const part = currentTarget.id;
        if (part === 'gas_can') carState.gas = true;
        if (part === 'battery') carState.battery = true;
        if (part === 'car_key') carState.key = true;

        if (isMultiplayer && socket) socket.emit('carPartAdded', part.split('_')[0]); 
        else { if (carState.gas && carState.battery && carState.key) winGame('Car'); }
        inventory = null; if(uiInventory) uiInventory.innerText = `Holding: Nothing`;
    }
    else if (currentTarget.type === 'obstacle') {
        if (currentTarget.id === 'bed') {
            isHiding = true; camera.position.set(-3, 8.2, -1); // Move camera under bed
            if (isMultiplayer && socket) socket.emit('setHiding', true);
            return;
        }

        if (isMultiplayer && socket) socket.emit('puzzleSolved', { obstacleId: currentTarget.id });
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
        inventory = null; if(uiInventory) uiInventory.innerText = `Holding: Nothing`;
    }
};

// ==========================================
// 14. GRAVITY ITEM DROPS
// ==========================================
window.dropItem = function() {
    if (!inventory || isHiding) return;
    
    const dropPos = new THREE.Vector3();
    camera.getWorldDirection(dropPos);
    const tossVelocity = new THREE.Vector3(dropPos.x * 4, 2, dropPos.z * 4); // Toss forward and up
    dropPos.multiplyScalar(1.0).add(camera.position);

    const mesh = itemMeshes[inventory];
    if(mesh) {
        mesh.position.copy(dropPos);
        mesh.userData.velocity = tossVelocity;
        mesh.userData.isFalling = true;
        if (!physicsItems.includes(mesh)) physicsItems.push(mesh);
    }

    // Noise Event for AI
    window.noiseTarget = dropPos.clone();
    window.noiseTimer = 8.0; 
    
    if (isMultiplayer && socket) {
        socket.emit('itemAction', { itemId: inventory, action: 'drop', pos: dropPos });
        socket.emit('noise', dropPos);
    } else {
        if(mesh) mesh.visible = true;
    }
    
    inventory = null; 
    const uiInventory = document.getElementById('inventory-text');
    if(uiInventory) uiInventory.innerText = `Holding: Nothing`;
    
    const uiAmmo = document.getElementById('ammo-display');
    const btnShoot = document.getElementById('btn-mobile-shoot');
    if(uiAmmo) uiAmmo.classList.add('hidden'); 
    if(btnShoot) btnShoot.classList.add('hidden');
};

// ==========================================
// 15. CROSSBOW SHOOTING & PROJECTILE PHYSICS
// ==========================================
window.shootCrossbow = function() {
    if (inventory !== 'crossbow' || ammo <= 0 || tungTungKnockedOut || isKillingPlayer) return;
    ammo--; 
    const uiAmmo = document.getElementById('ammo-display');
    if(uiAmmo) uiAmmo.innerText = `ARROWS: ${ammo}`;

    playSynthesizedSound('shoot', 0);

    const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8), new THREE.MeshStandardMaterial({color: 0x8b4513}));
    arrow.rotation.x = Math.PI / 2;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    arrow.position.copy(camera.position).add(dir.clone().multiplyScalar(0.5)); 
    arrow.lookAt(camera.position.clone().add(dir));
    arrow.userData = { velocity: dir.multiplyScalar(30) }; // Fast projectile
    scene.add(arrow); activeProjectiles.push(arrow);
};

function triggerTungTungKnockout() {
    if (!granny || tungTungKnockedOut || isKillingPlayer) return;
    tungTungKnockedOut = true; tungTungKnockoutTimer = 90.0; 
    granny.rotation.x = -Math.PI / 2; // Ragdoll faceplant
    
    // Snap to nearest floor so he doesn't float
    if (granny.position.y > 4) granny.position.y = 8.5; 
    else if (granny.position.y > -2) granny.position.y = 0.5; 
    else granny.position.y = -3.5; 
}
// --- CONTINUING FROM PART 4 ---

// ==========================================
// 16. TUNG TUNG & SPIDER AI
// ==========================================
const tungTungWaypoints = [
    new THREE.Vector3(0, 8, 0), new THREE.Vector3(10, 8, 5), new THREE.Vector3(20, 8, 0), // Upstairs
    new THREE.Vector3(0, 0, 15), new THREE.Vector3(-10, 0, -5), new THREE.Vector3(20, 0, 5), // Main Floor
    new THREE.Vector3(15, -4, -30), new THREE.Vector3(5, -4, -25), // Basement
    new THREE.Vector3(0, 16, 0), new THREE.Vector3(15, 16, 20) // Attic
];
let currentWaypoint = tungTungWaypoints[0];

function updateTungTungAI(delta) {
    if (!granny || isDead || domainActive) return; 

    if (isKillingPlayer) {
        camera.lookAt(granny.position.x, granny.position.y + 2.7, granny.position.z);
        const leftArm = granny.getObjectByName("LeftArm"); const rightArm = granny.getObjectByName("RightArm");
        if (leftArm && leftArm.rotation.x > -Math.PI/2) leftArm.rotation.x -= delta * 5;
        if (rightArm && rightArm.rotation.x > -Math.PI/2) rightArm.rotation.x -= delta * 5;
        return;
    }

    if (tungTungKnockedOut) {
        tungTungKnockoutTimer -= delta;
        if (tungTungKnockoutTimer <= 0) {
            tungTungKnockedOut = false; granny.rotation.x = 0; 
            granny.position.set(15, -4, -30); tungTungState = 'patrol'; // Respawn in basement
        }
        return;
    }

    let targetPos = null; let minDistance = Infinity; let playerSpotted = false;

    // 1. Agro System (Eyes)
    if (isMultiplayer) {
        for (const [id, pMesh] of Object.entries(remotePlayers)) {
            if (pMesh.userData.isHiding) continue; 
            const dist = granny.position.distanceTo(pMesh.position);
            if (dist < 18) { minDistance = dist; targetPos = pMesh.position; playerSpotted = true; }
        }
    }
    if (!isHiding) {
        const dist = granny.position.distanceTo(camera.position);
        if (dist < 18) { minDistance = dist; targetPos = camera.position; playerSpotted = true; }
    }

    // 2. State Machine
    if (playerSpotted) tungTungState = 'chase';
    else if (window.noiseTarget && window.noiseTimer > 0) {
        tungTungState = 'investigate'; targetPos = window.noiseTarget; window.noiseTimer -= delta;
        if (granny.position.distanceTo(window.noiseTarget) < 2.0) window.noiseTarget = null;
    } else {
        if (tungTungState === 'chase' || tungTungState === 'investigate') { tungTungState = 'lookAround'; tungTungWaitTimer = 3.0; }
    }

    if (tungTungState === 'lookAround') {
        tungTungWaitTimer -= delta; granny.rotation.y += delta * 1.5; 
        if (tungTungWaitTimer <= 0) { tungTungState = 'patrol'; currentWaypoint = tungTungWaypoints[Math.floor(Math.random() * tungTungWaypoints.length)]; }
        return; 
    }

    if (tungTungState === 'patrol') {
        targetPos = currentWaypoint;
        if (granny.position.distanceTo(targetPos) < 2.0) { tungTungState = 'lookAround'; tungTungWaitTimer = 2.0; }
    }

    // 3. Movement & Floor Raycasting
    if (targetPos) {
        // AI Floor Raycaster (Smooth Stairs for Tung Tung)
        const rayOrigin = new THREE.Vector3(granny.position.x, granny.position.y + 2, granny.position.z);
        floorRaycaster.set(rayOrigin, downVector);
        const floorIntersects = floorRaycaster.intersectObjects(floorMeshes);
        if (floorIntersects.length > 0) {
            granny.position.y += (floorIntersects[0].point.y - granny.position.y) * 10 * delta; 
        }

        const lookTarget = new THREE.Vector3(targetPos.x, granny.position.y, targetPos.z);
        granny.lookAt(lookTarget);
        
        const speed = (tungTungState === 'chase') ? (isMultiplayer ? 4.5 : 4.0) : 2.0; 
        granny.translateZ(speed * delta);

        if (tungTungState === 'chase' && targetPos === camera.position && minDistance < 1.5 && !isHiding) startKillAnimation();
    }
}

function updateSpiderAI(delta) {
    if (!spider || isDead || domainActive) return;
    const dist = spider.position.distanceTo(camera.position);
    if (dist < 10 && camera.position.y > 12) { // Only agro if player is in the attic
        spider.lookAt(camera.position.x, spider.position.y, camera.position.z);
        spider.translateZ(5.0 * delta); // Very fast!
        if (dist < 1.5 && !isHiding) startKillAnimation();
    }
}

function startKillAnimation() {
    isKillingPlayer = true; moveForward = false; moveBackward = false; moveLeft = false; moveRight = false;
    if (!mobileEnabled) controls.unlock();
    
    playSynthesizedSound('shoot', 0); // Jumpscare placeholder
    setTimeout(triggerDeath, 1500); 
}

// ==========================================
// 17. DEATH, RESPAWN, & WIN LOGIC
// ==========================================
function triggerDeath() {
    if (isDead) return;
    isDead = true; isKillingPlayer = false; lives--; currentDay++;
    if (isMultiplayer && socket) socket.emit('playerDied');

    const uiGame = document.getElementById('game-ui');
    const uiDeath = document.getElementById('death-screen');
    const uiDayText = document.getElementById('day-text');
    
    if(uiGame) uiGame.classList.add('hidden');
    if(uiDeath) uiDeath.classList.remove('hidden');
    
    if (lives > 0) {
        if(uiDayText) uiDayText.innerText = `DAY ${currentDay}`;
        setTimeout(respawnPlayer, 3000);
    } else {
        if(uiDayText) { uiDayText.innerText = "GAME OVER"; uiDayText.style.color = "#ff0000"; }
        if (!isMultiplayer) setTimeout(() => location.reload(), 3000);
    }
}

function respawnPlayer() {
    isDead = false; isHiding = false; isCrouching = false;
    const uiGame = document.getElementById('game-ui');
    const uiDeath = document.getElementById('death-screen');
    const uiLives = document.getElementById('lives-display');
    
    if(uiDeath) uiDeath.classList.add('hidden');
    if(uiGame) uiGame.classList.remove('hidden');
    if(uiLives) uiLives.innerText = `DAYS REMAINING: ${lives}`;
    
    camera.position.set(0, 9.7, 2); // Respawn UPSTAIRS
    camera.rotation.set(0, 0, 0);
    
    if (granny && !isMultiplayer) {
        granny.position.set(15, -4, -30); 
        tungTungKnockedOut = false; tungTungState = 'patrol'; granny.rotation.x = 0;
        const leftArm = granny.getObjectByName("LeftArm"); const rightArm = granny.getObjectByName("RightArm");
        if (leftArm) leftArm.rotation.x = Math.PI / 8; if (rightArm) rightArm.rotation.x = -Math.PI / 8;
    }
    if (!mobileEnabled) controls.lock();
}

window.winGame = function(type) {
    alert(`ESCAPE SUCCESSFUL! You escaped via the ${type}!`);
    location.reload();
};

// ==========================================
// 18. MAIN PHYSICS & ANIMATION LOOP
// ==========================================
window.animate = function() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    if(typeof updateDomain === 'function') updateDomain(delta);
    if(typeof manageChaseMusic === 'function') manageChaseMusic();

    // Animate Doors
    for (const id in doors) {
        const door = doors[id];
        const targetRot = door.isOpen ? door.openRot : door.closedRot;
        door.currentRot += (targetRot - door.currentRot) * 8 * delta;
        door.pivot.rotation.y = door.currentRot;
    }

    if (!isDead && !isKillingPlayer && (controls.isLocked || mobileEnabled)) {
        if(typeof checkInteractions === 'function') checkInteractions();

        if (!isHiding && !domainActive) {
            const oldPosition = camera.position.clone();

            // 1. Player Velocity & Friction
            velocity.x -= velocity.x * 10.0 * delta;
            velocity.z -= velocity.z * 10.0 * delta;

            direction.z = Number(moveForward) - Number(moveBackward);
            direction.x = Number(moveRight) - Number(moveLeft);
            direction.normalize();

            if (mobileEnabled) { direction.x += mobileMoveData.x; direction.z -= mobileMoveData.y; }

            const currentSpeed = isCrouching ? 15.0 : (isSprinting ? 45.0 : 25.0); 
            if (moveForward || moveBackward || mobileMoveData.y !== 0) velocity.z -= direction.z * currentSpeed * delta;
            if (moveLeft || moveRight || mobileMoveData.x !== 0) velocity.x -= direction.x * currentSpeed * delta;

            controls.moveRight(-velocity.x * delta);
            controls.moveForward(-velocity.z * delta);

            // 2. Wall Collisions (AABB)
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

            // 3. Floor Raycaster (Smooth Stairs)
            const rayOrigin = new THREE.Vector3(camera.position.x, camera.position.y + 2, camera.position.z);
            floorRaycaster.set(rayOrigin, downVector);
            const floorIntersects = floorRaycaster.intersectObjects(floorMeshes);
            
            if (floorIntersects.length > 0) {
                const targetHeight = floorIntersects[0].point.y + (isCrouching ? 0.8 : 1.7);
                camera.position.y += (targetHeight - camera.position.y) * 15 * delta; 
            } else {
                if (camera.position.y < -10) camera.position.y = 9.7; // Void safety net
            }
        }

        // 4. Gravity Item Drops Physics
        for (let i = physicsItems.length - 1; i >= 0; i--) {
            const item = physicsItems[i];
            if (item.userData.isFalling) {
                item.userData.velocity.y -= 15.0 * delta; // Gravity
                item.position.add(item.userData.velocity.clone().multiplyScalar(delta));
                
                floorRaycaster.set(new THREE.Vector3(item.position.x, item.position.y + 1, item.position.z), downVector);
                const floorHits = floorRaycaster.intersectObjects(floorMeshes);
                
                if (floorHits.length > 0 && item.position.y <= floorHits[0].point.y + 0.2) {
                    item.position.y = floorHits[0].point.y + 0.2;
                    item.userData.isFalling = false;
                    playSynthesizedSound('drop', camera.position.distanceTo(item.position));
                    physicsItems.splice(i, 1); 
                }
            }
        }

        // 5. Arrow Projectile Physics
        for (let i = activeProjectiles.length - 1; i >= 0; i--) {
            const arrow = activeProjectiles[i];
            arrow.userData.velocity.y -= 5.0 * delta; // Slight arrow drop
            arrow.position.add(arrow.userData.velocity.clone().multiplyScalar(delta));
            
            const arrowBox = new THREE.Box3().setFromObject(arrow);
            let hitSomething = false;

            if (granny && !tungTungKnockedOut) {
                const grannyBox = new THREE.Box3().setFromObject(granny);
                if (arrowBox.intersectsBox(grannyBox)) {
                    triggerTungTungKnockout();
                    if (isMultiplayer && socket) socket.emit('shootTungTung');
                    hitSomething = true;
                }
            }

            if (!hitSomething) {
                for (let w = 0; w < collidableObjects.length; w++) {
                    const wallBox = new THREE.Box3().setFromObject(collidableObjects[w]);
                    if (arrowBox.intersectsBox(wallBox)) { 
                        // Bounce and become a physics item
                        arrow.userData.velocity.set((Math.random()-0.5)*5, 2, (Math.random()-0.5)*5);
                        arrow.userData.isFalling = true;
                        arrow.name = `ITEM_arrow_${Math.floor(Math.random()*1000)}`; // Make collectible again
                        physicsItems.push(arrow);
                        hitSomething = true; break; 
                    }
                }
            }

            if (hitSomething) activeProjectiles.splice(i, 1);
        }

        updateTungTungAI(delta);
        updateSpiderAI(delta);

        if (isMultiplayer && socket && socket.connected) {
            socket.emit('move', { pos: camera.position, rot: camera.rotation.y, crouch: isCrouching });
        }
    }

    renderer.render(scene, camera);
};

// ==========================================
// 19. MULTIPLAYER SOCKET SYNC
// ==========================================
window.connectToServer = function(username) {
    socket = io();
    socket.on('connect', () => {
        socket.emit('setUsername', username);
        socket.emit('updateWardrobe', myCustomization);
    });

    socket.on('init', (data) => {
        myId = data.id;
        hasDomain = data.players[myId].hasDomain;
        const uiDomain = document.getElementById('domain-display');
        if (hasDomain && uiDomain) uiDomain.classList.remove('hidden');

        buildHouse();
        // Server sends a preset index, we map it locally
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
        spawnSpider();

        for (const [doorId, isOpen] of Object.entries(data.gameState.doors)) {
            if (doors[doorId]) doors[doorId].isOpen = isOpen;
        }

        for (const [id, pData] of Object.entries(data.players)) {
            if (id !== myId && !pData.isDead) {
                remotePlayers[id] = createPlayerAvatar(id, pData.username, pData.colors);
                remotePlayers[id].position.copy(pData.pos);
                if (pData.isHiding) remotePlayers[id].visible = false;
                if (pData.crouch) remotePlayers[id].scale.y = 0.5; 
            }
        }
        if (!mobileEnabled) controls.lock();
        animate();
    });

    socket.on('playerJoined', (pData) => remotePlayers[pData.id] = createPlayerAvatar(pData.id, pData.username, pData.colors));
    socket.on('playerUpdated', (data) => {
        if (remotePlayers[data.id]) {
            scene.remove(remotePlayers[data.id]);
            remotePlayers[data.id] = createPlayerAvatar(data.id, data.username, data.colors);
        }
    });
    
    socket.on('playerMoved', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].position.copy(data.pos);
            remotePlayers[data.id].rotation.y = data.rot;
            remotePlayers[data.id].scale.y = data.crouch ? 0.5 : 1.0;
        }
    });

    socket.on('doorSync', (data) => { if (doors[data.id]) doors[data.id].isOpen = data.open; });
    socket.on('attractTung', (pos) => { window.noiseTarget = new THREE.Vector3(pos.x, pos.y, pos.z); window.noiseTimer = 8.0; });
    socket.on('tungTungKnockedOut', triggerTungTungKnockout);
    socket.on('domainActivated', (data) => triggerDomainExpansion(new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z)));
    socket.on('playerLeft', (id) => { if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }});
}

// ==========================================
// 20. PAUSE MENU LOGIC
// ==========================================
const uiPause = document.getElementById('pause-menu');
const uiWardrobe = document.getElementById('wardrobe-menu');

document.getElementById('pause-btn')?.addEventListener('click', () => {
    if (!isMultiplayer && !mobileEnabled) controls.unlock();
    if(uiPause) uiPause.classList.remove('hidden');
});

document.getElementById('btn-resume')?.addEventListener('click', () => {
    if(uiPause) uiPause.classList.add('hidden');
    if (!isMultiplayer && !mobileEnabled) controls.lock();
});

document.getElementById('btn-leave')?.addEventListener('click', () => location.reload());

if (controls) {
    controls.addEventListener('lock', () => { 
        if(uiPause) uiPause.classList.add('hidden'); 
        if(uiWardrobe) uiWardrobe.classList.add('hidden'); 
    });
    controls.addEventListener('unlock', () => {
        const uiMainMenu = document.getElementById('main-menu');
        if (!isDead && !isKillingPlayer && uiMainMenu && uiMainMenu.classList.contains('hidden') && uiWardrobe && uiWardrobe.classList.contains('hidden')) {
            if(uiPause) uiPause.classList.remove('hidden');
        }
    });
}
