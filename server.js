const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/server-view', (req, res) => {
    res.sendFile(path.join(__dirname, 'server-view.html'));
});

// Store connected players
const players = {};
let playerCounter = 0;

// Physics constants
const BALL_RADIUS = 30;
const FRICTION = 0.95;
const BOUNCE_DAMPING = 0.8;
const COLLISION_ELASTICITY = 0.7;
const MAX_VELOCITY = 15;
const PHYSICS_TICK_RATE = 60; // 60 times per second
// Dynamic bounds - will be updated by server view
let BOUNDS = {
    width: 1920,
    height: 1080
};

// All players get white color for minimal design
function getRandomColor() {
    return '#ffffff';
}

// Physics utility functions
function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Check collision between two circles
function checkCollision(p1, p2) {
    const dist = distance(p1.position.x, p1.position.y, p2.position.x, p2.position.y);
    return dist < (BALL_RADIUS * 2);
}

// Resolve collision between two balls
function resolveCollision(p1, p2) {
    const dx = p2.position.x - p1.position.x;
    const dy = p2.position.y - p1.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Prevent division by zero
    if (dist === 0) return;
    
    // Calculate collision normal
    const nx = dx / dist;
    const ny = dy / dist;
    
    // Separate overlapping balls
    const overlap = (BALL_RADIUS * 2) - dist;
    if (overlap > 0) {
        const separationX = nx * overlap * 0.5;
        const separationY = ny * overlap * 0.5;
        
        p1.position.x -= separationX;
        p1.position.y -= separationY;
        p2.position.x += separationX;
        p2.position.y += separationY;
    }
    
    // Calculate relative velocity
    const dvx = p2.velocity.x - p1.velocity.x;
    const dvy = p2.velocity.y - p1.velocity.y;
    
    // Calculate relative velocity in collision normal direction
    const relativeVelocity = dvx * nx + dvy * ny;
    
    // Don't resolve if velocities are separating
    if (relativeVelocity > 0) return;
    
    // Calculate impulse scalar
    const impulse = -(1 + COLLISION_ELASTICITY) * relativeVelocity;
    const impulseX = impulse * nx;
    const impulseY = impulse * ny;
    
    // Apply impulse to both balls
    p1.velocity.x -= impulseX * 0.5;
    p1.velocity.y -= impulseY * 0.5;
    p2.velocity.x += impulseX * 0.5;
    p2.velocity.y += impulseY * 0.5;
}

// Physics update loop
function updatePhysics() {
    const playerIds = Object.keys(players);
    
    // Update velocities from input and apply friction
    for (const id of playerIds) {
        const player = players[id];
        
        if (!player.velocity) {
            player.velocity = { x: 0, y: 0 };
        }
        
        // Apply friction
        player.velocity.x *= FRICTION;
        player.velocity.y *= FRICTION;
        
        // Clamp velocity
        const speed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.y * player.velocity.y);
        if (speed > MAX_VELOCITY) {
            player.velocity.x = (player.velocity.x / speed) * MAX_VELOCITY;
            player.velocity.y = (player.velocity.y / speed) * MAX_VELOCITY;
        }
        
        // Update position based on velocity
        player.position.x += player.velocity.x;
        player.position.y += player.velocity.y;
        
        // Boundary collision with bounce
        if (player.position.x - BALL_RADIUS < 0) {
            player.position.x = BALL_RADIUS;
            player.velocity.x = Math.abs(player.velocity.x) * BOUNCE_DAMPING;
        }
        if (player.position.x + BALL_RADIUS > BOUNDS.width) {
            player.position.x = BOUNDS.width - BALL_RADIUS;
            player.velocity.x = -Math.abs(player.velocity.x) * BOUNCE_DAMPING;
        }
        if (player.position.y - BALL_RADIUS < 0) {
            player.position.y = BALL_RADIUS;
            player.velocity.y = Math.abs(player.velocity.y) * BOUNCE_DAMPING;
        }
        if (player.position.y + BALL_RADIUS > BOUNDS.height) {
            player.position.y = BOUNDS.height - BALL_RADIUS;
            player.velocity.y = -Math.abs(player.velocity.y) * BOUNCE_DAMPING;
        }
    }
    
    // Check collisions between all pairs of players
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            const p1 = players[playerIds[i]];
            const p2 = players[playerIds[j]];
            
            if (checkCollision(p1, p2)) {
                resolveCollision(p1, p2);
            }
        }
    }
    
    // Broadcast updated positions to all clients
    io.emit('physicsUpdate', players);
}

// Start physics loop
setInterval(updatePhysics, 1000 / PHYSICS_TICK_RATE);

// Socket.IO connection handling
io.on('connection', (socket) => {
    const isViewer = socket.handshake.query.viewer === 'true';
    
    if (isViewer) {
        console.log(`Viewer connected: ${socket.id}`);
    } else {
        console.log(`Player connected: ${socket.id}`);
        
        // Initialize new player with random position and color
        playerCounter++;
        players[socket.id] = {
            id: socket.id,
            playerNumber: playerCounter,
            name: `Player ${playerCounter}`, // Default name
            shape: 'circle', // Default shape
            position: {
                x: Math.random() * (BOUNDS.width - 200) + 100,
                y: Math.random() * (BOUNDS.height - 200) + 100
            },
            velocity: { x: 0, y: 0 },
            color: getRandomColor()
        };

        // Send initialization data to the new player
        socket.emit('init', {
            id: socket.id,
            position: players[socket.id].position
        });

        // Notify all other players about the new player
        socket.broadcast.emit('players', players);
    }

    // Send all players to the new connection (player or viewer)
    socket.emit('players', players);

    // Handle player name change
    socket.on('setName', (name) => {
        if (players[socket.id]) {
            players[socket.id].name = name;
            console.log(`Player ${socket.id} set name to: ${name}`);
            
            // Broadcast updated player list to all clients
            io.emit('players', players);
        }
    });

    // Handle player shape change
    socket.on('setShape', (shape) => {
        if (players[socket.id]) {
            players[socket.id].shape = shape;
            console.log(`Player ${socket.id} set shape to: ${shape}`);
            
            // Broadcast updated player list to all clients
            io.emit('players', players);
        }
    });

    // Handle player movement input
    socket.on('moveInput', (input) => {
        if (players[socket.id]) {
            // Apply input to velocity (acceleration)
            const acceleration = 1.2;
            players[socket.id].velocity.x += input.x * acceleration;
            players[socket.id].velocity.y += input.y * acceleration;
        }
    });

    // Handle canvas dimensions update from server view
    socket.on('updateBounds', (dimensions) => {
        if (isViewer) {
            BOUNDS.width = dimensions.width;
            BOUNDS.height = dimensions.height;
            console.log(`Bounds updated to: ${BOUNDS.width}x${BOUNDS.height}`);
            
            // Clamp all existing players to new bounds
            for (const id in players) {
                const player = players[id];
                player.position.x = Math.max(BALL_RADIUS, Math.min(BOUNDS.width - BALL_RADIUS, player.position.x));
                player.position.y = Math.max(BALL_RADIUS, Math.min(BOUNDS.height - BALL_RADIUS, player.position.y));
            }
        }
    });

    // Handle prompt updates from server view - broadcast to all clients
    socket.on('promptUpdate', (prompt) => {
        console.log('Prompt update received:', prompt);
        // Broadcast to all clients (especially stats dashboard)
        io.emit('promptUpdate', prompt);
    });

    // Handle player disconnect
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(`Player disconnected: ${socket.id}`);
            delete players[socket.id];
            
            // Notify all players about the disconnection
            io.emit('playerDisconnected', socket.id);
        } else {
            console.log(`Viewer disconnected: ${socket.id}`);
        }
    });
});

// Start server - bind to 0.0.0.0 for Railway/cloud deployment
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open this URL on multiple devices to see real-time multiplayer!`);
});

// Export for Vercel
module.exports = app;
