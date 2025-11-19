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

// Import modules
const physics = require('./physics');
const gameState = require('./gameState');

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/server-view', (req, res) => {
    res.sendFile(path.join(__dirname, 'server-view.html'));
});

app.get('/stats-view', (req, res) => {
    res.sendFile(path.join(__dirname, 'stats-view.html'));
});

// Store connected players
const players = {};
let playerCounter = 0;

// Store genre configuration
let genres = gameState.loadGenres();

// Dynamic bounds - will be updated by server view
let BOUNDS = {
    width: 1920,
    height: 1080
};

// Physics loop
function runPhysicsLoop() {
    physics.updatePhysics(players, BOUNDS);
    // Broadcast updated positions to all clients
    io.emit('physicsUpdate', players);
}

// Start physics loop
setInterval(runPhysicsLoop, 1000 / physics.PHYSICS_TICK_RATE);

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
            color: gameState.getRandomColor()
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

    // Send current genres to the new connection
    socket.emit('genresUpdate', genres);

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
            // console.log(`Bounds updated to: ${BOUNDS.width}x${BOUNDS.height}`);

            // Clamp all existing players to new bounds
            for (const id in players) {
                const player = players[id];
                player.position.x = Math.max(physics.BALL_RADIUS, Math.min(BOUNDS.width - physics.BALL_RADIUS, player.position.x));
                player.position.y = Math.max(physics.BALL_RADIUS, Math.min(BOUNDS.height - physics.BALL_RADIUS, player.position.y));
            }

            // Broadcast bounds to all clients (including stats viewers)
            io.emit('boundsUpdate', { width: BOUNDS.width, height: BOUNDS.height });
        }
    });

    // Handle prompt updates from server view - broadcast to all clients
    socket.on('promptUpdate', (prompt) => {
        // Broadcast to all clients (especially stats dashboard)
        io.emit('promptUpdate', prompt);
    });

    // Handle genre updates from server view
    socket.on('updateGenres', (newGenres) => {
        if (isViewer && Array.isArray(newGenres) && newGenres.length === 8) {
            genres = newGenres.map(g => String(g).toUpperCase().trim());
            console.log('Genres updated to:', genres);

            // Save genres to config file
            gameState.saveGenres(genres);

            // Broadcast updated genres to all clients
            io.emit('genresUpdate', genres);
        }
    });

    // Handle manual position update from server view
    socket.on('updatePlayerPosition', (data) => {
        if (players[data.playerId]) {
            players[data.playerId].position = data.position;
            // Reset velocity to zero when manually positioned
            players[data.playerId].velocity = { x: 0, y: 0 };
            console.log(`Updated position for player ${data.playerId}`);

            // Broadcast updated positions to all clients
            io.emit('players', players);
        }
    });

    // Handle adding a bot
    socket.on('addBot', () => {
        if (isViewer) {
            const botId = `bot-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            playerCounter++;

            players[botId] = {
                id: botId,
                playerNumber: playerCounter,
                name: `Bubble ${playerCounter}`,
                shape: 'circle',
                isBot: true,
                position: {
                    x: Math.random() * (BOUNDS.width - 200) + 100,
                    y: Math.random() * (BOUNDS.height - 200) + 100
                },
                velocity: { x: 0, y: 0 },
                color: gameState.getRandomColor()
            };

            console.log(`Bot added: ${botId}`);
            io.emit('players', players);
        }
    });

    // Handle removing a bot
    socket.on('removeBot', () => {
        if (isViewer) {
            // Find a bot to remove (last one added)
            const botIds = Object.keys(players).filter(id => players[id].isBot);
            if (botIds.length > 0) {
                const botToRemove = botIds[botIds.length - 1];
                delete players[botToRemove];
                console.log(`Bot removed: ${botToRemove}`);
                io.emit('playerDisconnected', botToRemove);
                io.emit('players', players); // Ensure list is synced
            }
        }
    });

    // Handle clearing all bots
    socket.on('clearBots', () => {
        if (isViewer) {
            const botIds = Object.keys(players).filter(id => players[id].isBot);
            botIds.forEach(id => {
                delete players[id];
                io.emit('playerDisconnected', id);
            });
            console.log(`Cleared ${botIds.length} bots`);
            io.emit('players', players);
        }
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
