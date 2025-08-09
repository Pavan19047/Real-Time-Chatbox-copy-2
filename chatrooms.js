import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, query, where, orderBy, limit, setDoc, onSnapshot, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyDEpEbOdl7ysRoYZBj3phVcfA5wxE6W37c",
    authDomain: "real-time-chatbot-372f7.firebaseapp.com",
    projectId: "real-time-chatbot-372f7",
    storageBucket: "real-time-chatbot-372f7.appspot.com",
    messagingSenderId: "88476999060",
    appId: "1:88476999060:web:ec54d7298b84333d274381",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- DOM References ---
const chatroomListEl = document.getElementById('chatroom-list');
const searchBar = document.getElementById('search-bar');
let currentUser;

// --- Authentication ---
onAuthStateChanged(auth, user => {
    currentUser = user ? user : null;
    if (currentUser) {
        loadChatrooms();
        listenForMuteChanges();
    } else {
        signInAnonymously(auth).catch(err => console.error(err));
    }
});

// Add this to your DOM References at the top
const createRoomBtn = document.getElementById('create-room-btn');

// Add this new function anywhere in your file
/**
 * Creates a new chatroom document in Firestore.
 */
async function createNewChatroom() {
    const roomTitle = prompt("Please enter a name for the new chatroom:");

    if (roomTitle && roomTitle.trim() !== '') {
        try {
            const roomsRef = collection(db, 'chatrooms');
            await addDoc(roomsRef, {
                title: roomTitle,
                createdAt: serverTimestamp() // Good practice to add a creation time
            });
            // Reload the list to show the new room
            loadChatrooms();
        } catch (error) {
            console.error("Error creating new chatroom:", error);
            alert("Failed to create new room.");
        }
    } else {
        alert("Please enter a valid room name.");
    }
}

// Add this event listener at the end of your file
createRoomBtn.addEventListener('click', createNewChatroom);

// --- Main Data Loading Function ---
async function loadChatrooms() {
    if (!currentUser) return;
    try {
        const roomsRef = collection(db, 'chatrooms');
        const roomsSnapshot = await getDocs(roomsRef);
        
        const promises = roomsSnapshot.docs.map(async (roomDoc) => {
            const room = { id: roomDoc.id, ...roomDoc.data() };
            const lastMessage = await getLastMessage(room.id);
            const unreadCount = await getUnreadCount(room.id, currentUser.uid);
            return { room, lastMessage, unreadCount };
        });

        const chatroomData = await Promise.all(promises);

        chatroomData.sort((a, b) => (b.room.pinned || false) - (a.room.pinned || false));

        chatroomListEl.innerHTML = '';
        chatroomData.forEach(data => {
            const roomElement = createRoomElement(data.room, data.lastMessage, data.unreadCount);
            addSwipeToMute(roomElement);
            chatroomListEl.appendChild(roomElement);
        });
    } catch (error) {
        console.error("Error loading chatrooms:", error);
        alert("Could not load chatrooms.");
    }
}

// --- Helper Functions ---

async function getLastMessage(roomId) {
    const messagesRef = collection(db, 'chatrooms', roomId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    return snapshot.empty ? { text: 'No messages yet...', timestamp: null } : snapshot.docs[0].data();
}

async function getUnreadCount(roomId, userId) {
    const readStatusRef = doc(db, 'reads', userId, 'rooms', roomId);
    const readDoc = await getDoc(readStatusRef);
    const lastReadTimestamp = readDoc.exists() ? readDoc.data().lastReadTimestamp : null;

    const messagesRef = collection(db, 'chatrooms', roomId, 'messages');
    const unreadQuery = lastReadTimestamp ? query(messagesRef, where('timestamp', '>', lastReadTimestamp)) : query(messagesRef);
    const unreadSnapshot = await getDocs(unreadQuery);
    return unreadSnapshot.size;
}

function createRoomElement(room, lastMessage, unreadCount) {
    const roomElement = document.createElement('div');
    roomElement.className = 'chatroom-item';
    roomElement.dataset.roomId = room.id;
    roomElement.dataset.roomTitle = room.title;

    const formattedTimestamp = lastMessage.timestamp ? lastMessage.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    roomElement.innerHTML = `
        <div class="chatroom-details">
            <div class="chatroom-title">${room.title || 'Untitled Chat'}</div>
            <div class="last-message">${lastMessage.text}</div>
        </div>
        <div class="chatroom-meta">
            <div class="last-message-time">${formattedTimestamp}</div>
            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
        </div>
        <button class="mute-button" data-room-id="${room.id}">Mute</button>
    `;

    const details = roomElement.querySelector('.chatroom-details');
    details.addEventListener('click', () => {
        window.location.href = `chat.html?roomId=${room.id}&title=${encodeURIComponent(room.title)}`;
    });

    return roomElement;
}

// --- Mute, Pin, and Swipe Logic ---

async function toggleMute(roomId, button) {
    if (!currentUser) return;
    const muteRef = doc(db, 'mutes', currentUser.uid, 'rooms', roomId);
    const muteDoc = await getDoc(muteRef);
    const newMuteStatus = !muteDoc.exists() || !muteDoc.data().muted;
    try {
        await setDoc(muteRef, { muted: newMuteStatus });
    } catch (error) {
        console.error("Error updating mute status:", error);
    }
}


function updateMuteButtonUI(button, isMuted) {
    button.textContent = isMuted ? 'Unmute' : 'Mute';
    button.classList.toggle('muted', isMuted);
}

function listenForMuteChanges() {
    if (!currentUser) return;
    const mutesRef = collection(db, 'mutes', currentUser.uid, 'rooms');
    onSnapshot(mutesRef, (snapshot) => {
        snapshot.docs.forEach(doc => {
            const roomId = doc.id;
            const isMuted = doc.data().muted;
            const button = document.querySelector(`.mute-button[data-room-id="${roomId}"]`);
            if (button) {
                updateMuteButtonUI(button, isMuted);
            }
        });
    });
}

function addSwipeToMute(element) {
    let longPressTimeout;
    element.addEventListener('mousedown', () => {
        longPressTimeout = setTimeout(() => {
            const roomId = element.dataset.roomId;
            const muteButton = element.querySelector('.mute-button');
            toggleMute(roomId, muteButton);
        }, 800);
    });
    element.addEventListener('mouseup', () => clearTimeout(longPressTimeout));
    element.addEventListener('mouseleave', () => clearTimeout(longPressTimeout));
}

// --- Event Delegation for Buttons ---
chatroomListEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('mute-button')) {
        toggleMute(e.target.dataset.roomId, e.target);
    }
});

// --- Search Bar ---
searchBar.addEventListener('keyup', (e) => {
    const term = e.target.value.toLowerCase();
    const rooms = chatroomListEl.getElementsByClassName('chatroom-item');
    Array.from(rooms).forEach((room) => {
        const title = room.querySelector('.chatroom-title').textContent.toLowerCase();
        room.style.display = title.includes(term) ? 'flex' : 'none';
    });
});