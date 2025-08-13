// Firebase config - replace with your own project details
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_ID",
  appId: "YOUR_APP_ID",
  databaseURL: "YOUR_DATABASE_URL"
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const dbSignaling = firebase.database().ref('videoCall');

// DOM refs
const presenceEl = document.getElementById('presence');
const chatBody = document.getElementById('chatBody');
const messageBox = document.getElementById('messageBox');
const sendBtn = document.getElementById('sendBtn');
const videoBtn = document.getElementById('videoBtn');
const videoModal = document.getElementById('videoModal');
const localPreview = document.getElementById('localPreview');
const remotePreview = document.getElementById('remotePreview');
const endVideo = document.getElementById('endVideo');
const tabChat = document.getElementById('tabChat');
const tabStatus = document.getElementById('tabStatus');
const panelChat = document.getElementById('panelChat');
const panelStatus = document.getElementById('panelStatus');
const statusText = document.getElementById('statusText');
const statusImageUrl = document.getElementById('statusImageUrl');
const postStatusBtn = document.getElementById('postStatusBtn');
const statusList = document.getElementById('statusList');
const statusModal = document.getElementById('statusModal');
const modalMedia = document.getElementById('modalMedia');
const modalCaption = document.getElementById('modalCaption');
const closeModal = document.getElementById('closeModal');

let currentUser = null;
const DAY_MS = 24*60*60*1000;
let localStream = null, remoteStream = null, pc = null;
const callId = "room1"; // fixed room for two-user call

// --- Auth
auth.signInAnonymously().catch(console.error);
auth.onAuthStateChanged(u => { currentUser = u; presenceEl.textContent = u?'Online':'Offline'; });

// --- Tabs
tabChat.addEventListener('click', ()=>{ tabChat.classList.add('active'); tabStatus.classList.remove('active'); panelChat.classList.remove('hidden'); panelStatus.classList.add('hidden'); });
tabStatus.addEventListener('click', ()=>{ tabStatus.classList.add('active'); tabChat.classList.remove('active'); panelStatus.classList.remove('hidden'); panelChat.classList.add('hidden'); });

// --- Chat
async function sendMessage(){
  if(!currentUser) return alert('Signing in...');
  const raw = messageBox.innerText.trim();
  if(!raw||raw==='Message') return;
  const now = firebase.firestore.Timestamp.now();
  await db.collection('messages').add({uid:currentUser.uid,text:raw,createdAt:now,expiresAt:firebase.firestore.Timestamp.fromMillis(now.toMillis()+DAY_MS)});
  messageBox.innerText='Message';
}
sendBtn.addEventListener('click',sendMessage);
messageBox.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});
db.collection('messages').orderBy('createdAt','asc').onSnapshot(snap=>{
  chatBody.innerHTML='';
  snap.forEach(doc=>{
    const data=doc.data();
    const wrap=document.createElement('div');
    wrap.className='msg'+(currentUser&&data.uid===currentUser.uid?' me':'');
    const textHtml = data.text?`<div class="body">${escapeHtml(data.text)}</div>`:'';
    const meta = `<div class="meta">${currentUser&&data.uid===currentUser.uid?'Me':'User'} • ${fmtTime(data.createdAt)}</div>`;
    wrap.innerHTML = textHtml + meta;
    chatBody.appendChild(wrap);
  });
  chatBody.scrollTop
