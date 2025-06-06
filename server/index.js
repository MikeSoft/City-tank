// Enhanced server/index.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enhanced Socket.IO configuration
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    // Support both transports for better compatibility
    transports: ['websocket', 'polling'],
    allowEIO3: true, // Support older clients

    // Connection settings
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e6, // 1MB for audio data

    // Handle proxy issues
    cookie: false,
    serveClient: true
});

// Enhanced logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${req.ip}`);
    next();
});

// Serve static files with proper headers
app.use(express.static(path.join(__dirname, '../client'), {
    setHeaders: (res, path) => {
        // Add CORS headers for all static files
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Set proper MIME types
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        players: gameState.players.size,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// CORS preflight handling
app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});

// Game state (existing)
const gameState = {
    players: new Map(),
    bullets: new Map(),
    walls: [],
    audioRooms: new Map()
};

let bulletIdCounter = 0;

// Enhanced audio statistics
const audioStats = {
    packetsPerSecond: 0,
    totalPackets: 0,
    activeStreams: 0,
    averageLatency: 0,
    peakConcurrentUsers: 0
};

setInterval(() => {
    audioStats.packetsPerSecond = 0;
    // Update peak users
    if (gameState.players.size > audioStats.peakConcurrentUsers) {
        audioStats.peakConcurrentUsers = gameState.players.size;
    }
}, 1000);

// Enhanced connection handling
io.on('connection', (socket) => {
    console.log(`🎮 Jugador conectado: ${socket.id} desde ${socket.handshake.address}`);

    // Log connection details for debugging
    console.log(`   Transport: ${socket.conn.transport.name}`);
    console.log(`   User-Agent: ${socket.handshake.headers['user-agent']}`);

    // Create new player
    const newPlayer = {
        id: socket.id,
        x: Math.random() * 760 + 20, // Keep away from edges
        y: Math.random() * 560 + 20,
        angle: 0,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`,
        name: `Tank${Math.floor(Math.random() * 1000)}`,
        health: 100,
        audioEnabled: false,
        lastAudioPacket: Date.now(),
        connectedAt: Date.now(),
        transport: socket.conn.transport.name
    };

    gameState.players.set(socket.id, newPlayer);

    // Send initial state with connection info
    socket.emit('gameState', {
        players: Array.from(gameState.players.values()),
        bullets: Array.from(gameState.bullets.values()),
        walls: gameState.walls,
        serverInfo: {
            transport: socket.conn.transport.name,
            pingInterval: io.engine.pingInterval,
            pingTimeout: io.engine.pingTimeout
        }
    });

    // Notify other players
    socket.broadcast.emit('playerJoined', newPlayer);

    // Enhanced transport upgrade handling
    socket.conn.on('upgrade', () => {
        console.log(`🔄 ${socket.id} upgraded to ${socket.conn.transport.name}`);
        if (gameState.players.has(socket.id)) {
            gameState.players.get(socket.id).transport = socket.conn.transport.name;
        }
    });

    socket.conn.on('upgradeError', (error) => {
        console.error(`❌ Upgrade error for ${socket.id}:`, error);
    });

    // Connection monitoring
    socket.on('ping', (callback) => {
        callback && callback();
    });

    // Enhanced player movement with validation
    socket.on('playerMove', (data) => {
        const player = gameState.players.get(socket.id);
        if (player && data && typeof data.x === 'number' && typeof data.y === 'number') {
            // Validate movement bounds
            player.x = Math.max(20, Math.min(800, data.x));
            player.y = Math.max(20, Math.min(600, data.y));
            player.angle = data.angle || 0;
            player.lastActivity = Date.now();

            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: player.x,
                y: player.y,
                angle: player.angle
            });
        }
    });

    // Enhanced shooting with rate limiting
    socket.on('playerShoot', (data) => {
        const player = gameState.players.get(socket.id);
        if (player) {
            const now = Date.now();

            // Rate limiting
            if (!player.lastShoot || now - player.lastShoot > 200) { // Max 5 shots per second
                player.lastShoot = now;

                const bullet = {
                    id: bulletIdCounter++,
                    playerId: socket.id,
                    x: player.x,
                    y: player.y,
                    angle: player.angle,
                    speed: 300,
                    createdAt: now
                };

                gameState.bullets.set(bullet.id, bullet);
                io.emit('bulletCreated', bullet);

                // Auto-remove bullet
                setTimeout(() => {
                    gameState.bullets.delete(bullet.id);
                    io.emit('bulletDestroyed', bullet.id);
                }, 3000);
            }
        }
    });

    // Enhanced audio streaming with better error handling
    socket.on('audioStream', (audioData) => {
        try {
            audioStats.packetsPerSecond++;
            audioStats.totalPackets++;

            const player = gameState.players.get(socket.id);
            if (player && audioData && audioData.data) {
                player.audioEnabled = true;
                player.lastAudioPacket = Date.now();

                // Calculate latency if timestamp provided
                if (audioData.timestamp) {
                    const latency = Date.now() - audioData.timestamp;
                    audioStats.averageLatency = (audioStats.averageLatency + latency) / 2;
                }

                // Spatial audio (optional)
                const nearbyPlayers = getNearbyPlayers(player, 300);

                if (nearbyPlayers.length > 0) {
                    nearbyPlayers.forEach(nearbyPlayerId => {
                        if (nearbyPlayerId !== socket.id) {
                            socket.to(nearbyPlayerId).emit('audioStream', {
                                ...audioData,
                                playerId: socket.id,
                                playerName: player.name
                            });
                        }
                    });
                } else {
                    // Broadcast to all if no spatial audio
                    socket.broadcast.emit('audioStream', {
                        ...audioData,
                        playerId: socket.id,
                        playerName: player.name
                    });
                }
            }
        } catch (error) {
            console.error(`❌ Audio stream error for ${socket.id}:`, error);
        }
    });

    // Audio state changes
    socket.on('audioStateChanged', (state) => {
        const player = gameState.players.get(socket.id);
        if (player && state && typeof state.enabled === 'boolean') {
            player.audioEnabled = state.enabled;
            socket.broadcast.emit('playerAudioState', {
                playerId: socket.id,
                audioEnabled: state.enabled
            });
        }
    });

    // Enhanced disconnect handling
    socket.on('disconnect', (reason) => {
        const player = gameState.players.get(socket.id);
        const sessionDuration = player ? (Date.now() - player.connectedAt) / 1000 : 0;

        console.log(`👋 ${socket.id} desconectado (${reason}) - Sesión: ${sessionDuration.toFixed(1)}s`);

        gameState.players.delete(socket.id);
        socket.broadcast.emit('playerLeft', socket.id);
    });

    // Error handling
    socket.on('error', (error) => {
        console.error(`❌ Socket error ${socket.id}:`, error);
    });
});

// Utility functions (existing)
function getNearbyPlayers(player, radius) {
    const nearbyPlayers = [];
    gameState.players.forEach((otherPlayer, playerId) => {
        if (playerId !== player.id) {
            const distance = Math.sqrt(
                Math.pow(player.x - otherPlayer.x, 2) +
                Math.pow(player.y - otherPlayer.y, 2)
            );
            if (distance <= radius) {
                nearbyPlayers.push(playerId);
            }
        }
    });
    return nearbyPlayers;
}

// Enhanced game loop
setInterval(() => {
    gameState.bullets.forEach((bullet, id) => {
        const radians = bullet.angle * Math.PI / 180;
        bullet.x += Math.cos(radians) * bullet.speed * (1 / 60);
        bullet.y += Math.sin(radians) * bullet.speed * (1 / 60);
        if (bullet.x < 0 || bullet.x > 800 || bullet.y < 0 || bullet.y > 600) {
            gameState.bullets.delete(id);
            io.emit('bulletDestroyed', id);
        } else {
            gameState.players.forEach((player) => {
                const dx = bullet.x - player.x;
                const dy = bullet.y - player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 20) { // Assuming tank radius is 15
                    if (player.id !== bullet.playerId) {
                        io.emit('playerDamaged', {id: player.id, damage: 10});
                        io.emit('bulletDestroyed', id);
                        gameState.bullets.delete(id);
                    }
                }
            });
        }
    });
}, 1000 / 60);

// Cleanup inactive players
setInterval(() => {
    const now = Date.now();
    gameState.players.forEach((player, playerId) => {
        // Audio timeout
        if (player.audioEnabled && (now - player.lastAudioPacket) > 5000) {
            player.audioEnabled = false;
            console.log(`🔇 Audio timeout para ${playerId}`);
        }

        // Player inactivity timeout (10 minutes)
        if (player.lastActivity && (now - player.lastActivity) > 600000) {
            console.log(`⏰ Timeout de inactividad para ${playerId}`);
            gameState.players.delete(playerId);
            io.emit('playerLeft', playerId);
        }
    });
}, 2000);

// Enhanced statistics
setInterval(() => {
    const activeAudioPlayers = Array.from(gameState.players.values())
        .filter(p => p.audioEnabled).length;

    audioStats.activeStreams = activeAudioPlayers;

    console.log(`📊 Stats: ${audioStats.packetsPerSecond} pkt/s, ${audioStats.activeStreams} audio, ${gameState.players.size} jugadores, latencia promedio: ${audioStats.averageLatency.toFixed(1)}ms`);
}, 5000);

// Enhanced stats endpoint
app.get('/stats', (req, res) => {
    const players = Array.from(gameState.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        transport: p.transport,
        audioEnabled: p.audioEnabled,
        sessionDuration: (Date.now() - p.connectedAt) / 1000
    }));

    res.json({
        players: gameState.players.size,
        bullets: gameState.bullets.size,
        audio: audioStats,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        playerDetails: players
    });
});

// Error handling
server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 65534;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🎮 Battle City con audio en tiempo real`);
    console.log(`🌐 Accesible en todas las interfaces de red`);
    console.log(`📊 Stats: http://localhost:${PORT}/stats`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
});
