class AudioManager {
    constructor(socket) {
        this.socket = socket;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.microphone = null;
        this.isRecording = false;
        this.isInitialized = false;
        this.audioChunks = [];
        this.volume = 0.8; // Volumen de recepción
        this.micVolume = 0.8; // Volumen del micrófono
        this.isMuted = false; // Solo afecta transmisión, NO recepción
        this.isPushToTalk = false;
        this.isTransmitting = false;
        this.packetsReceived = 0;
        this.packetsTransmitted = 0;

        // Referencias a elementos de UI
        this.statusIndicator = null;
        this.micButton = null;

        // Exponer globalmente para controles
        window.audioManager = this;

        this.setupUI();
        this.setupKeyboardControls();
        this.init();
    }

    setupUI() {
        // Referencias a elementos existentes
        this.statusIndicator = document.querySelector('#audioStatus').parentElement.querySelector('.status-dot');
        this.micButton = document.getElementById('toggleMic');

        // Event listeners para botones
        this.micButton.addEventListener('click', () => {
            this.toggleMicrophone();
        });

        document.getElementById('testAudio').addEventListener('click', () => {
            this.testAudioOutput();
        });

        // Configurar sliders de volumen
        const volumeSlider = document.getElementById('volumeSlider');
        const micSlider = document.getElementById('micSlider');

        if (volumeSlider) {
            volumeSlider.value = this.volume * 100;
            volumeSlider.addEventListener('input', (e) => {
                this.setVolume(e.target.value / 100);
                console.log('Volume set to:', this.volume);
            });
        }

        if (micSlider) {
            micSlider.value = this.micVolume * 100;
            micSlider.addEventListener('input', (e) => {
                this.setMicVolume(e.target.value / 100);
                console.log('Mic volume set to:', this.micVolume);
            });
        }
    }

    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            switch (e.code) {
                case 'KeyT':
                    if (!e.repeat) this.toggleMicrophone();
                    break;
                case 'KeyV':
                    if (!this.isPushToTalk && !e.repeat) {
                        this.isPushToTalk = true;
                        this.startTransmission();
                        console.log('Push-to-talk started');
                    }
                    break;
                case 'KeyM':
                    if (!e.repeat) this.toggleMute();
                    break;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'KeyV' && this.isPushToTalk) {
                this.isPushToTalk = false;
                this.stopTransmission();
                console.log('Push-to-talk ended');
            }
        });
    }

    async init() {
        try {
            this.updateStatus('audioStatus', 'Solicitando permisos...');
            this.setStatusColor('yellow');

            await this.setupAudioContext();

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });

            this.microphone = stream;
            this.updateStatus('micStatus', 'Disponible');

            this.setupMediaRecorder();
            this.setupSocketEvents();

            this.isInitialized = true;
            this.updateStatus('audioStatus', 'Listo ✓');
            this.setStatusColor('green');

            // Actualizar botón y empezar transmisión automática
            this.isTransmitting = true;
            this.updateMicButton();

            console.log('✅ Audio inicializado correctamente');
            console.log('🎧 Volumen de recepción:', this.volume);
            console.log('🎤 Volumen de micrófono:', this.micVolume);

        } catch (error) {
            console.error('❌ Error al acceder al micrófono:', error);
            this.updateStatus('audioStatus', 'Error: ' + error.message);
            this.setStatusColor('red');
        }
    }

    async setupAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000,
                latencyHint: 'interactive'
            });

            if (this.audioContext.state === 'suspended') {
                this.updateStatus('contextState', 'Suspendido - Click para activar');

                const resumeContext = async () => {
                    if (this.audioContext.state === 'suspended') {
                        await this.audioContext.resume();
                        this.updateStatus('contextState', 'Activo ✓');
                        console.log('🔊 AudioContext resumed');
                        document.removeEventListener('touchstart', resumeContext);
                        document.removeEventListener('click', resumeContext);
                    }
                };

                document.addEventListener('touchstart', resumeContext, {once: true});
                document.addEventListener('click', resumeContext, {once: true});
            } else {
                this.updateStatus('contextState', 'Activo ✓');
            }

        } catch (error) {
            console.error('❌ Error al crear AudioContext:', error);
            throw error;
        }
    }

    setupMediaRecorder() {
        if (!this.microphone) return;

        try {
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/ogg;codecs=opus'
            ];

            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }

            if (!selectedMimeType) {
                throw new Error('No supported audio format found');
            }

            console.log('🎵 Using audio format:', selectedMimeType);

            this.mediaRecorder = new MediaRecorder(this.microphone, {
                mimeType: selectedMimeType,
                audioBitsPerSecond: 64000
            });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && this.isTransmitting && !this.isMuted) {
                    this.audioChunks.push(event.data);
                    this.sendAudioChunk(event.data);
                    this.packetsTransmitted++;
                    this.updatePacketCount();
                }
            };

            this.mediaRecorder.onstart = () => {
                this.updateStatus('micStatus', '🔴 Grabando');
                this.setMicButtonRecording(true);
                console.log('🎙️ MediaRecorder started');
            };

            this.mediaRecorder.onstop = () => {
                this.updateStatus('micStatus', '⏹️ Detenido');
                this.setMicButtonRecording(false);
                console.log('🛑 MediaRecorder stopped');
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('❌ MediaRecorder error:', event.error);
                this.updateStatus('micStatus', 'Error: ' + event.error.message);
            };

            // Iniciar grabación automáticamente
            this.startRecording();

        } catch (error) {
            console.error('❌ Error al configurar MediaRecorder:', error);
            this.updateStatus('micStatus', 'Error: ' + error.message);
        }
    }

    startRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
            this.mediaRecorder.start(200);
            this.isRecording = true;
            console.log('▶️ Recording started');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.isTransmitting = false;
            console.log('⏹️ Recording stopped');
        }
    }

    toggleMicrophone() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
            this.isTransmitting = true;
        }
        this.updateMicButton();
        console.log('🎤 Microphone toggled. Recording:', this.isRecording, 'Transmitting:', this.isTransmitting);
    }

    startTransmission() {
        this.isTransmitting = true;
        this.setMicButtonRecording(true);
    }

    stopTransmission() {
        this.isTransmitting = false;
        this.setMicButtonRecording(false);
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.updateMicButton();
        console.log('🔇 Mute toggled:', this.isMuted);
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        console.log('🔊 Volume set to:', this.volume);
    }

    setMicVolume(volume) {
        this.micVolume = Math.max(0, Math.min(1, volume));
        console.log('🎙️ Mic volume set to:', this.micVolume);
    }

    async sendAudioChunk(audioBlob) {
        if (this.isMuted) {
            console.log('🔇 Audio muted, not sending');
            return;
        }

        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            this.socket.emit('audioData', arrayBuffer);
            console.log('📤 Audio chunk sent, size:', arrayBuffer.byteLength);
        } catch (error) {
            console.error('❌ Error al enviar audio:', error);
        }
    }

    setupSocketEvents() {
        this.socket.on('audioData', (data) => {
            console.log('📥 Audio data received from server');
            this.packetsReceived++;
            this.playAudio(data.audio);
        });

        // Debug adicional
        this.socket.on('connect', () => {
            console.log('🌐 Connected to server for audio');
        });

        this.socket.on('disconnect', () => {
            console.log('🔌 Disconnected from server');
        });
    }

    async playAudio(audioData) {
        console.log('🔊 Attempting to play audio, volume:', this.volume);

        if (!this.audioContext) {
            console.error('❌ AudioContext no disponible');
            return;
        }

        // NUNCA bloquear por mute en la recepción
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                this.updateStatus('contextState', 'Activo ✓');
                console.log('🔊 AudioContext resumed for playback');
            } catch (error) {
                console.error('❌ Error al reanudar AudioContext:', error);
                return;
            }
        }

        try {
            console.log('🎵 Decoding audio data, size:', audioData.byteLength);
            const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0));

            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();

            // Asegurar que el volumen se aplique correctamente
            gainNode.gain.value = this.volume;

            source.buffer = audioBuffer;
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            source.start();

            console.log('✅ Audio playing successfully, duration:', audioBuffer.duration, 'volume:', this.volume);

        } catch (error) {
            console.error('❌ Error al reproducir audio:', error);
            console.log('🔄 Trying fallback method...');
            this.playAudioFallback(audioData);
        }
    }

    async playAudioFallback(audioData) {
        try {
            console.log('🔄 Using fallback audio method');
            const blob = new Blob([audioData], {type: 'audio/webm'});
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);

            audio.volume = this.volume;
            await audio.play();

            audio.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
            });

            console.log('✅ Fallback audio playing');

        } catch (error) {
            console.error('❌ Error en método fallback:', error);
        }
    }

    testAudioOutput() {
        console.log('🧪 Testing audio output...');
        if (!this.audioContext) {
            console.log('❌ No AudioContext for test');
            return;
        }

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 440;
        gainNode.gain.value = this.volume * 0.3; // Tono de prueba más suave

        oscillator.start();
        oscillator.stop(this.audioContext.currentTime + 0.5);

        console.log('🔊 Test tone played at volume:', this.volume * 0.3);
    }

    // Métodos de UI
    updateStatus(elementId, status) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = status;
        }
    }

    setStatusColor(color) {
        if (this.statusIndicator) {
            this.statusIndicator.className = `status-dot ${color}`;
        }
    }

    updateMicButton() {
        if (!this.micButton) return;

        if (this.isMuted) {
            this.micButton.textContent = '🔇';
            this.micButton.className = 'audio-btn secondary';
            this.micButton.title = 'Micrófono silenciado (M para activar)';
        } else if (this.isRecording && this.isTransmitting) {
            this.micButton.textContent = '🎙️';
            this.micButton.className = 'audio-btn primary';
            this.micButton.title = 'Micrófono activo';
        } else {
            this.micButton.textContent = '🎤';
            this.micButton.className = 'audio-btn secondary';
            this.micButton.title = 'Micrófono inactivo';
        }
    }

    setMicButtonRecording(recording) {
        if (recording) {
            this.micButton.classList.add('recording');
        } else {
            this.micButton.classList.remove('recording');
        }
    }

    updatePacketCount() {
        const packetsElement = document.getElementById('packets');
        if (packetsElement) {
            packetsElement.textContent = `📤${this.packetsTransmitted} 📥${this.packetsReceived}`;
        }
    }

    destroy() {
        console.log('🧹 Cleaning up audio manager...');

        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
        }

        if (this.microphone) {
            this.microphone.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
    }
}