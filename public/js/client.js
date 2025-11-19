const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusElement = document.getElementById('connection-status');

// Set canvas size
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Game state
let players = {};
let myId = null;
let myPosition = { x: canvas.width / 2, y: canvas.height / 2 };
let myName = '';
let myShape = 'circle';

// Joystick state
let joystickActive = false;
let joystickDirection = { x: 0, y: 0 };

// Virtual canvas bounds (independent of client window size)
// This allows movement across full server display area
const virtualBounds = {
    width: 3840,  // Large virtual space
    height: 2160
};

// Name modal elements
const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('player-name-input');
const startButton = document.getElementById('start-button');
const shapeOptions = document.querySelectorAll('.shape-option');

// Shape selection
shapeOptions.forEach(option => {
    option.addEventListener('click', () => {
        shapeOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        myShape = option.dataset.shape;
    });
});

// Handle name submission
function startGame() {
    const name = nameInput.value.trim();
    if (name.length === 0) {
        alert('Please enter a name');
        return;
    }
    myName = name;
    nameModal.classList.add('hidden');

    // Initialize socket connection when user clicks Start
    if (!socket) {
        statusElement.textContent = 'Connecting...';
        statusElement.className = 'disconnected';
        initializeSocket();
    }
}

startButton.addEventListener('click', startGame);
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        startGame();
    }
});

// Focus input on load
window.addEventListener('load', () => {
    nameInput.focus();
});

// Socket will be initialized when user clicks Start
let socket = null;

function initializeSocket() {
    // Socket.IO connection
    socket = io();

    socket.on('connect', () => {
        statusElement.textContent = 'Connected';
        statusElement.className = 'connected';
        console.log('Connected to server');

        // Send name and shape immediately after connection
        if (myName) {
            socket.emit('setName', myName);
            socket.emit('setShape', myShape);
        }
    });

    socket.on('disconnect', () => {
        statusElement.textContent = 'Disconnected';
        statusElement.className = 'disconnected';
        console.log('Disconnected from server');
    });

    socket.on('init', (data) => {
        myId = data.id;
        myPosition = data.position;
        console.log('Initialized with ID:', myId);
    });

    socket.on('players', (serverPlayers) => {
        players = serverPlayers;
    });

    socket.on('physicsUpdate', (serverPlayers) => {
        // Update all player positions from server physics
        players = serverPlayers;
        if (players[myId]) {
            myPosition = players[myId].position;
        }
    });

    socket.on('playerDisconnected', (id) => {
        delete players[id];
    });
}

// Joystick handling
const joystickContainer = document.getElementById('joystick-container');
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

const joystickRadius = 125; // Base radius
const stickRadius = 75; // Max distance stick can move from center

function updateJoystick(clientX, clientY) {
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let deltaX = clientX - centerX;
    let deltaY = clientY - centerY;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Limit stick movement to stickRadius
    if (distance > stickRadius) {
        const angle = Math.atan2(deltaY, deltaX);
        deltaX = Math.cos(angle) * stickRadius;
        deltaY = Math.sin(angle) * stickRadius;
    }

    // Update stick position
    joystickStick.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    // Calculate direction (normalized)
    joystickDirection.x = deltaX / stickRadius;
    joystickDirection.y = deltaY / stickRadius;
}

function resetJoystick() {
    joystickStick.style.transform = 'translate(0px, 0px)';
    joystickDirection.x = 0;
    joystickDirection.y = 0;
    joystickActive = false;
}

function startJoystick(e) {
    e.preventDefault();
    joystickActive = true;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    updateJoystick(clientX, clientY);
}

function moveJoystick(e) {
    if (!joystickActive) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    updateJoystick(clientX, clientY);
}

function endJoystick(e) {
    e.preventDefault();
    resetJoystick();
}

// Touch events for joystick
joystickContainer.addEventListener('touchstart', startJoystick);
joystickContainer.addEventListener('touchmove', moveJoystick);
joystickContainer.addEventListener('touchend', endJoystick);

// Mouse events for joystick
joystickContainer.addEventListener('mousedown', startJoystick);
document.addEventListener('mousemove', moveJoystick);
document.addEventListener('mouseup', endJoystick);

// Send joystick input to server for physics processing
function sendMovementInput() {
    if (socket && socket.connected && (joystickActive || (joystickDirection.x !== 0 || joystickDirection.y !== 0))) {
        socket.emit('moveInput', {
            x: joystickDirection.x,
            y: joystickDirection.y
        });
    }
}

// Send input at regular intervals (~60fps)
setInterval(sendMovementInput, 16);

// Draw dot grid background
function drawGrid() {
    const gridSize = 50;
    const dotSize = 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';

    // Draw dots at grid intersections
    for (let x = 0; x <= canvas.width; x += gridSize) {
        for (let y = 0; y <= canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.arc(x, y, dotSize, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// Store previous positions for motion blur
let playerTrail = [];
const trailLength = 8;

// Draw shape based on type
function drawShape(x, y, size, shape, isMe = false, playerName = '') {
    if (isMe) {
        // Add current position to trail
        playerTrail.push({ x, y });
        if (playerTrail.length > trailLength) {
            playerTrail.shift();
        }

        // Draw motion blur trail
        for (let i = 0; i < playerTrail.length - 1; i++) {
            const trail = playerTrail[i];
            const alpha = (i + 1) / playerTrail.length * 0.3;

            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;

            if (shape === 'circle') {
                ctx.beginPath();
                ctx.arc(trail.x, trail.y, size, 0, Math.PI * 2);
                ctx.fill();
                ctx.closePath();
            } else if (shape === 'square') {
                ctx.fillRect(trail.x - size, trail.y - size, size * 2, size * 2);
            } else if (shape === 'triangle') {
                ctx.beginPath();
                ctx.moveTo(trail.x, trail.y - size);
                ctx.lineTo(trail.x + size, trail.y + size);
                ctx.lineTo(trail.x - size, trail.y + size);
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    // Draw main shape (solid white)
    ctx.fillStyle = '#ffffff';

    if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.closePath();
    } else if (shape === 'square') {
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
    } else if (shape === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y + size);
        ctx.lineTo(x - size, y + size);
        ctx.closePath();
        ctx.fill();
    }

    // Draw player name
    if (playerName) {
        ctx.font = '300 16px "Roboto Mono"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Measure text for background
        const textMetrics = ctx.measureText(playerName);
        const textWidth = textMetrics.width;
        const textHeight = 20;
        const padding = 6;

        // Draw white background
        ctx.fillStyle = 'white';
        ctx.fillRect(
            x - textWidth / 2 - padding,
            y - textHeight / 2,
            textWidth + padding * 2,
            textHeight
        );

        // Draw text
        ctx.fillStyle = 'black';
        ctx.fillText(playerName, x, y);
    }
}

function draw() {
    // Clear canvas with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid background
    drawGrid();

    // MOBILE CLIENT: Only joystick control visible, no ball preview
    // All balls are only visible on the server view

    requestAnimationFrame(draw);
}

draw();
