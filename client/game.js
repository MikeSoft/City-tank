// Enhanced connection configuration in game.js
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Enhanced Socket.IO connection with fallbacks
        this.socket = io({
            // Connection options
            transports: ['websocket', 'polling'], // Allow fallback to polling
            upgrade: true, // Allow upgrade from polling to websocket
            timeout: 20000, // 20 seconds timeout
            forceNew: true, // Force new connection

            // Reconnection configuration
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            maxReconnectionAttempts: 5,

            // Additional options for proxy/network issues
            autoConnect: true,
            pingTimeout: 60000,
            pingInterval: 25000
        });

        // Connection monitoring
        this.connectionState = 'connecting';
        this.reconnectionAttempts = 0;

        this.players = new Map();
        this.bullets = new Map();
        this.myPlayerId = null;

        this.keys = {};
        this.lastShoot = 0;
        this.shootCooldown = 500;
        this.playerAudioStates = new Map();

        this.setupEnhancedSocketEvents();
        this.setupControls();
        this.startGameLoop();
        this.audio = null;
        this.initAudioWhenReady();
    }

    tryAlternativeConnection() {
        // Try different transports
        setTimeout(() => {
            if (this.socket.disconnected) {
                console.log('🔄 Intentando conexión alternativa...');

                // Disconnect and try with different config
                this.socket.disconnect();

                // Create new socket with polling only
                this.socket = io({
                    transports: ['polling'], // Force polling transport
                    upgrade: false, // Don't upgrade to websocket
                    timeout: 30000
                });

                this.setupEnhancedSocketEvents();
            }
        }, 2000);
    }

    setupEnhancedSocketEvents() {
        // Connection success
        this.socket.on('connect', () => {
            console.log('🔗 Conectado al servidor');
            this.myPlayerId = this.socket.id;
            this.connectionState = 'connected';
            this.reconnectionAttempts = 0;
            this.updateConnectionStatus();
        });

        // Connection error handling
        this.socket.on('connect_error', (error) => {
            console.error('❌ Error de conexión:', error);
            this.connectionState = 'error';
            this.updateConnectionStatus();

            // Try alternative connection methods
            this.tryAlternativeConnection();
        });

        // Disconnection handling
        this.socket.on('disconnect', (reason) => {
            console.log('❌ Desconectado del servidor:', reason);
            this.connectionState = 'disconnected';
            this.updateConnectionStatus();

            if (this.audio) {
                this.audio.destroy();
            }

            // Handle different disconnect reasons
            if (reason === 'io server disconnect') {
                // Server disconnected this client, need to reconnect manually
                this.socket.connect();
            }
        });

        // Reconnection events
        this.socket.on('reconnect', (attemptNumber) => {
            console.log(`🔄 Reconectado después de ${attemptNumber} intentos`);
            this.connectionState = 'connected';
            this.updateConnectionStatus();
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`🔄 Intento de reconexión #${attemptNumber}`);
            this.connectionState = 'reconnecting';
            this.reconnectionAttempts = attemptNumber;
            this.updateConnectionStatus();
        });

        this.socket.on('reconnect_error', (error) => {
            console.error('❌ Error de reconexión:', error);
        });

        this.socket.on('reconnect_failed', () => {
            console.error('❌ Falló la reconexión');
            this.connectionState = 'failed';
            this.updateConnectionStatus();
            this.showConnectionError();
        });

        // Game events (existing code...)
        this.socket.on('gameState', (state) => {
            state.players.forEach(player => {
                this.players.set(player.id, player);
            });
            state.bullets.forEach(bullet => {
                this.bullets.set(bullet.id, bullet);
            });
            this.updatePlayerCount();
        });

        this.socket.on('playerJoined', (player) => {
            this.players.set(player.id, player);
            this.updatePlayerCount();
            console.log(`👋 ${player.name} se unió al juego`);
        });

        this.socket.on('playerMoved', (data) => {
            const player = this.players.get(data.id);
            if (player) {
                player.x = data.x;
                player.y = data.y;
                player.angle = data.angle;
            }
        });

        this.socket.on('playerLeft', (playerId) => {
            const player = this.players.get(playerId);
            if (player) {
                console.log(`👋 ${player.name} abandonó el juego`);
            }
            this.players.delete(playerId);
            this.playerAudioStates.delete(playerId);
            this.updatePlayerCount();
        });

        this.socket.on('bulletCreated', (bullet) => {
            this.bullets.set(bullet.id, bullet);
        });

        this.socket.on('bulletDestroyed', (bulletId) => {
            this.bullets.delete(bulletId);
        });

        // Eventos de audio
        this.socket.on('playerAudioState', (data) => {
            this.playerAudioStates.set(data.playerId, {
                audioEnabled: data.audioEnabled,
                lastUpdate: Date.now()
            });
        });

        // Debug de conexión
        this.socket.on('connect_error', (error) => {
            console.error('❌ Error de conexión:', error);
        });
    }

    setupControls() {
        // Controles de teclado (PC)
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;

            if (e.code === 'Space') {
                e.preventDefault();
                this.shoot();
            }

            // Tecla M para mutear/desmutear
            if (e.code === 'KeyM') {
                e.preventDefault();
                if (this.audio) {
                    this.audio.toggleMute();
                }
            }

            // Tecla T para activar/desactivar micrófono
            if (e.code === 'KeyT') {
                e.preventDefault();
                if (this.audio) {
                    this.audio.toggleMicrophone();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Controles móviles se manejan en controls.js
        window.mobileControls = {
            move: {x: 0, y: 0},
            shoot: false
        };

        // Mostrar controles en pantalla
        this.showControls();
    }

    showControls() {
        // Crear elemento de ayuda de controles
        const controlsHelp = document.createElement('div');
        controlsHelp.id = 'controlsHelp';
        controlsHelp.style.cssText = `
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 8px;
            border-radius: 5px;
            font-size: 11px;
            z-index: 999;
        `;

        controlsHelp.innerHTML = `
            <div><strong>🎮 Controles:</strong></div>
            <div>WASD/Flechas: Mover</div>
            <div>Espacio: Disparar</div>
            <div><strong>🎙️ Audio:</strong></div>
            <div>T: Toggle Micrófono</div>
            <div>M: Mute/Unmute</div>
        `;

        document.getElementById('gameContainer').appendChild(controlsHelp);

        // Ocultar después de 10 segundos
        setTimeout(() => {
            if (controlsHelp.parentNode) {
                controlsHelp.style.opacity = '0.3';
            }
        }, 10000);
    }

    update() {
        const myPlayer = this.players.get(this.myPlayerId);
        if (!myPlayer) return;

        let moveX = 0;
        let moveY = 0;
        let newAngle = myPlayer.angle;

        // Controles PC
        if (this.keys['KeyW'] || this.keys['ArrowUp']) moveY = -1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) moveY = 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveX = -1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) moveX = 1;

        // Controles móviles
        if (window.mobileControls.move.x !== 0 || window.mobileControls.move.y !== 0) {
            moveX = window.mobileControls.move.x;
            moveY = window.mobileControls.move.y;
        }

        if (window.mobileControls.shoot) {
            this.shoot();
            window.mobileControls.shoot = false;
        }

        // Calcular movimiento
        if (moveX !== 0 || moveY !== 0) {
            const speed = 100; // pixels por segundo
            const deltaTime = 1 / 60; // asumiendo 60 FPS

            myPlayer.x += moveX * speed * deltaTime;
            myPlayer.y += moveY * speed * deltaTime;

            // Calcular ángulo de rotación
            newAngle = Math.atan2(moveY, moveX) * 180 / Math.PI;
            myPlayer.angle = newAngle;

            // Enviar actualización al servidor
            this.socket.emit('playerMove', {
                x: myPlayer.x,
                y: myPlayer.y,
                angle: newAngle
            });
        }

        // Actualizar bullets
        this.bullets.forEach((bullet) => {
            const radians = bullet.angle * Math.PI / 180;
            bullet.x += Math.cos(radians) * bullet.speed * (1 / 60);
            bullet.y += Math.sin(radians) * bullet.speed * (1 / 60);
        });

        // Limpiar estados de audio antiguos
        this.cleanupAudioStates();
    }

    cleanupAudioStates() {
        const now = Date.now();
        this.playerAudioStates.forEach((state, playerId) => {
            if (now - state.lastUpdate > 10000) { // 10 segundos
                this.playerAudioStates.delete(playerId);
            }
        });
    }

    shoot() {
        const now = Date.now();
        if (now - this.lastShoot < this.shootCooldown) return;

        this.lastShoot = now;
        this.socket.emit('playerShoot', {});
    }

    render() {
        // Limpiar canvas
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Dibujar tanques
        this.players.forEach((player) => {
            this.drawTank(player);
        });

        // Dibujar bullets
        this.bullets.forEach((bullet) => {
            this.drawBullet(bullet);
        });

        // Dibujar indicadores de conexión
        this.drawConnectionStatus();
    }

    drawTank(player) {
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle * Math.PI / 180);

        // Cuerpo del tanque
        ctx.fillStyle = player.color;
        ctx.fillRect(-15, -10, 30, 20);

        // Cañón
        ctx.fillStyle = '#666';
        ctx.fillRect(15, -2, 20, 4);

        ctx.restore();

        // Nombre del jugador
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x, player.y - 25);

        // Indicador de audio
        const audioState = this.playerAudioStates.get(player.id);
        if (audioState && audioState.audioEnabled) {
            ctx.fillStyle = '#00ff00';
            ctx.font = '16px Arial';
            ctx.fillText('🎤', player.x + 25, player.y - 15);
        }

        // Indicador si es el jugador local
        if (player.id === this.myPlayerId) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    drawBullet(bullet) {
        this.ctx.fillStyle = '#ffff00';
        this.ctx.beginPath();
        this.ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    drawConnectionStatus() {
        const ctx = this.ctx;

        // Estado de conexión
        const connected = this.socket.connected;
        ctx.fillStyle = connected ? '#00ff00' : '#ff0000';
        ctx.beginPath();
        ctx.arc(this.canvas.width - 20, 20, 5, 0, Math.PI * 2);
        ctx.fill();

        // Estado de audio
        if (this.audio && this.audio.isInitialized) {
            ctx.fillStyle = this.audio.isTransmitting ? '#00ff00' : '#ff6600';
            ctx.beginPath();
            ctx.arc(this.canvas.width - 40, 20, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    updatePlayerCount() {
        document.getElementById('playerCount').textContent = this.players.size;
    }

    startGameLoop() {
        let lastTime = 0;
        let frameCount = 0;
        let fpsTime = 0;

        const gameLoop = (currentTime) => {
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;

            // Calcular FPS
            frameCount++;
            fpsTime += deltaTime;
            if (fpsTime >= 1000) {
                document.getElementById('fps').textContent = Math.round(frameCount * 1000 / fpsTime);
                frameCount = 0;
                fpsTime = 0;
            }

            this.update();
            this.render();

            requestAnimationFrame(gameLoop);
        };

        requestAnimationFrame(gameLoop);
    }

    // Cleanup al cerrar
    destroy() {
        if (this.audio) {
            this.audio.destroy();
        }
        this.socket.disconnect();
    }

    updateConnectionStatus() {
        const statusElement = this.getOrCreateStatusElement();

        switch (this.connectionState) {
            case 'connecting':
                statusElement.textContent = '🔄 Conectando...';
                statusElement.style.color = '#FFA500';
                break;
            case 'connected':
                statusElement.textContent = '🔗 Conectado';
                statusElement.style.color = '#00FF00';
                break;
            case 'reconnecting':
                statusElement.textContent = `🔄 Reconectando... (${this.reconnectionAttempts})`;
                statusElement.style.color = '#FFA500';
                break;
            case 'disconnected':
                statusElement.textContent = '❌ Desconectado';
                statusElement.style.color = '#FF6600';
                break;
            case 'error':
                statusElement.textContent = '❌ Error de conexión';
                statusElement.style.color = '#FF0000';
                break;
            case 'failed':
                statusElement.textContent = '❌ Conexión fallida';
                statusElement.style.color = '#FF0000';
                break;
        }
    }

    getOrCreateStatusElement() {
        let statusElement = document.getElementById('connectionStatus');
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = 'connectionStatus';
            statusElement.style.cssText = `
                position: absolute;
                top: 50px;
                left: 10px;
                color: white;
                font-size: 14px;
                font-weight: bold;
                z-index: 1000;
            `;
            document.getElementById('gameContainer').appendChild(statusElement);
        }
        return statusElement;
    }

    showConnectionError() {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            z-index: 10000;
            max-width: 400px;
        `;

        errorDiv.innerHTML = `
            <h3>❌ Error de Conexión</h3>
            <p>No se pudo conectar al servidor. Posibles causas:</p>
            <ul style="text-align: left;">
                <li>Servidor no disponible</li>
                <li>Problemas de proxy/firewall</li>
                <li>Conexión de red inestable</li>
            </ul>
            <button onclick="location.reload()" style="
                padding: 10px 20px;
                background: white;
                color: red;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                margin-top: 10px;
            ">Reintentar</button>
        `;

        document.body.appendChild(errorDiv);

        // Remove after 10 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 10000);
    }
}


// Inicializar juego cuando se carga la página
window.addEventListener('load', () => {
    const game = new Game();

    // Cleanup al cerrar la página
    window.addEventListener('beforeunload', () => {
        game.destroy();
    });
});