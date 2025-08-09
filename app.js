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
  updateDoc,
  getDocs,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'
// Add these new imports for Firebase Storage
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js'

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: 'AIzaSyDEpEbOdl7ysRoYZBj3phVcfA5wxE6W37c',
  authDomain: 'real-time-chatbot-372f7.firebaseapp.com',
  projectId: 'real-time-chatbot-372f7',
  storageBucket: 'real-time-chatbot-372f7.appspot.com',
  messagingSenderId: '88476999060',
  appId: '1:88476999060:web:ec54d7298b84333d274381'
}

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app) // Initialize Storage

// --- DOM References ---
const sendButton = document.querySelector('.send-button')
const messageInput = document.querySelector('.message-input')
const chatArea = document.querySelector('.chat-area')
const roomTitleEl = document.querySelector('.room-title')
const backButton = document.querySelector('.back-button')
const attachFileButton = document.getElementById('attach-file-button')
const imageUploadInput = document.getElementById('image-upload-input')

// Typing indicator state
let typingTimeout = null
let isTyping = false

// --- Get Room ID and Title from URL ---
const urlParams = new URLSearchParams(window.location.search)
const roomId = urlParams.get('roomId')
const roomTitle = urlParams.get('title')

// --- Global State ---
let currentUser = null
let lastMessageDate = null

// --- Initial Setup ---
if (!roomId || !roomTitle) {
  // Redirect if no room is specified
  window.location.href = 'chatrooms.html'
} else {
  roomTitleEl.textContent = roomTitle
}

// --- Back Button Functionality ---
backButton.addEventListener('click', () => {
  window.location.href = 'chatrooms.html'
})

// --- Authentication ---
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user
    sendButton.disabled = false
    listenForMessages(roomId) // Use the dynamic roomId
  } else {
    signInAnonymously(auth).catch(err => console.error(err))
  }
})

// --- Event Listeners for Sending Messages ---
sendButton.addEventListener('click', sendMessage)
messageInput.addEventListener('keydown', event => {
  // Typing indicator logic
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

// On blur, clear typing status
messageInput.addEventListener('blur', () => {
  setTypingStatus(false)
  isTyping = false
})

/**
 * Sends a message to the current chat room.
 */
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
    const docRef = await addDoc(messagesRef, {
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
    // Reset image preview
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

/**
 * Listens for real-time messages in the current room.
 */
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

    // Remove typing indicator if present
    removeTypingIndicator()

    let myUid = currentUser?.uid
    lastSnapshot = snapshot

    for (const docSnap of snapshot.docs) {
      const message = { ...docSnap.data(), id: docSnap.id }
      const isSent = message.senderId === myUid
      displayMessage(message, isSent, myUid)

      // If received and not delivered, update deliveredTo
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

    // Mark all unseen as seen if window is focused
    if (document.hasFocus()) {
      await markAllUnseenAsSeen(snapshot, myUid)
    }

    if (currentUser) {
      markAsRead(currentUser.uid, currentRoomId)
    }
    chatArea.scrollTop = chatArea.scrollHeight
  })

  // Listen for typing status
  listenForTyping(currentRoomId)

  // Listen for window focus to update seen status immediately
  window.addEventListener('focus', async () => {
    if (lastSnapshot && currentUser) {
      await markAllUnseenAsSeen(lastSnapshot, currentUser.uid)
    }
  })
}

/**
 * Updates the user's last read timestamp for the room.
 */
function markAsRead (userId, currentRoomId) {
  const readStatusRef = doc(db, 'reads', userId, 'rooms', currentRoomId)
  setDoc(
    readStatusRef,
    { lastReadTimestamp: serverTimestamp() },
    { merge: true }
  )
}

// (The createAndDisplayDateSeparator, and formatDateSeparator functions remain the same)

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

  // If imageUrl is present, show image preview
  if (message.imageUrl) {
    const imageDiv = document.createElement('div')
    imageDiv.classList.add('message-image')
    const img = document.createElement('img')
    img.src = message.imageUrl
    img.alt = 'Image'
    img.style.maxWidth = '180px'
    img.style.maxHeight = '180px'
    img.style.borderRadius = '8px'
    img.style.display = 'block'
    img.style.marginBottom = '4px'
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

  // --- Read Receipt Logic ---
  if (isSent) {
    const readReceipts = document.createElement('span')
    readReceipts.classList.add('read-receipts')
    // WhatsApp style: ✓ = sent, ✓✓ = delivered, ✓✓ (blue) = seen
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

// --- Typing Indicator ---
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

// --- Image Preview and Upload State ---

const imagePreviewContainer = document.getElementById('image-preview-container')
const imagePreview = document.getElementById('image-preview')
const removeImageBtn = document.getElementById('remove-image-btn')
let selectedImageFile = null

// --- Upload Progress Bar ---
let uploadProgressBar = document.getElementById('upload-progress-bar')
if (!uploadProgressBar) {
  uploadProgressBar = document.createElement('progress')
  uploadProgressBar.id = 'upload-progress-bar'
  uploadProgressBar.max = 100
  uploadProgressBar.value = 0
  uploadProgressBar.style.display = 'none'
  uploadProgressBar.style.width = '100%'
  imagePreviewContainer.parentNode.insertBefore(
    uploadProgressBar,
    imagePreviewContainer.nextSibling
  )
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

/**
 * Uploads a file to Firebase Storage and returns the download URL.
 */
async function uploadImage (file) {
  const uniqueFileName = `${Date.now()}-${file.name}`
  const storageRef = ref(
    storage,
    `chatrooms/${roomId}/images/${uniqueFileName}`
  )

  // Show progress bar
  uploadProgressBar.value = 0
  uploadProgressBar.style.display = 'block'

  // Use XMLHttpRequest for progress (since uploadBytes doesn't support progress natively)
  // Convert file to Blob and upload via XHR
  const url = `https://firebasestorage.googleapis.com/v0/b/${
    storage.app.options.storageBucket
  }/o/chatrooms%2F${roomId}%2Fimages%2F${encodeURIComponent(uniqueFileName)}`
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(
      'POST',
      url +
        '?uploadType=media&name=chatrooms/' +
        roomId +
        '/images/' +
        uniqueFileName
    )
    xhr.setRequestHeader('Authorization', 'Bearer ')
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        uploadProgressBar.value = Math.round((e.loaded / e.total) * 100)
      }
    }
    xhr.onload = async function () {
      uploadProgressBar.style.display = 'none'
      if (xhr.status === 200) {
        // Now get the download URL from Firebase Storage
        try {
          const downloadURL = await getDownloadURL(storageRef)
          resolve(downloadURL)
        } catch (err) {
          reject(err)
        }
      } else {
        reject(new Error('Upload failed'))
      }
    }
    xhr.onerror = function () {
      uploadProgressBar.style.display = 'none'
      reject(new Error('Upload failed'))
    }
    xhr.send(file)
  })
}

/**
 * Sends a new message containing only an image URL.
 */
async function sendImageMessage (imageUrl) {
  try {
    const messagesRef = collection(db, 'chatrooms', roomId, 'messages')
    await addDoc(messagesRef, {
      senderId: currentUser.uid,
      imageUrl: imageUrl, // The message now contains an imageUrl
      text: '', // Text is empty for image messages
      timestamp: serverTimestamp()
    })
  } catch (error) {
    console.error('Error sending image message:', error)
  }
}
