class AudioManager {
    constructor(socket) {
        this.socket = socket;
        this.audioContext = null;
        this.microphone = null;
        this.processor = null;
        this.gainNode = null;

        // Estado
        this.isInitialized = false;
        this.isTransmitting = false;
        this.isMuted = false;

        // Configuración de audio optimizada para tiempo real
        this.sampleRate = 16000; // Reducir para menos latencia
        this.bufferSize = 1024; // Buffer pequeño para baja latencia
        this.channels = 1; // Mono para menos datos

        // Control de volumen
        this.micVolume = 1.0;
        this.outputVolume = 1.0;

        // Buffer para audio entrante
        this.audioQueue = [];
        this.isPlaying = false;

        this.createAudioUI();
        this.init();
    }

    createAudioUI() {
        const audioUI = document.createElement('div');
        audioUI.id = 'audioUI';
        audioUI.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 12px;
            border-radius: 8px;
            font-size: 12px;
            z-index: 1000;
            min-width: 200px;
        `;

        audioUI.innerHTML = `
            <div style="margin-bottom: 8px; font-weight: bold;">🎙️ Audio Chat</div>
            <div>Status: <span id="audioStatus">Inicializando...</span></div>
            <div>Latencia: <span id="latency">-</span>ms</div>
            <div style="margin: 8px 0;">
                <button id="toggleMic" style="padding: 4px 8px; margin-right: 5px;">🎤 ON</button>
                <button id="toggleMute" style="padding: 4px 8px;">🔊</button>
            </div>
            <div style="margin: 4px 0;">
                <label>Mic: </label>
                <input type="range" id="micVolume" min="0" max="2" step="0.1" value="1" style="width: 80px;">
            </div>
            <div style="margin: 4px 0;">
                <label>Vol: </label>
                <input type="range" id="outputVolume" min="0" max="2" step="0.1" value="1" style="width: 80px;">
            </div>
            <div id="audioDebug" style="margin-top: 8px; font-size: 10px; color: #ccc;"></div>
        `;

        document.getElementById('gameContainer').appendChild(audioUI);
        this.setupUIEvents();
    }

    setupUIEvents() {
        document.getElementById('toggleMic').addEventListener('click', () => {
            this.toggleMicrophone();
        });

        document.getElementById('toggleMute').addEventListener('click', () => {
            this.toggleMute();
        });

        document.getElementById('micVolume').addEventListener('input', (e) => {
            this.micVolume = parseFloat(e.target.value);
            if (this.gainNode) {
                this.gainNode.gain.value = this.micVolume;
            }
        });

        document.getElementById('outputVolume').addEventListener('input', (e) => {
            this.outputVolume = parseFloat(e.target.value);
        });
    }

    async init() {
        try {
            this.updateStatus('Solicitando permisos...');

            // Crear contexto de audio optimizado
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate,
                latencyHint: 'interactive' // Priorizar baja latencia
            });

            // Reanudar contexto si está suspendido
            await this.resumeAudioContext();

            // Obtener micrófono con configuración optimizada
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false, // Desactivar para control manual
                    sampleRate: this.sampleRate,
                    channelCount: this.channels
                }
            });

            this.microphone = stream;
            this.setupAudioProcessing();
            this.setupSocketEvents();

            this.isInitialized = true;
            this.updateStatus('✅ Conectado');
            this.startTransmitting();

        } catch (error) {
            console.error('Error inicializando audio:', error);
            this.updateStatus('❌ Error: ' + error.message);
        }
    }

    async resumeAudioContext() {
        if (this.audioContext.state === 'suspended') {
            // Esperar interacción del usuario para reanudar
            const resumeContext = async () => {
                try {
                    await this.audioContext.resume();
                    document.removeEventListener('touchstart', resumeContext);
                    document.removeEventListener('click', resumeContext);
                } catch (error) {
                    console.error('Error resumiendo contexto:', error);
                }
            };

            document.addEventListener('touchstart', resumeContext, {once: true});
            document.addEventListener('click', resumeContext, {once: true});

            this.updateStatus('👆 Click para activar audio');
        }
    }

    setupAudioProcessing() {
        try {
            // Crear cadena de procesamiento de audio
            const source = this.audioContext.createMediaStreamSource(this.microphone);
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.micVolume;

            // Usar ScriptProcessorNode para compatibilidad (AudioWorklet es mejor pero más complejo)
            this.processor = this.audioContext.createScriptProcessor(this.bufferSize, this.channels, this.channels);

            // Conectar cadena de audio
            source.connect(this.gainNode);
            this.gainNode.connect(this.processor);

            // Procesar audio en tiempo real
            this.processor.onaudioprocess = (event) => {
                if (!this.isTransmitting || this.isMuted) return;

                const inputData = event.inputBuffer.getChannelData(0);
                const audioData = new Float32Array(inputData);

                // Enviar datos inmediatamente
                this.sendAudioData(audioData);
            };

            // IMPORTANTE: Conectar a destination para evitar que se optimice
            this.processor.connect(this.audioContext.destination);

        } catch (error) {
            console.error('Error configurando procesamiento:', error);
            this.updateStatus('❌ Error de procesamiento');
        }
    }

    sendAudioData(audioData) {
        try {
            // Comprimir datos para reducir ancho de banda
            const compressedData = this.compressAudio(audioData);

            // Enviar via socket con timestamp para medir latencia
            this.socket.emit('audioStream', {
                data: compressedData,
                timestamp: Date.now(),
                sampleRate: this.sampleRate
            });

        } catch (error) {
            console.error('Error enviando audio:', error);
        }
    }

    compressAudio(audioData) {
        // Conversión simple a Int16 para reducir tamaño (de Float32 a Int16)
        const compressed = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            // Convertir de [-1, 1] a [-32768, 32767]
            compressed[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
        }
        return compressed;
    }

    decompressAudio(compressedData) {
        // Convertir de Int16 de vuelta a Float32
        const decompressed = new Float32Array(compressedData.length);
        for (let i = 0; i < compressedData.length; i++) {
            // Convertir de [-32768, 32767] a [-1, 1]
            decompressed[i] = compressedData[i] / 32767;
        }
        return decompressed;
    }

    setupSocketEvents() {
        this.socket.on('audioStream', (data) => {
            // Calcular latencia
            const latency = Date.now() - data.timestamp;
            document.getElementById('latency').textContent = latency;

            // Reproducir audio inmediatamente
            this.playAudioStream(data);
        });

        // Debug
        let audioPackets = 0;
        setInterval(() => {
            document.getElementById('audioDebug').textContent = `Packets/s: ${audioPackets}`;
            audioPackets = 0;
        }, 1000);

        this.socket.on('audioStream', () => {
            audioPackets++;
        });
    }

    async playAudioStream(audioData) {
        try {
            if (!this.audioContext || this.audioContext.state !== 'running') return;

            // Descomprimir datos
            const decompressedData = this.decompressAudio(new Int16Array(audioData.data));

            // Crear buffer de audio
            const audioBuffer = this.audioContext.createBuffer(
                this.channels,
                decompressedData.length,
                audioData.sampleRate || this.sampleRate
            );

            // Copiar datos al buffer
            audioBuffer.getChannelData(0).set(decompressedData);

            // Crear fuente y reproducir
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();

            gainNode.gain.value = this.outputVolume;

            source.buffer = audioBuffer;
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            // Reproducir inmediatamente para mínima latencia
            source.start(0);

        } catch (error) {
            console.error('Error reproduciendo audio:', error);
        }
    }

    startTransmitting() {
        this.isTransmitting = true;
        this.updateMicButton();
        this.updateStatus('🔴 Transmitiendo');
    }

    stopTransmitting() {
        this.isTransmitting = false;
        this.updateMicButton();
        this.updateStatus('⏸️ Pausado');
    }

    toggleMicrophone() {
        if (this.isTransmitting) {
            this.stopTransmitting();
        } else {
            this.startTransmitting();
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        const button = document.getElementById('toggleMute');
        button.textContent = this.isMuted ? '🔇' : '🔊';

        if (this.isMuted) {
            this.updateStatus('🔇 Silenciado');
        } else if (this.isTransmitting) {
            this.updateStatus('🔴 Transmitiendo');
        }
    }

    updateMicButton() {
        const button = document.getElementById('toggleMic');
        if (button) {
            button.textContent = this.isTransmitting ? '🎤 ON' : '🎤 OFF';
            button.style.background = this.isTransmitting ? '#4CAF50' : '#f44336';
        }
    }

    updateStatus(status) {
        const element = document.getElementById('audioStatus');
        if (element) {
            element.textContent = status;
        }
    }

    // Limpiar recursos al salir
    destroy() {
        this.isTransmitting = false;

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }

        if (this.gainNode) {
            this.gainNode.disconnect();
        }

        if (this.microphone) {
            this.microphone.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }

        const audioUI = document.getElementById('audioUI');
        if (audioUI) {
            audioUI.remove();
        }
    }
}