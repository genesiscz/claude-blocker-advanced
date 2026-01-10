// Offscreen document for audio playback
// This document handles playing notification sounds using the Web Audio API

interface PlaySoundMessage {
  type: "PLAY_SOUND";
  sound: "subtle" | "clear" | "say";
  volume: number; // 0-100
  message?: string; // For "say" mode
}

interface StopSoundMessage {
  type: "STOP_SOUND";
}

type OffscreenMessage = PlaySoundMessage | StopSoundMessage;

// Audio context for generating sounds
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Generate a subtle chime sound using Web Audio API
function playSubtleChime(volume: number): void {
  const ctx = getAudioContext();
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);
  gainNode.gain.value = volume / 100;

  // Create a pleasant two-note chime
  const frequencies = [523.25, 659.25]; // C5, E5
  const now = ctx.currentTime;

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = freq;

    // Envelope: quick attack, gradual decay
    noteGain.gain.setValueAtTime(0, now + i * 0.15);
    noteGain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.05);
    noteGain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.4);

    osc.connect(noteGain);
    noteGain.connect(gainNode);

    osc.start(now + i * 0.15);
    osc.stop(now + i * 0.15 + 0.5);
  });

  console.log("[Offscreen] Playing subtle chime at volume:", volume);
}

// Generate a clear attention bell sound
function playClearBell(volume: number): void {
  const ctx = getAudioContext();
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);
  gainNode.gain.value = volume / 100;

  // Create a bell-like sound with harmonics
  const baseFreq = 880; // A5
  const harmonics = [1, 2, 2.4, 3, 4.2, 5.4];
  const now = ctx.currentTime;

  harmonics.forEach((mult, i) => {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();

    osc.type = i === 0 ? "sine" : "triangle";
    osc.frequency.value = baseFreq * mult;

    // Amplitude decreases with harmonic number
    const amplitude = 0.4 / (i + 1);
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(amplitude, now + 0.01);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.connect(noteGain);
    noteGain.connect(gainNode);

    osc.start(now);
    osc.stop(now + 0.9);
  });

  console.log("[Offscreen] Playing clear bell at volume:", volume);
}

// Play sound based on type
function playSound(sound: "subtle" | "clear", volume: number): void {
  if (sound === "subtle") {
    playSubtleChime(volume);
  } else if (sound === "clear") {
    playClearBell(volume);
  }
}

// Use Web Speech API for text-to-speech (macOS "say" equivalent)
async function speakText(text: string, volume: number): Promise<void> {
  // Check if speech synthesis is available
  if (!("speechSynthesis" in window)) {
    console.error("[Offscreen] Speech synthesis not available");
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = volume / 100;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  // Try to use a natural-sounding voice
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(
    (v) => v.name.includes("Samantha") || v.name.includes("Daniel") || v.lang.startsWith("en")
  );
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  window.speechSynthesis.speak(utterance);
  console.log("[Offscreen] Speaking:", text, "at volume:", volume);
}

// Stop all audio
function stopSound(): void {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  console.log("[Offscreen] Received message:", message);

  if (message.type === "PLAY_SOUND") {
    if (message.sound === "say" && message.message) {
      speakText(message.message, message.volume)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
    } else if (message.sound === "subtle" || message.sound === "clear") {
      try {
        playSound(message.sound, message.volume);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
      return false; // Synchronous response
    } else {
      sendResponse({ success: false, error: "Invalid sound type" });
      return false;
    }
    return true; // Async response for "say"
  }

  if (message.type === "STOP_SOUND") {
    stopSound();
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// Load voices (they may not be available immediately)
if ("speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    console.log("[Offscreen] Voices loaded:", window.speechSynthesis.getVoices().length);
  });
}

console.log("[Offscreen] Offscreen document loaded");
