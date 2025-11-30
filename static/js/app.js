let token = localStorage.getItem('token');
let currentUser = null;
let ws = null;
let currentChat = null;
let currentTab = 'users';
let users = [];
let groups = [];

// Auth
function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}
function showLogin() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail);
        token = data.access_token;
        localStorage.setItem('token', token);
        init();
    } catch(e) {
        document.getElementById('login-error').textContent = e.message;
    }
}

async function register() {
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, email, password})
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail);
        token = data.access_token;
        localStorage.setItem('token', token);
        init();
    } catch(e) {
        document.getElementById('register-error').textContent = e.message;
    }
}

function logout() {
    localStorage.removeItem('token');
    location.reload();
}


// Init
async function init() {
    try {
        const res = await fetch('/api/me', {headers: {'Authorization': `Bearer ${token}`}});
        if (!res.ok) throw new Error();
        currentUser = await res.json();
        document.getElementById('auth-page').style.display = 'none';
        document.getElementById('app-page').style.display = 'flex';
        updateHeaderUser();
        connectWS();
        loadUsers();
        loadGroups();
    } catch(e) {
        localStorage.removeItem('token');
        document.getElementById('auth-page').style.display = 'flex';
    }
}

function updateHeaderUser() {
    const avatar = document.getElementById('header-avatar');
    const username = document.getElementById('header-username');
    if (currentUser.avatar) {
        avatar.innerHTML = `<img src="${currentUser.avatar}">`;
    } else {
        avatar.textContent = currentUser.username[0].toUpperCase();
    }
    username.textContent = currentUser.username;
}

function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws/${token}`);
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'message') handleNewMessage(data);
        else if (data.type === 'status') handleStatusChange(data);
        else if (data.type === 'typing') handleTyping(data);
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
}

async function loadUsers() {
    const res = await fetch('/api/users', {headers: {'Authorization': `Bearer ${token}`}});
    users = await res.json();
    if (currentTab === 'users') renderChatList();
}

async function loadGroups() {
    const res = await fetch('/api/groups', {headers: {'Authorization': `Bearer ${token}`}});
    groups = await res.json();
    if (currentTab === 'groups') renderChatList();
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    renderChatList();
}

function renderChatList() {
    const list = document.getElementById('chat-list');
    const search = document.getElementById('search-input').value.toLowerCase();
    let items = currentTab === 'users' ? users : groups;
    items = items.filter(i => (i.username || i.name).toLowerCase().includes(search));
    
    list.innerHTML = items.map(item => {
        const isUser = currentTab === 'users';
        const name = isUser ? item.username : item.name;
        const initial = name[0].toUpperCase();
        const isActive = currentChat && ((isUser && currentChat.type === 'user' && currentChat.id === item.id) || 
                         (!isUser && currentChat.type === 'group' && currentChat.id === item.id));
        const online = isUser && item.is_online ? '<span class="online-dot"></span>' : '';
        const membersCount = item.members ? item.members.length : 0;
        return `<div class="chat-item ${isActive ? 'active' : ''}" onclick="${isUser ? `openChat(${item.id})` : `openGroup(${item.id})`}">
            <div class="avatar">${initial}</div>
            <div class="info"><div class="name">${name}${online}</div><div class="last-msg">${isUser ? (item.is_online ? 'онлайн' : 'оффлайн') : `${membersCount} участников`}</div></div>
        </div>`;
    }).join('');
}

function filterChats() { renderChatList(); }


// Chat
async function openChat(userId) {
    const user = users.find(u => u.id === userId);
    currentChat = {type: 'user', id: userId, name: user.username};
    renderChatList();
    
    const res = await fetch(`/api/messages/${userId}`, {headers: {'Authorization': `Bearer ${token}`}});
    const messages = await res.json();
    renderChatArea(user, messages);
}

async function openGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    currentChat = {type: 'group', id: groupId, name: group.name};
    renderChatList();
    
    const res = await fetch(`/api/groups/${groupId}/messages`, {headers: {'Authorization': `Bearer ${token}`}});
    const messages = await res.json();
    renderChatArea(group, messages, true);
}

function renderChatArea(chat, messages, isGroup = false) {
    const name = isGroup ? chat.name : chat.username;
    const membersCount = chat.members ? chat.members.length : 0;
    const status = isGroup ? `${membersCount} участников` : (chat.is_online ? 'онлайн' : 'был(а) недавно');
    
    document.getElementById('chat-area').innerHTML = `
        <div class="chat-header">
            <div class="avatar">${name[0].toUpperCase()}</div>
            <div class="info"><div class="name">${name}</div><div class="status">${status}</div></div>
        </div>
        <div class="messages" id="messages">${messages.map(m => renderMessage(m)).join('')}</div>
        <div class="typing-indicator" id="typing"></div>
        <div class="input-area">
            <input type="file" id="file-input" onchange="uploadFile()">
            <button class="attach-btn" onclick="document.getElementById('file-input').click()">📎</button>
            <input type="text" id="msg-input" placeholder="Сообщение..." onkeypress="handleKeyPress(event)" oninput="sendTyping()">
            <button class="voice-btn" onclick="toggleVoiceRecording()">🎤</button>
            <button class="send-btn" onclick="sendMessage()">➤</button>
        </div>`;
    scrollToBottom();
}

function renderMessage(msg) {
    const isMine = msg.sender_id === currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'});
    let content = msg.content ? `<div class="text">${escapeHtml(msg.content)}</div>` : '';
    
    if (msg.file_url) {
        if (msg.file_type === 'image') {
            content += `<img src="${msg.file_url}" onclick="window.open('${msg.file_url}')">`;
        } else if (msg.file_type === 'voice') {
            content += `<div class="voice-message"><audio controls src="${msg.file_url}"></audio></div>`;
        } else {
            content += `<a href="${msg.file_url}" class="file-link" download>📄 Файл</a>`;
        }
    }
    
    const sender = currentChat.type === 'group' && !isMine ? `<div class="sender">${msg.sender.username}</div>` : '';
    return `<div class="message ${isMine ? 'sent' : 'received'}">${sender}${content}<div class="time">${time}</div></div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const msgs = document.getElementById('messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function handleKeyPress(e) {
    if (e.key === 'Enter') sendMessage();
}

let typingTimeout;
function sendTyping() {
    if (!ws || !currentChat) return;
    clearTimeout(typingTimeout);
    const data = {type: 'typing'};
    if (currentChat.type === 'user') data.receiver_id = currentChat.id;
    else data.group_id = currentChat.id;
    ws.send(JSON.stringify(data));
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !currentChat) return;
    
    const data = {type: 'message', content};
    if (currentChat.type === 'user') data.receiver_id = currentChat.id;
    else data.group_id = currentChat.id;
    
    ws.send(JSON.stringify(data));
    input.value = '';
}


async function uploadFile() {
    const input = document.getElementById('file-input');
    if (!input.files[0]) return;
    
    const formData = new FormData();
    formData.append('file', input.files[0]);
    
    const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${token}`},
        body: formData
    });
    const data = await res.json();
    
    const msg = {type: 'message', content: '', file_url: data.url, file_type: data.type};
    if (currentChat.type === 'user') msg.receiver_id = currentChat.id;
    else msg.group_id = currentChat.id;
    
    ws.send(JSON.stringify(msg));
    input.value = '';
}

function handleNewMessage(msg) {
    if (!currentChat) return;
    const isCurrentChat = (currentChat.type === 'user' && (msg.sender_id === currentChat.id || msg.receiver_id === currentChat.id)) ||
                          (currentChat.type === 'group' && msg.group_id === currentChat.id);
    if (isCurrentChat) {
        const msgs = document.getElementById('messages');
        msgs.innerHTML += renderMessage(msg);
        scrollToBottom();
    }
}

function handleStatusChange(data) {
    const user = users.find(u => u.id === data.user_id);
    if (user) {
        user.is_online = data.is_online;
        renderChatList();
    }
}

function handleTyping(data) {
    if (!currentChat) return;
    const typing = document.getElementById('typing');
    if (typing) {
        typing.textContent = `${data.username} печатает...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => typing.textContent = '', 2000);
    }
}

// Groups
function showCreateGroup() {
    document.getElementById('create-group-modal').classList.add('active');
}
function hideModal() {
    document.getElementById('create-group-modal').classList.remove('active');
}

async function createGroup() {
    const name = document.getElementById('group-name').value.trim();
    const description = document.getElementById('group-desc').value.trim();
    if (!name) return;
    
    await fetch('/api/groups', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
        body: JSON.stringify({name, description})
    });
    hideModal();
    loadGroups();
    document.getElementById('group-name').value = '';
    document.getElementById('group-desc').value = '';
}

// Settings
function showSettingsModal() {
    document.getElementById('settings-modal').classList.add('active');
    document.getElementById('settings-username').value = currentUser.username;
    document.getElementById('settings-email').value = currentUser.email;
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('settings-error').textContent = '';
    
    const preview = document.getElementById('avatar-preview');
    if (currentUser.avatar) {
        document.getElementById('avatar-initial').style.display = 'none';
        document.getElementById('avatar-img').src = currentUser.avatar;
        document.getElementById('avatar-img').style.display = 'block';
    } else {
        document.getElementById('avatar-initial').textContent = currentUser.username[0].toUpperCase();
        document.getElementById('avatar-initial').style.display = 'flex';
        document.getElementById('avatar-img').style.display = 'none';
    }
}

function hideSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
}

async function uploadAvatar() {
    const input = document.getElementById('avatar-input');
    if (!input.files[0]) return;
    
    const formData = new FormData();
    formData.append('file', input.files[0]);
    
    try {
        const res = await fetch('/api/profile/avatar', {
            method: 'POST',
            headers: {'Authorization': `Bearer ${token}`},
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail);
        
        currentUser.avatar = data.avatar;
        document.getElementById('avatar-initial').style.display = 'none';
        document.getElementById('avatar-img').src = data.avatar;
        document.getElementById('avatar-img').style.display = 'block';
        updateHeaderUser();
    } catch(e) {
        document.getElementById('settings-error').textContent = e.message;
    }
}

async function saveSettings() {
    const username = document.getElementById('settings-username').value.trim();
    const email = document.getElementById('settings-email').value.trim();
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    
    try {
        // Update profile
        if (username !== currentUser.username || email !== currentUser.email) {
            const formData = new FormData();
            formData.append('username', username);
            formData.append('email', email);
            
            const res = await fetch('/api/profile', {
                method: 'PUT',
                headers: {'Authorization': `Bearer ${token}`},
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail);
            
            currentUser.username = data.user.username;
            currentUser.email = data.user.email;
            updateHeaderUser();
        }
        
        // Change password
        if (oldPassword && newPassword) {
            const formData = new FormData();
            formData.append('old_password', oldPassword);
            formData.append('new_password', newPassword);
            
            const res = await fetch('/api/profile/password', {
                method: 'PUT',
                headers: {'Authorization': `Bearer ${token}`},
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail);
        }
        
        hideSettingsModal();
    } catch(e) {
        document.getElementById('settings-error').textContent = e.message;
    }
}

// Voice Messages
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function toggleVoiceRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await sendVoiceMessage(audioBlob);
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        document.querySelector('.voice-btn')?.classList.add('recording');
    } catch(e) {
        console.error('Microphone access denied:', e);
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        document.querySelector('.voice-btn')?.classList.remove('recording');
    }
}

async function sendVoiceMessage(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'voice.webm');
    
    const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${token}`},
        body: formData
    });
    const data = await res.json();
    
    const msg = {type: 'message', content: '', file_url: data.url, file_type: 'voice'};
    if (currentChat.type === 'user') msg.receiver_id = currentChat.id;
    else msg.group_id = currentChat.id;
    
    ws.send(JSON.stringify(msg));
}

// Start
if (token) init();
else document.getElementById('auth-page').style.display = 'flex';
