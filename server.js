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

// All players get white color for minimal design
function getRandomColor() {
    return '#ffffff';
}

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
                x: Math.random() * 800 + 100,
                y: Math.random() * 600 + 100
            },
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

    // Handle player movement
    socket.on('move', (position) => {
        if (players[socket.id]) {
            players[socket.id].position = position;
            
            // Broadcast the movement to all other players
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                position: position
            });
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
