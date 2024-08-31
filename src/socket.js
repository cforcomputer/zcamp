// socket.js
import { io } from 'socket.io-client';

// Initialize the socket connection to your server
const socket = io('http://localhost:3000'); // Replace with your actual server URL

// Handle connection and disconnection events
socket.on('connect', () => {
  console.log('Connected to server with socket id:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

export default socket;
