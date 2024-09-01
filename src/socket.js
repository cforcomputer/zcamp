// socket.js
import { io } from 'socket.io-client';
import { killmails, settings } from './store';

// Initialize the socket connection to your server
const socket = io('http://localhost:3000'); // Replace with your actual server URL

// Handle connection and disconnection events
socket.on('connect', () => {
  console.log('Connected to server with socket id:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

// Handle initial data received from the server
socket.on('initialData', (data) => {
  console.log('Received initialData:', data);
  settings.set(data.settings); // Set user settings in the store
  killmails.set(data.killmails); // Set killmails in the store
});

let audio = new Audio('audio_files/alert.wav'); 

// Function to play sound for new killmails
function playSound() {
  let audioAlertEnabled;
  settings.subscribe(value => {
    audioAlertEnabled = value.audio_alerts_enabled; // Get the current value of audio_alerts_enabled
  });

  if (audioAlertEnabled) {
    audio.play().catch(err => {
      console.error('Error playing audio:', err);
    });
  }
}

// Handle new killmails received from the server
socket.on('newKillmail', (killmail) => {
  console.log('Received new killmail:', killmail);
  killmails.update(currentKillmails => [...currentKillmails, killmail]); // Update killmails store
  playSound();
});

export default socket;
