class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = io();

        this.players = new Map();
        this.bullets = new Map();
        this.myPlayerId = null;

        this.keys = {};
        this.lastShoot = 0;
        this.shootCooldown = 500;

        // Configuración dinámica del mundo
        this.worldWidth = 1200;
        this.worldHeight = 800;
        this.camera = {x: 0, y: 0};
        this.scale = 1;

        this.setupSocketEvents();
        this.setupControls();
        this.handleResize();
        this.startGameLoop();

        // Iniciar audio
        this.audio = new AudioManager(this.socket);

        // Exponer para redimensionamiento
        window.game = this;
    }

    handleResize() {
        const container = document.getElementById('gameContainer');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;

        // Calcular escala para mantener proporciones del juego
        const scaleX = this.canvas.width / this.worldWidth;
        const scaleY = this.canvas.height / this.worldHeight;
        this.scale = Math.min(scaleX, scaleY);

        // Centrar cámara si es necesario
        this.updateCamera();

        console.log(`Canvas resized to: ${this.canvas.width}x${this.canvas.height}, scale: ${this.scale}`);
    }

    updateCamera() {
        const myPlayer = this.players.get(this.myPlayerId);
        if (myPlayer) {
            // Seguir al jugador con la cámara
            this.camera.x = myPlayer.x - (this.canvas.width / this.scale) / 2;
            this.camera.y = myPlayer.y - (this.canvas.height / this.scale) / 2;

            // Limitar cámara a los bordes del mundo
            this.camera.x = Math.max(0, Math.min(this.worldWidth - this.canvas.width / this.scale, this.camera.x));
            this.camera.y = Math.max(0, Math.min(this.worldHeight - this.canvas.height / this.scale, this.camera.y));
        }
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Conectado al servidor');
            this.myPlayerId = this.socket.id;
        });

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
            this.players.delete(playerId);
            this.updatePlayerCount();
        });

        this.socket.on('bulletCreated', (bullet) => {
            this.bullets.set(bullet.id, bullet);
        });

        this.socket.on('bulletDestroyed', (bulletId) => {
            this.bullets.delete(bulletId);
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
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Controles móviles
        window.mobileControls = {
            move: {x: 0, y: 0},
            shoot: false
        };
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
            const speed = 150;
            const deltaTime = 1 / 60;

            // Normalizar movimiento diagonal
            const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
            if (magnitude > 1) {
                moveX /= magnitude;
                moveY /= magnitude;
            }

            const newX = myPlayer.x + moveX * speed * deltaTime;
            const newY = myPlayer.y + moveY * speed * deltaTime;

            // Limitar al mundo
            myPlayer.x = Math.max(20, Math.min(this.worldWidth - 20, newX));
            myPlayer.y = Math.max(20, Math.min(this.worldHeight - 20, newY));

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

        // Actualizar cámara
        this.updateCamera();

        // Actualizar bullets
        this.bullets.forEach((bullet) => {
            const radians = bullet.angle * Math.PI / 180;
            bullet.x += Math.cos(radians) * bullet.speed * (1 / 60);
            bullet.y += Math.sin(radians) * bullet.speed * (1 / 60);
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
        this.ctx.fillStyle = '#1a2a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Aplicar transformación de cámara
        this.ctx.save();
        this.ctx.scale(this.scale, this.scale);
        this.ctx.translate(-this.camera.x, -this.camera.y);

        // Dibujar fondo del mundo
        this.drawWorldBackground();

        // Dibujar tanques
        this.players.forEach((player) => {
            this.drawTank(player);
        });

        // Dibujar bullets
        this.bullets.forEach((bullet) => {
            this.drawBullet(bullet);
        });

        // Dibujar límites del mundo
        this.drawWorldBorders();

        this.ctx.restore();

        // Dibujar UI (sin transformación de cámara)
        this.drawUI();
    }

    drawWorldBackground() {
        // Fondo con patrón de grid
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;

        const gridSize = 50;

        // Líneas verticales
        for (let x = 0; x <= this.worldWidth; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.worldHeight);
            this.ctx.stroke();
        }

        // Líneas horizontales
        for (let y = 0; y <= this.worldHeight; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.worldWidth, y);
            this.ctx.stroke();
        }
    }

    drawWorldBorders() {
        this.ctx.strokeStyle = '#ff4444';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(0, 0, this.worldWidth, this.worldHeight);
    }

    drawTank(player) {
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle * Math.PI / 180);

        // Sombra
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(-13, -8, 26, 16);

        // Cuerpo del tanque
        ctx.fillStyle = player.color;
        ctx.fillRect(-15, -10, 30, 20);

        // Detalles del tanque
        ctx.fillStyle = this.lightenColor(player.color, 20);
        ctx.fillRect(-15, -10, 30, 4);
        ctx.fillRect(-15, 6, 30, 4);

        // Cañón
        ctx.fillStyle = '#666';
        ctx.fillRect(15, -2, 20, 4);

        // Torre
        ctx.fillStyle = this.darkenColor(player.color, 20);
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Nombre del jugador
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.strokeText(player.name, player.x, player.y - 30);
        ctx.fillText(player.name, player.x, player.y - 30);

        // Indicador si es el jugador local
        if (player.id === this.myPlayerId) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Barra de vida
        this.drawHealthBar(player);
    }

    drawHealthBar(player) {
        const ctx = this.ctx;
        const barWidth = 30;
        const barHeight = 4;
        const x = player.x - barWidth / 2;
        const y = player.y - 40;

        // Fondo de la barra
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.fillRect(x, y, barWidth, barHeight);

        // Vida actual
        const healthPercent = player.health / 100;
        ctx.fillStyle = healthPercent > 0.5 ? '#4CAF50' : healthPercent > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(x, y, barWidth * healthPercent, barHeight);

        // Borde
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, barWidth, barHeight);
    }

    drawBullet(bullet) {
        this.ctx.fillStyle = '#ffff00';
        this.ctx.strokeStyle = '#ffaa00';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
    }

    drawUI() {
        // Minimapa
        this.drawMinimap();
    }

    drawMinimap() {
        const minimapSize = 150;
        const minimapX = this.canvas.width - minimapSize - 20;
        const minimapY = this.canvas.height - minimapSize - 20;

        // Fondo del minimapa
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);

        // Borde
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

        // Escala del minimapa
        const scaleX = minimapSize / this.worldWidth;
        const scaleY = minimapSize / this.worldHeight;

        // Dibujar jugadores en el minimapa
        this.players.forEach((player) => {
            const x = minimapX + player.x * scaleX;
            const y = minimapY + player.y * scaleY;

            this.ctx.fillStyle = player.id === this.myPlayerId ? '#00ff00' : player.color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Mostrar área visible de la cámara
        const cameraX = minimapX + this.camera.x * scaleX;
        const cameraY = minimapY + this.camera.y * scaleY;
        const cameraW = (this.canvas.width / this.scale) * scaleX;
        const cameraH = (this.canvas.height / this.scale) * scaleY;

        this.ctx.strokeStyle = 'yellow';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(cameraX, cameraY, cameraW, cameraH);
    }

    // Utilidades de color
    lightenColor(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
    }

    darkenColor(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return "#" + (0x1000000 + (R > 255 ? 255 : R < 0 ? 0 : R) * 0x10000 +
            (G > 255 ? 255 : G < 0 ? 0 : G) * 0x100 +
            (B > 255 ? 255 : B < 0 ? 0 : B)).toString(16).slice(1);
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
}

// Inicializar juego cuando se carga la página
window.addEventListener('load', () => {
    new Game();
});