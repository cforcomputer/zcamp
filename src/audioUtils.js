// audioUtils.js

class AudioManager {
  constructor() {
    this.sounds = new Map();
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    // Pre-create audio elements for each sound with correct paths
    const alerts = {
      default: "/audio_files/alert.wav",
      blue: "/audio_files/blue_alert.wav",
      orange: "/audio_files/orange_alert.wav",
    };

    Object.entries(alerts).forEach(([key, path]) => {
      const audio = new Audio(path);
      audio.preload = "auto";
      this.sounds.set(key, audio);
    });

    this.initialized = true;
  }

  playAlert(type = "default") {
    if (!this.initialized) this.init();

    const sound = this.sounds.get(type);
    if (sound) {
      // Clone node to allow overlapping sounds
      const playSound = sound.cloneNode();
      playSound.volume = 0.5; // Set a reasonable volume
      playSound.play().catch((err) => {
        console.error("Failed to play alert sound:", err);
      });
    }
  }

  // Test method to verify audio paths
  testAudio() {
    console.log(
      "Testing audio paths:",
      Array.from(this.sounds.entries()).map(([key, audio]) => ({
        key,
        src: audio.src,
      }))
    );
    this.playAlert("default");
  }
}

const audioManager = new AudioManager();
export default audioManager;
