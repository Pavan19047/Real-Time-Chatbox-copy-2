import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  doc,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js'

// --- Firebase Config ---
// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyDEpEbOdl7ysRoYZBj3phVcfA5wxE6W37c",
    authDomain: "real-time-chatbot-372f7.firebaseapp.com",
    projectId: "real-time-chatbot-372f7",
    storageBucket: "real-time-chatbot-372f7.firebasestorage.app", // <-- This is the corrected line
    messagingSenderId: "88476999060",
    appId: "1:88476g999060:web:ec54d7298b84333d274381",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)

// --- DOM References ---
const sendButton = document.querySelector('.send-button')
const messageInput = document.querySelector('.message-input')
const chatArea = document.querySelector('.chat-area')
const roomTitleEl = document.querySelector('.room-title')
const backButton = document.querySelector('.back-button')
const attachFileButton = document.getElementById('attach-file-button')
const imageUploadInput = document.getElementById('image-upload-input')
const imagePreviewContainer = document.getElementById('image-preview-container')
const imagePreview = document.getElementById('image-preview')
const removeImageBtn = document.getElementById('remove-image-btn')

let typingTimeout = null
let isTyping = false
const urlParams = new URLSearchParams(window.location.search)
const roomId = urlParams.get('roomId')
const roomTitle = urlParams.get('title')
let currentUser = null
let lastMessageDate = null
let selectedImageFile = null

if (!roomId || !roomTitle) {
  window.location.href = 'chatrooms.html'
} else {
  roomTitleEl.textContent = roomTitle
}

backButton.addEventListener('click', () => {
  window.location.href = 'chatrooms.html'
})

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user
    sendButton.disabled = false
    listenForMessages(roomId)
  } else {
    signInAnonymously(auth).catch(err => console.error(err))
  }
})

sendButton.addEventListener('click', sendMessage)
messageInput.addEventListener('keydown', event => {
  if (!isTyping) {
    setTypingStatus(true)
    isTyping = true
  }
  clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => {
    setTypingStatus(false)
    isTyping = false
  }, 1200)

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
})

messageInput.addEventListener('blur', () => {
  setTypingStatus(false)
  isTyping = false
})

async function sendMessage () {
  const text = messageInput.value.trim()
  if ((text === '' && !selectedImageFile) || !currentUser) return

  sendButton.disabled = true
  sendButton.textContent = 'Sending...'

  try {
    let imageUrl = ''
    if (selectedImageFile) {
      imageUrl = await uploadImage(selectedImageFile)
    }
    const messagesRef = collection(db, 'chatrooms', roomId, 'messages')
    await addDoc(messagesRef, {
      senderId: currentUser.uid,
      text: text,
      imageUrl: imageUrl,
      timestamp: serverTimestamp(),
      deliveredTo: [currentUser.uid],
      seenBy: []
    })
    messageInput.value = ''
    setTypingStatus(false)
    isTyping = false
    selectedImageFile = null
    imagePreview.src = ''
    imagePreviewContainer.style.display = 'none'
  } catch (error) {
    console.error('Error sending message:', error)
  } finally {
    sendButton.disabled = false
    sendButton.textContent = 'Send'
    messageInput.focus()
  }
}

function listenForMessages (currentRoomId) {
  const messagesRef = collection(db, 'chatrooms', currentRoomId, 'messages')
  const q = query(messagesRef, orderBy('timestamp'))
  let lastSnapshot = null

  async function markAllUnseenAsSeen (snapshot, myUid) {
    for (const docSnap of snapshot.docs) {
      const message = { ...docSnap.data(), id: docSnap.id }
      const isSent = message.senderId === myUid
      if (!isSent && message.seenBy && !message.seenBy.includes(myUid)) {
        const msgRef = doc(
          db,
          'chatrooms',
          currentRoomId,
          'messages',
          docSnap.id
        )
        await updateDoc(msgRef, {
          seenBy: [...message.seenBy, myUid]
        })
      }
    }
  }

  onSnapshot(q, async snapshot => {
    chatArea.innerHTML = ''
    lastMessageDate = null
    removeTypingIndicator()
    let myUid = currentUser?.uid
    lastSnapshot = snapshot

    for (const docSnap of snapshot.docs) {
      const message = { ...docSnap.data(), id: docSnap.id }
      const isSent = message.senderId === myUid
      displayMessage(message, isSent, myUid)

      if (
        !isSent &&
        message.deliveredTo &&
        !message.deliveredTo.includes(myUid)
      ) {
        const msgRef = doc(
          db,
          'chatrooms',
          currentRoomId,
          'messages',
          docSnap.id
        )
        await updateDoc(msgRef, {
          deliveredTo: [...message.deliveredTo, myUid]
        })
      }
    }

    if (document.hasFocus()) {
      await markAllUnseenAsSeen(snapshot, myUid)
    }

    if (currentUser) {
      markAsRead(currentUser.uid, currentRoomId)
    }
    chatArea.scrollTop = chatArea.scrollHeight
  })

  listenForTyping(currentRoomId)

  window.addEventListener('focus', async () => {
    if (lastSnapshot && currentUser) {
      await markAllUnseenAsSeen(lastSnapshot, currentUser.uid)
    }
  })
}

function markAsRead (userId, currentRoomId) {
  const readStatusRef = doc(db, 'reads', userId, 'rooms', currentRoomId)
  setDoc(
    readStatusRef,
    { lastReadTimestamp: serverTimestamp() },
    { merge: true }
  )
}

function displayMessage (message, isSent, myUid) {
  const messageDate =
    message.timestamp && typeof message.timestamp.toDate === 'function'
      ? message.timestamp.toDate()
      : new Date()

  if (
    !lastMessageDate ||
    lastMessageDate.toDateString() !== messageDate.toDateString()
  ) {
    createAndDisplayDateSeparator(messageDate)
  }
  lastMessageDate = messageDate

  const messageBubble = document.createElement('div')
  messageBubble.classList.add('message-bubble', isSent ? 'sent' : 'received')

  if (message.imageUrl) {
    const imageDiv = document.createElement('div')
    imageDiv.classList.add('message-image')
    const img = document.createElement('img')
    img.src = message.imageUrl
    img.alt = 'Image'
    imageDiv.appendChild(img)
    messageBubble.appendChild(imageDiv)
  }

  if (message.text) {
    const messageText = document.createElement('div')
    messageText.classList.add('message-text')
    messageText.textContent = message.text
    messageBubble.appendChild(messageText)
  }

  const messageTimestamp = document.createElement('div')
  messageTimestamp.classList.add('message-timestamp')
  messageTimestamp.textContent = messageDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  if (isSent) {
    const readReceipts = document.createElement('span')
    readReceipts.classList.add('read-receipts')
    let deliveredCount = (message.deliveredTo || []).filter(
      uid => uid !== myUid
    ).length
    let seenCount = (message.seenBy || []).filter(uid => uid !== myUid).length

    if (seenCount > 0) {
      readReceipts.innerHTML = '<span style="color:blue">✓✓</span>'
      readReceipts.classList.add('read')
    } else if (deliveredCount > 0) {
      readReceipts.textContent = '✓✓'
    } else {
      readReceipts.textContent = '✓'
    }
    messageTimestamp.appendChild(readReceipts)
  }
  messageBubble.appendChild(messageTimestamp)
  chatArea.appendChild(messageBubble)
}

function setTypingStatus (isTyping) {
  if (!currentUser) return
  const typingRef = doc(db, 'chatrooms', roomId, 'typing', currentUser.uid)
  setDoc(typingRef, { typing: isTyping, timestamp: serverTimestamp() })
}

function listenForTyping (currentRoomId) {
  const typingCol = collection(db, 'chatrooms', currentRoomId, 'typing')
  onSnapshot(typingCol, snapshot => {
    let someoneTyping = false
    snapshot.docs.forEach(docSnap => {
      if (docSnap.id !== currentUser?.uid && docSnap.data().typing) {
        someoneTyping = true
      }
    })
    if (someoneTyping) {
      showTypingIndicator()
    } else {
      removeTypingIndicator()
    }
  })
}

function showTypingIndicator () {
  if (document.getElementById('typing-indicator')) return
  const typingDiv = document.createElement('div')
  typingDiv.className = 'message-bubble received typing-indicator'
  typingDiv.id = 'typing-indicator'
  typingDiv.innerHTML =
    '<div class="message-text"><span></span><span></span><span></span></div>'
  chatArea.appendChild(typingDiv)
  chatArea.scrollTop = chatArea.scrollHeight
}

function removeTypingIndicator () {
  const typingDiv = document.getElementById('typing-indicator')
  if (typingDiv) typingDiv.remove()
}

function createAndDisplayDateSeparator (date) {
  const separator = document.createElement('div')
  separator.classList.add('date-separator')
  const separatorText = document.createElement('span')
  separatorText.textContent = formatDateSeparator(date)
  separator.appendChild(separatorText)
  chatArea.appendChild(separator)
}

function formatDateSeparator (date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }
}

attachFileButton.addEventListener('click', () => {
  imageUploadInput.value = ''
  imageUploadInput.click()
})

imageUploadInput.addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    alert('File is too large. Please select an image under 5MB.')
    return
  }
  selectedImageFile = file
  const reader = new FileReader()
  reader.onload = function (evt) {
    imagePreview.src = evt.target.result
    imagePreviewContainer.style.display = 'block'
  }
  reader.readAsDataURL(file)
})

removeImageBtn.addEventListener('click', () => {
  selectedImageFile = null
  imagePreview.src = ''
  imagePreviewContainer.style.display = 'none'
})

async function uploadImage(file) {
  const uniqueFileName = `${Date.now()}-${file.name}`;
  const storageRef = ref(
    storage,
    `chatrooms/${roomId}/images/${uniqueFileName}`
  );

  const uploadTask = uploadBytesResumable(storageRef, file);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log('Upload is ' + progress + '% done');
      },
      (error) => {
        // Handle unsuccessful uploads
        console.error("Upload failed:", error);
        reject(error);
      },
      () => {
        // Handle successful uploads on complete
        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
          console.log('File available at', downloadURL);
          resolve(downloadURL);
        });
      }
    );
  });
}