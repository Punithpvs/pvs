/* ===========================
   Firebase INIT (replace!)
=========================== */
const firebaseConfig = {
   apiKey: "AIzaSyBsEfun4555Y1TaBqxFEBz-7vmjKYcDCqg",
  authDomain: "ps-chat-5699a.firebaseapp.com",
  projectId: "ps-chat-5699a",
  storageBucket: "ps-chat-5699a.firebasestorage.app",
  messagingSenderId: "1087992118523",
  appId: "1:1087992118523:web:5ca154a66ca6a917fb845e"
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* ===========================
   DOM refs
=========================== */
const presenceEl = document.getElementById('presence');
const chatBody   = document.getElementById('chatBody');
const messageBox = document.getElementById('messageBox');
const sendBtn    = document.getElementById('sendBtn');

const tabChat    = document.getElementById('tabChat');
const tabStatus  = document.getElementById('tabStatus');
const panelChat  = document.getElementById('panelChat');
const panelStatus= document.getElementById('panelStatus');

const statusText = document.getElementById('statusText');
const statusImageUrl = document.getElementById('statusImageUrl');
const postStatusBtn  = document.getElementById('postStatusBtn');
const statusList = document.getElementById('statusList');

const statusModal = document.getElementById('statusModal');
const modalMedia  = document.getElementById('modalMedia');
const modalCaption= document.getElementById('modalCaption');
const closeModal  = document.getElementById('closeModal');

const videoBtn    = document.getElementById('videoBtn');
const videoModal  = document.getElementById('videoModal');
const endVideo    = document.getElementById('endVideo');
const localVideo  = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

/* ===========================
   Auth & presence
=========================== */
let currentUser = null;
auth.signInAnonymously().catch(console.error);
auth.onAuthStateChanged(u => {
  currentUser = u;
  presenceEl.textContent = u ? 'Online' : 'Offline';
});

/* ===========================
   Tabs
=========================== */
tabChat.addEventListener('click', ()=>{
  tabChat.classList.add('active'); tabStatus.classList.remove('active');
  panelChat.classList.remove('hidden'); panelStatus.classList.add('hidden');
});
tabStatus.addEventListener('click', ()=>{
  tabStatus.classList.add('active'); tabChat.classList.remove('active');
  panelStatus.classList.remove('hidden'); panelChat.classList.add('hidden');
});

/* ===========================
   Chat (Firestore, 24h ephemerals)
=========================== */
const DAY_MS = 24*60*60*1000;

function escapeHtml(s=''){ return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtTime(ts){ if(!ts) return ''; return ts.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

async function sendMessage(){
  if(!currentUser) return alert('Signing in...');
  const text = messageBox.innerText.trim();
  if(!text || text==='Message') return;
  const now = firebase.firestore.Timestamp.now();
  await db.collection('messages').add({
    uid: currentUser.uid,
    text, createdAt: now,
    expiresAt: firebase.firestore.Timestamp.fromMillis(now.toMillis()+DAY_MS)
  });
  messageBox.innerText='Message';
}
sendBtn.addEventListener('click', sendMessage);
messageBox.addEventListener('keydown', e=>{
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }
});

db.collection('messages').orderBy('createdAt','asc').onSnapshot(async snap=>{
  chatBody.innerHTML='';
  const cutoff = Date.now()-DAY_MS;
  const dels=[];
  snap.forEach(doc=>{
    const m = doc.data();
    const t = m.createdAt ? m.createdAt.toDate().getTime() : 0;
    if(t && t<cutoff){ dels.push(doc.ref.delete().catch(()=>{})); return; }
    const wrap=document.createElement('div');
    wrap.className='msg'+(currentUser && m.uid===currentUser.uid ? ' me':'');
    wrap.innerHTML = (m.text?`<div class="body">${escapeHtml(m.text)}</div>`:'')
      + `<div class="meta">${currentUser && m.uid===currentUser.uid?'Me':'User'} • ${fmtTime(m.createdAt)}</div>`;
    chatBody.appendChild(wrap);
  });
  if(dels.length) Promise.allSettled(dels);
  chatBody.scrollTop=chatBody.scrollHeight;
});

/* ===========================
   Status (24h)
=========================== */
postStatusBtn.addEventListener('click', async ()=>{
  if(!currentUser) return alert('Signing in...');
  const text = statusText.value.trim();
  const img  = (statusImageUrl.value||'').trim() || null;
  if(!text && !img) return alert('Write something or add image URL');
  const now = firebase.firestore.Timestamp.now();
  await db.collection('statuses').add({
    uid: currentUser.uid, text: text||null, imageUrl: img||null,
    createdAt: now,
    expiresAt: firebase.firestore.Timestamp.fromMillis(now.toMillis()+DAY_MS)
  });
  statusText.value=''; statusImageUrl.value='';
});
db.collection('statuses').orderBy('createdAt','desc').onSnapshot(snap=>{
  statusList.innerHTML='';
  const cutoff=Date.now()-DAY_MS;
  const dels=[];
  snap.forEach(doc=>{
    const s=doc.data();
    const t=s.createdAt ? s.createdAt.toDate().getTime() : 0;
    if(t && t<cutoff){ dels.push(doc.ref.delete().catch(()=>{})); return; }
    const card=document.createElement('div');
    card.className='status-card';
    const imgHtml = s.imageUrl?`<img src="${escapeHtml(s.imageUrl)}" alt="">`:'';
    const textHtml = s.text?`<div class="text">${escapeHtml(s.text)}</div>`:'<div class="text" style="color:#777">No text</div>';
    card.innerHTML=(imgHtml||'')+textHtml;
    card.addEventListener('click', ()=>{
      modalMedia.innerHTML = s.imageUrl?`<img src="${escapeHtml(s.imageUrl)}" style="max-width:100%;">`:'';
      modalCaption.textContent = s.text || '';
      statusModal.classList.remove('hidden');
    });
    statusList.appendChild(card);
  });
  if(dels.length) Promise.allSettled(dels);
});
closeModal.addEventListener('click', ()=> statusModal.classList.add('hidden'));

/* ===========================
   WebRTC + Firestore signaling
   - Click videoBtn to start/join
   - Shared ROOM_ID for 2 users
=========================== */
const ROOM_ID = 'ps-room'; // shared fixed room for your 2 users
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let localStream = null;
let remoteStream = null;
let stopSnapshots = null; // unsubscribe function to clean listeners

videoBtn.addEventListener('click', startOrJoinCall);
endVideo.addEventListener('click', endCall);

async function startOrJoinCall(){
  if(!currentUser) return alert('Signing in...');
  // Open modal
  videoModal.classList.remove('hidden');

  // Create RTCPeerConnection
  pc = new RTCPeerConnection(rtcConfig);

  // Prepare media
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  }catch(e){
    alert('Camera/Microphone permission is required.\n' + e.message);
    return;
  }
  localVideo.srcObject = localStream;

  // Add local tracks
  localStream.getTracks().forEach(t=> pc.addTrack(t, localStream));

  // Remote stream container
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  pc.ontrack = (ev)=> ev.streams[0].getTracks().forEach(track=> remoteStream.addTrack(track));

  // Firestore refs
  const callDoc = db.collection('calls').doc(ROOM_ID);
  const offerCandidates  = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  // Push ICE candidates to the right subcollection
  pc.onicecandidate = (ev)=>{
    if(!ev.candidate) return;
    if(_iAmCaller){
      offerCandidates.add(ev.candidate.toJSON());
    }else{
      answerCandidates.add(ev.candidate.toJSON());
    }
  };

  // Decide caller or answerer
  const snap = await callDoc.get();
  let data = snap.exists ? snap.data() : null;

  // If old session is finished (has answer & old candidates), recycle
  if(data && data.ended){
    await clearRoom(callDoc, offerCandidates, answerCandidates);
    data = null;
  }

  // Caller if no offer exists; else answerer
  let _iAmCaller = !data || !data.offer;

  // Live listeners (store unsubscribers to stop later)
  const unsubs = [];

  if(_iAmCaller){
    // Create fresh offer and reset subcollections
    await clearRoom(callDoc, offerCandidates, answerCandidates);

    const offerDesc = await pc.createOffer();
    await pc.setLocalDescription(offerDesc);

    await callDoc.set({ offer: { type: offerDesc.type, sdp: offerDesc.sdp }, createdAt: Date.now() });

    // Listen for answer
    unsubs.push(callDoc.onSnapshot(async (doc)=>{
      const d = doc.data();
      if(d && d.answer && !pc.currentRemoteDescription){
        await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
      }
    }));

    // Listen for remote ICE from answerer
    unsubs.push(answerCandidates.onSnapshot(s=>{
      s.docChanges().forEach(ch=>{
        if(ch.type==='added'){
          pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(()=>{});
        }
      });
    }));
  }else{
    // I'm answerer: read offer, set remote, create answer
    const d = data;
    await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    const answerDesc = await pc.createAnswer();
    await pc.setLocalDescription(answerDesc);
    await callDoc.update({ answer: { type: answerDesc.type, sdp: answerDesc.sdp }, answeredAt: Date.now() });

    // Listen for caller ICE
    unsubs.push(offerCandidates.onSnapshot(s=>{
      s.docChanges().forEach(ch=>{
        if(ch.type==='added'){
          pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(()=>{});
        }
      });
    }));
  }

  // Keep a handle to unsubscribe later
  stopSnapshots = ()=> unsubs.forEach(u=>u && u());
}

async function endCall(){
  // Close PC and media
  try{ if(pc) pc.ontrack = null; }catch{}
  try{ if(pc) pc.close(); }catch{}
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); }
  if(remoteStream){ remoteStream.getTracks().forEach(t=>t.stop()); }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  // Stop listeners
  if(typeof stopSnapshots === 'function'){ stopSnapshots(); stopSnapshots=null; }

  // Mark room ended and wipe candidates (keeps doc so next caller can reuse)
  const callDoc = db.collection('calls').doc(ROOM_ID);
  const offerCandidates  = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');
  try{
    await callDoc.set({ ended: true }, { merge: true });
    await deleteCollection(offerCandidates);
    await deleteCollection(answerCandidates);
  }catch{}

  // Reset
  pc=null; localStream=null; remoteStream=null;
  videoModal.classList.add('hidden');
}

// Helpers to clear room before fresh call
async function clearRoom(callDoc, offerCandidates, answerCandidates){
  await callDoc.delete().catch(()=>{});
  await deleteCollection(offerCandidates);
  await deleteCollection(answerCandidates);
}
async function deleteCollection(colRef){
  const snap = await colRef.get();
  const batch = db.batch();
  snap.forEach(d=> batch.delete(d.ref));
  if(!snap.empty) await batch.commit();
}
