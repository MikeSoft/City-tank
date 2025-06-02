class MobileControls {
    constructor() {
        this.joystick = document.getElementById('joystick');
        this.joystickKnob = document.getElementById('joystickKnob');
        this.shootButton = document.getElementById('shootButton');

        this.isDragging = false;
        this.joystickCenter = {x: 60, y: 60}; // Centro del joystick
        this.maxDistance = 40; // Radio máximo

        this.setupJoystick();
        this.setupShootButton();
    }

    setupJoystick() {
        // Touch events
        this.joystick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.isDragging = true;
        });

        this.joystick.addEventListener('touchmove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();

            const touch = e.touches[0];
            const rect = this.joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            let deltaX = touch.clientX - centerX;
            let deltaY = touch.clientY - centerY;

            // Limitar al radio máximo
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > this.maxDistance) {
                deltaX = (deltaX / distance) * this.maxDistance;
                deltaY = (deltaY / distance) * this.maxDistance;
            }

            // Actualizar posición del knob
            this.joystickKnob.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

            // Actualizar controles globales
            window.mobileControls.move.x = deltaX / this.maxDistance;
            window.mobileControls.move.y = deltaY / this.maxDistance;
        });

        this.joystick.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.isDragging = false;

            // Resetear joystick
            this.joystickKnob.style.transform = 'translate(0px, 0px)';
            window.mobileControls.move.x = 0;
            window.mobileControls.move.y = 0;
        });

        // Mouse events para testing en PC
        this.joystick.addEventListener('mousedown', (e) => {
            this.isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            const rect = this.joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            let deltaX = e.clientX - centerX;
            let deltaY = e.clientY - centerY;

            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > this.maxDistance) {
                deltaX = (deltaX / distance) * this.maxDistance;
                deltaY = (deltaY / distance) * this.maxDistance;
            }

            this.joystickKnob.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

            window.mobileControls.move.x = deltaX / this.maxDistance;
            window.mobileControls.move.y = deltaY / this.maxDistance;
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.joystickKnob.style.transform = 'translate(0px, 0px)';
            window.mobileControls.move.x = 0;
            window.mobileControls.move.y = 0;
        });
    }

    setupShootButton() {
        this.shootButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            window.mobileControls.shoot = true;
        });

        this.shootButton.addEventListener('click', (e) => {
            e.preventDefault();
            window.mobileControls.shoot = true;
        });
    }
}

// Inicializar controles móviles
window.addEventListener('load', () => {
    new MobileControls();
});