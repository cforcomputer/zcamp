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
  settings.set(data.settings);
  killmails.set(data.killmails);
});

// Handle new killmails received from the server
socket.on('newKillmail', (killmail) => {
  console.log('Received new killmail:', killmail);
  killmails.update(currentKillmails => [...currentKillmails, killmail]);
});

export default socket;
