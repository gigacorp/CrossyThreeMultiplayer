import * as THREE from 'three';
// import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
// import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { Client, Room } from 'colyseus.js';
import { createCamera, updateCameraFrustum, updateCameraPosition, focusOnPosition } from './camera';
import { createPlayer, processMoveQueue } from './player';
import { createGrass } from './grass';
import { createGroundText } from './text';
import { 
    MAP_WIDTH, MAP_HEIGHT, MAP_HALF_WIDTH, MAP_HALF_HEIGHT,
    MOVE_DURATION, MOVE_DISTANCE, JUMP_HEIGHT,
    SWIPE_THRESHOLD, TAP_THRESHOLD, BLOCK_SIZE,
    ROTATION_LERP_FACTOR
} from './constants';
import { GameState, Player as PlayerSchema, MoveMessage, PlayerMoveCommand } from './schema';
import { MoveCommand, Workspace, PlayerRepresentation, Toolbox } from './client-types';
import { MinigameManager } from './minigames/minigameManager';
import { ToolboxImpl } from './studio/ToolboxImpl';

// Add these declarations at the top of the file, after imports
let animationFrameId: number = 0;
let room: Room<GameState> | null = null;

// Event handler declarations
function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    updateCameraFrustum(camera);
}

function onKeyDown(event: KeyboardEvent) {
    if (isMoving) return;
    if (event.repeat) return;
    
    let movement: { x: number; z: number } | null = null;
    switch(event.key) {
        case 'ArrowLeft':
            movement = {x: -MOVE_DISTANCE, z: 0};
            break;
        case 'ArrowRight':
            movement = {x: MOVE_DISTANCE, z: 0};
            break;
        case 'ArrowUp':
            movement = {x: 0, z: -MOVE_DISTANCE};
            break;
        case 'ArrowDown':
            movement = {x: 0, z: MOVE_DISTANCE};
            break;
    }
    
    if (movement) {
        queueMove({
            x: movement.x / MOVE_DISTANCE,
            z: movement.z / MOVE_DISTANCE
        });
    }
}

function onKeyUp(event: KeyboardEvent) {
    // No need for keyup handler currently
}

function onTouchStart(event: TouchEvent) {
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    touchStartTime = Date.now();
    event.preventDefault();
}

function onTouchMove(event: TouchEvent) {
    event.preventDefault();
}

function onTouchEnd(event: TouchEvent) {
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const touchEndTime = Date.now();
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const deltaTime = touchEndTime - touchStartTime;
    
    if (Math.abs(deltaX) > SWIPE_THRESHOLD || Math.abs(deltaY) > SWIPE_THRESHOLD) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            if (deltaX > 0) {
                queueMove({ x: 1, z: 0 });
            } else {
                queueMove({ x: -1, z: 0 });
            }
        } else {
            if (deltaY > 0) {
                queueMove({ x: 0, z: 1 });
            } else {
                queueMove({ x: 0, z: -1 });
            }
        }
    } else if (deltaTime < TAP_THRESHOLD) {
        queueMove({ x: 0, z: -1 });
    }
    
    event.preventDefault();
}

// Scene setup
const scene = new THREE.Scene();
// scene.background = new THREE.Color(0x87CEEB); // REMOVE: Sky Blue background for testing
const camera = createCamera();

// Find the canvas element
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;

// Check if canvas exists before creating renderer
if (!canvas) {
    console.error("CRITICAL: Could not find canvas element with ID 'gameCanvas'!");
}

const renderer = new THREE.WebGLRenderer({
    canvas: canvas || undefined, // Pass canvas element directly
    antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

// Add some instructions text (Will be overridden by minigame)
// const instructionsText = createGroundText('Use arrow keys to move', new THREE.Vector3(0, 0, MAP_HALF_HEIGHT+10), '#ffffff')
// if (instructionsText) {
//     scene.add(instructionsText);
// }

// Add finish line text (Will be overridden by minigame)
// const finishText = createGroundText('The end', new THREE.Vector3(0, 0, -MAP_HALF_HEIGHT-10), '#ffffff');
// if (finishText) {
//     scene.add(finishText);
// }

// Create grass field
const grassField = createGrass();
scene.add(grassField);

// Player setup
const localPlayerMesh = createPlayer(); // Create the mesh first
let localPlayer: PlayerRepresentation | null = null; // Will be populated once ID is received
localPlayerMesh.position.set(0, 0, MAP_HALF_HEIGHT-BLOCK_SIZE/2); 
scene.add(localPlayerMesh); // Add mesh to scene
focusOnPosition(camera, localPlayerMesh.position); // Focus camera on initial mesh position

// Minigame Setup
const minigameManager = new MinigameManager();

// Initialize toolbox with implementation
const toolbox: Toolbox = new ToolboxImpl(scene);

// Function to create the ClientGameState object
function getCurrentGameState(): Workspace | null { // Return null if localPlayer not set
    if (!localPlayer) return null;
    return {
        scene: scene,
        localPlayer: localPlayer, // Use the full representation
        otherPlayers: Array.from(otherPlayers.values()), // Convert Map values to Array
        toolbox: toolbox // Include the toolbox
    };
}

// Call minigame manager when local player spawns (now happens when ID received)
// minigameManager.onPlayerDidSpawn(player); // Removed - Handled later

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight();
directionalLight.position.set(-200, 200, 0);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 50;
directionalLight.shadow.camera.far = 400;
directionalLight.shadow.camera.left = -400;
directionalLight.shadow.camera.right = 400;
directionalLight.shadow.camera.top = 400;
directionalLight.shadow.camera.bottom = -400;
directionalLight.target.updateMatrixWorld();

const lightTarget = new THREE.Object3D();
lightTarget.position.copy(localPlayerMesh.position);
scene.add(lightTarget);
directionalLight.target = lightTarget;

const ambientLight2 = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight2);

scene.add(directionalLight);

// Movement queue for the local player
const moveQueue: MoveCommand[] = [];
let isMoving = false;

// Touch controls
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

// Multiplayer setup
const client = new Client(window.location.protocol === 'https:' 
    ? `wss://${window.location.hostname}`
    : `ws://${window.location.hostname}:3000`);

let playerId: string | null = null;
// Update otherPlayers Map to store PlayerRepresentation
const otherPlayers = new Map<string, PlayerRepresentation>(); 
const otherPlayersMoveQueues = new Map<string, MoveCommand[]>(); 
const clock = new THREE.Clock(); 

// Function to synchronize local player meshes with server state
function syncPlayerState(state: GameState) { 
    if (!playerId || !room) { 
        console.warn('syncPlayerState called before playerId or room was set. Skipping update.');
        return; 
    }
    updatePlayerCount(state.playerCount);

    const playersInServerState = new Set<string>();

    // Create or update players based on server state
    state.players.forEach((playerSchema: PlayerSchema, id: string) => { 
        playersInServerState.add(id); 

        if (id === playerId) { 
            // Ensure local player representation is initialized if not already
            if (!localPlayer) {
                localPlayer = { id: playerId, mesh: localPlayerMesh };
                console.log(`Initialized local PlayerRepresentation for ID: ${playerId}`);
                // Now notify minigame manager about local player spawn
                minigameManager.onPlayerDidSpawn(localPlayer.mesh);
                focusOnPosition(camera, localPlayer.mesh.position);
            }
            return;
        }

        // Handle other players
        let otherPlayerRep = otherPlayers.get(id);
        let isNewPlayer = false; 
        if (!otherPlayerRep) {
            isNewPlayer = true; 
            console.log(`Sync: Creating representation for player ${id}`);
            const newMesh = createPlayer(); // Create a new mesh
            otherPlayerRep = { id: id, mesh: newMesh }; // Create representation
            scene.add(otherPlayerRep.mesh); // Add mesh to scene
            otherPlayers.set(id, otherPlayerRep); // Store representation
            if (!otherPlayersMoveQueues.has(id)) {
                otherPlayersMoveQueues.set(id, []);
            }
        }
        // Update position and rotation from schema using the mesh inside the representation
        otherPlayerRep.mesh.position.set(playerSchema.x, playerSchema.y, playerSchema.z);
        otherPlayerRep.mesh.rotation.y = playerSchema.rotation;

        // If it's a new player, notify the minigame manager with the mesh
        if (isNewPlayer) {
            minigameManager.onPlayerDidSpawn(otherPlayerRep.mesh);
        }
    });

    // Remove local representations for players NOT in the current server state
    otherPlayers.forEach((playerRep, id) => { // Iterate over representations
        if (!playersInServerState.has(id)) { 
            console.log(`Sync: Removing representation for player ${id} (not in server state)`);
            scene.remove(playerRep.mesh); // Remove the mesh
            otherPlayers.delete(id);
            otherPlayersMoveQueues.delete(id);
        }
    });
}

// Connect to server
async function connectToServer() {
    try {
        room = await client.joinOrCreate<GameState>('game_room'); 
        console.log('Connected to room:', room.roomId, 'SessionId:', room.sessionId);
        
        // Update room ID display
        const roomIdElement = document.getElementById('roomId');
        if (roomIdElement) {
            roomIdElement.textContent = `Room: ${room.roomId}`;
        }
        
        room.onMessage('playerId', (id: string) => { 
            playerId = id;
            console.log('Received player ID:', playerId);

            // Initialize localPlayer Representation now that we have the ID
            if (!localPlayer) { // Check prevents re-initialization on reconnect/message duplication
                localPlayer = { id: playerId, mesh: localPlayerMesh };
                 console.log(`Initialized local PlayerRepresentation from playerId message: ${playerId}`);
                 // Notify minigame manager about local player spawn
                 minigameManager.onPlayerDidSpawn(localPlayer.mesh);
                 focusOnPosition(camera, localPlayer.mesh.position); // Ensure camera focuses after ID received
            }

            if (room && localPlayer) { // Ensure room and localPlayer exist
                 console.log('Processing initial state after receiving playerId...');
                 syncPlayerState(room.state); // Initial sync
                 console.log('Finished processing initial state.');

                 // START THE MINIGAME HERE
                 console.log("Attempting to start default minigame...");
                 const currentGameState = getCurrentGameState(); // Get current state
                 if (currentGameState) { // Check if state is available
                     minigameManager.startMinigame('collectCoins', currentGameState); 
                 } else {
                     console.error("Cannot start minigame: ClientGameState is null.");
                 }
            } else {
                console.error('Room object or localPlayer became null unexpectedly after join/receiving ID.');
            }
        });

        // Listen for player move commands from broadcast
        room.onMessage('playerMoveCommand', (data: PlayerMoveCommand) => { // Use PlayerMoveCommand interface
            // Server already excludes sender, so no need to check playerId === data.playerId
            queueOtherPlayerMove(data.playerId, data.movement, data.startPos, data.targetPos);
        });

        // Listen for players leaving
        room.onMessage('playerLeft', (playerIdToRemove: string) => { // Type the ID
            removeOtherPlayer(playerIdToRemove);
        });

        // Listen for state changes (Handles subsequent updates)
        room.onStateChange(syncPlayerState); 

    } catch (error) {
        console.error('Failed to connect to server:', error);
    }
}

function removeOtherPlayer(playerIdToRemove: string) { 
    console.log(`Removing player ${playerIdToRemove} due to playerLeft message.`);
    const playerRep = otherPlayers.get(playerIdToRemove); // Get representation
    if (playerRep) {
        scene.remove(playerRep.mesh); // Remove mesh from representation
        otherPlayers.delete(playerIdToRemove);
        otherPlayersMoveQueues.delete(playerIdToRemove); 
    }
}

function updatePlayerCount(count: number) {
    const playerCountElement = document.getElementById('playerCount');
    if (playerCountElement) {
        playerCountElement.textContent = `Players: ${count}`;
    }
}

function queueOtherPlayerMove(playerId: string, movement: { x: number; z: number }, startPos: { x: number; z: number }, targetPos: { x: number; z: number }) {
    let playerRep = otherPlayers.get(playerId); // Get representation
    if (!playerRep) {
        console.warn(`queueOtherPlayerMove: Player representation ${playerId} not found. Creating.`);
        const newMesh = createPlayer(); 
        playerRep = { id: playerId, mesh: newMesh }; // Create representation
        scene.add(playerRep.mesh); // Add mesh
        otherPlayers.set(playerId, playerRep); // Store representation
        otherPlayersMoveQueues.set(playerId, []); 
    }

    const moveQueue = otherPlayersMoveQueues.get(playerId);
    if (moveQueue) { 
        const command: MoveCommand = { 
            movement,
            startPos,
            targetPos,
            startTime: null
        };
        moveQueue.push(command);
    } else {
        console.error(`Move queue not found for player ${playerId} in queueOtherPlayerMove`);
    }
}

// Modify the queueMove function 
function queueMove(movement: { x: number; z: number }) {
    if (!room || !localPlayer) { // Check for localPlayer representation
        console.warn('Cannot queue move, room or localPlayer representation not available.');
        return;
    }
    
    // Use localPlayer.mesh position if queue is empty
    const startPos = moveQueue.length > 0 
        ? moveQueue[moveQueue.length - 1].targetPos 
        : { x: localPlayer.mesh.position.x, z: localPlayer.mesh.position.z }; 
    
    const targetPos = {
        x: startPos.x + movement.x * MOVE_DISTANCE,
        z: startPos.z + movement.z * MOVE_DISTANCE
    };

    // Add to the local player's visual queue
    const command: MoveCommand = { 
        movement: {
            x: movement.x * MOVE_DISTANCE,
            z: movement.z * MOVE_DISTANCE
        },
        startPos,
        targetPos,
        startTime: null
    };
    moveQueue.push(command); 

    // Send movement intention to server
    const movePayload: MoveMessage = {
        movement,
        startPos,
        targetPos
    };
    room.send('move', movePayload);
}

// Override processMoveQueue to notify minigame manager
const originalProcessMoveQueue = processMoveQueue; 

// Wrapper function remains the same signature, takes Group
const processMoveQueueWithNotify = (
    queue: MoveCommand[], 
    object: THREE.Group, 
    delta: number 
): boolean => {
    const wasMoving = queue.length > 0;
    
    originalProcessMoveQueue(queue, object); // Calls original with 2 args
    
    const stillMoving = queue.length > 0;
    const justFinishedMoving = wasMoving && !stillMoving;

    if (justFinishedMoving) {
        minigameManager.onPlayerDidMove(object); // Pass the mesh
    }
    return stillMoving; 
};

// Update the animate function to remove logging
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // // --- REMOVE DEBUG LOGS ---
    // // console.log(`Camera Position: x=${camera.position.x.toFixed(2)}, y=${camera.position.y.toFixed(2)}, z=${camera.position.z.toFixed(2)}`);
    // // if (localPlayer) {
    // //     console.log(`Player Position: x=${localPlayer.mesh.position.x.toFixed(2)}, y=${localPlayer.mesh.position.y.toFixed(2)}, z=${localPlayer.mesh.position.z.toFixed(2)}`);
    // // }
    // // console.log("Scene Children Count:", scene.children.length);
    // // --- END DEBUG LOGS ---

    // Get current game state (can be null initially)
    const currentClientState = getCurrentGameState(); 

    // Update minigame manager IF active AND state is available
    if (minigameManager.isActive() && currentClientState) {
        minigameManager.update(delta);
    } 
    
    // Process movement for local player if representation exists
    if (localPlayer) {
        isMoving = processMoveQueueWithNotify(moveQueue, localPlayer.mesh, delta);
    } else {
        isMoving = false;
    }

    // Process movement for other players
    otherPlayersMoveQueues.forEach((queue, id) => {
        const playerRep = otherPlayers.get(id);
        if (playerRep) {
            processMoveQueueWithNotify(queue, playerRep.mesh, delta);
        }
    });

    // Update camera position
    if (localPlayer) {
        updateCameraPosition(camera, localPlayer.mesh.position);
    }

    // Update directional light position
    if (localPlayer) {
        directionalLight.position.x = localPlayer.mesh.position.x - 200;
        directionalLight.position.z = localPlayer.mesh.position.z;
        lightTarget.position.copy(localPlayer.mesh.position);
        lightTarget.updateMatrixWorld();
    }

    renderer.render(scene, camera);
}

// Update the cleanup function to be more specific
function cleanupGame() {
    // Stop the animation loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    // Disconnect from the server
    if (room) {
        room.leave();
    }

    // Clean up Three.js resources
    if (renderer) {
        renderer.dispose();
    }
    if (scene) {
        scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                if (object.material instanceof THREE.Material) {
                    object.material.dispose();
                } else if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                }
            }
        });
    }

    // Clear event listeners
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
}

// Add event listeners
window.addEventListener('resize', onWindowResize);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('touchstart', onTouchStart);
window.addEventListener('touchmove', onTouchMove);
window.addEventListener('touchend', onTouchEnd);

// Start connection and animation loop
connectToServer();
animate();

// Add exit button handler
document.getElementById('exitButton')?.addEventListener('click', () => {
    cleanupGame();
    window.location.href = '/';
}); 