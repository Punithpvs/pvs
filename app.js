/* ===========================
   Replace firebaseConfig with your project values
   Get config from Firebase Console -> Project Settings
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

/* DOM refs */
const videoBtn = document.getElementById('videoBtn');
const videoOverlay = document.getElementById('videoOverlay');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const minimizeBtn = document.getElementById('minimizeBtn');
const muteBtn = document.getElementById('muteBtn');
const endBtn  = document.getElementById('endBtn');

const floatingCall = document.getElementById('floatingCall');
const miniRemote = document.getElementById('miniRemote');
const restoreBtn = document.getElementById('restoreBtn');
const endMiniBtn = document.getElementById('endMiniBtn');

const chatBody = document.getElementById('chatBody');
const messageBox = document.getElementById('messageBox');
const sendBtn = document.getElementById('sendBtn');

/* Simple helpers */
function escapeHtml(s=''){ return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* Anonymous auth to identify ephemeral users (optional) */
let currentUser = null;
auth.signInAnonymously().catch(console.error);
auth.onAuthStateChanged(u => { currentUser = u; });

/* Chat (stored in Firestore under 'rooms/ps-room/messages') */
const ROOM_ID = 'ps-room'; // shared room for two users
const messagesCol = db.collection('rooms').doc(ROOM_ID).collection('messages');

sendBtn.addEventListener('click', async () => {
  const text = (messageBox.value || '').trim();
  if(!text) return;
  await messagesCol.add({ uid: currentUser ? currentUser.uid : 'anon', text, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  messageBox.value = '';
});

messagesCol.orderBy('createdAt').onSnapshot(snap => {
  snap.forEach(change => {
    if(change.type === 'added'){
      const data = change.doc.data();
      const who = data.uid === (currentUser && currentUser.uid) ? 'Me' : 'Partner';
      chatBody.insertAdjacentHTML('beforeend', `<div class="msg"><b>${escapeHtml(who)}:</b> ${escapeHtml(data.text)}</div>`);
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  });
});

/* ===========================
   WebRTC + Firestore Signaling
   - auto caller/answerer
   - offer/answer + subcollections for candidates
   =========================== */
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let localStream = null;
let remoteStream = null;
let unsubscribers = []; // snapshot unsub functions
let isMuted = false;

/* UI control wiring */
videoBtn.addEventListener('click', startOrJoinCall);
minimizeBtn.addEventListener('click', minimizeCall);
muteBtn.addEventListener('click', toggleMute);
endBtn.addEventListener('click', endCall);

/* Floating controls (restore & end from mini) */
restoreBtn.addEventListener('click', () => {
  restoreCall();
});
endMiniBtn.addEventListener('click', async () => {
  await endCall();
});

/* Click local PiP to toggle size (optional swap later) */
localVideo.addEventListener('click', () => {
  // simple visual feedback: brief scale
  localVideo.style.transform = localVideo.style.transform ? '' : 'scale(1.03)';
  setTimeout(()=> localVideo.style.transform = '', 140);
});

/* Main: start or join */
async function startOrJoinCall(){
  // show overlay immediately
  videoOverlay.classList.remove('hidden');

  // create peer connection
  pc = new RTCPeerConnection(rtcConfig);

  // get local media
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  }catch(err){
    alert('Camera/Microphone access required: ' + err.message);
    closeOverlayUI();
    return;
  }
  localVideo.srcObject = localStream;

  // add tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // remote stream handling
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  pc.ontrack = ev => { ev.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); };

  // firestore signaling refs
  const roomDoc = db.collection('rooms').doc(ROOM_ID);
  const offerCandidatesCol = roomDoc.collection('offerCandidates');
  const answerCandidatesCol = roomDoc.collection('answerCandidates');

  // onicecandidate -> push to appropriate subcollection (depending on role)
  let iAmCaller = false;
  pc.onicecandidate = (event) => {
    if(!event.candidate) return;
    // if caller -> push to offerCandidates, else answerCandidates
    const subcol = iAmCaller ? offerCandidatesCol : answerCandidatesCol;
    subcol.add(event.candidate.toJSON()).catch(()=>{});
  };

  // decide role by checking if offer already exists
  const roomSnapshot = await roomDoc.get();
  const roomData = roomSnapshot.exists ? roomSnapshot.data() : null;
  iAmCaller = !roomData || !roomData.offer;

  if(iAmCaller){
    // make fresh room (clear old)
    await clearRoom(roomDoc, offerCandidatesCol, answerCandidatesCol);

    // create offer
    const offerDesc = await pc.createOffer();
    await pc.setLocalDescription(offerDesc);

    await roomDoc.set({ offer: { type: offerDesc.type, sdp: offerDesc.sdp }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });

    // listen for answer
    const unsubRoom = roomDoc.onSnapshot(async doc => {
      const data = doc.data();
      if(!data) return;
      if(data.answer && !pc.currentRemoteDescription){
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });
    unsubscribers.push(unsubRoom);

    // listen for remote ICE (answerer -> answerCandidates)
    const unsubAnswerCands = answerCandidatesCol.onSnapshot(s => {
      s.docChanges().forEach(ch => {
        if(ch.type === 'added'){
          const cand = new RTCIceCandidate(ch.doc.data());
          pc.addIceCandidate(cand).catch(()=>{});
        }
      });
    });
    unsubscribers.push(unsubAnswerCands);

  } else {
    // answerer: set remote offer -> create answer
    await pc.setRemoteDescription(new RTCSessionDescription(roomData.offer));
    const answerDesc = await pc.createAnswer();
    await pc.setLocalDescription(answerDesc);
    await roomDoc.update({ answer: { type: answerDesc.type, sdp: answerDesc.sdp }, answeredAt: firebase.firestore.FieldValue.serverTimestamp() });

    // listen for caller ICE (offerCandidates)
    const unsubOfferCands = offerCandidatesCol.onSnapshot(s => {
      s.docChanges().forEach(ch => {
        if(ch.type === 'added'){
          const cand = new RTCIceCandidate(ch.doc.data());
          pc.addIceCandidate(cand).catch(()=>{});
        }
      });
    });
    unsubscribers.push(unsubOfferCands);

    // also listen for future answer updates? not necessary for answerer
  }

  // in either role, listen for the other side's candidates if not yet set up:
  // caller already listens to answerCandidates above; answerer listens to offerCandidates above.

  // optional: detect remote stream ended etc. handled by endCall

  // done: now we have video overlay visible and streams set
}

/* Minimize the overlay to floating small window */
function minimizeCall(){
  // hide overlay, show floating with remote stream snapshot / stream
  videoOverlay.classList.add('hidden');
  floatingCall.classList.remove('hidden');

  // set mini remote to current remote stream (muted for autoplay safety)
  if(remoteStream) miniRemote.srcObject = remoteStream;
}

/* Restore from minimized */
function restoreCall(){
  floatingCall.classList.add('hidden');
  videoOverlay.classList.remove('hidden');
}

/* Toggle mute/unmute */
function toggleMute(){
  if(!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.textContent = isMuted ? '🎤' : '🔇';
}

/* End call and cleanup */
async function endCall(){
  // remove listeners
  unsubscribers.forEach(u => { try{ u(); }catch{} });
  unsubscribers = [];

  // close pc & stop tracks
  try{ if(pc){ pc.ontrack = null; pc.close(); } }catch(e){}
  if(localStream){ localStream.getTracks().forEach(t => t.stop()); }
  if(remoteStream){ remoteStream.getTracks().forEach(t => t.stop()); }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  miniRemote.srcObject = null;

  // hide UI
  videoOverlay.classList.add('hidden');
  floatingCall.classList.add('hidden');

  // mark room ended and clear candidate subcollections
  const roomDoc = db.collection('rooms').doc(ROOM_ID);
  const offerCandidatesCol = roomDoc.collection('offerCandidates');
  const answerCandidatesCol = roomDoc.collection('answerCandidates');
  try{
    await roomDoc.set({ ended: true }, { merge: true });
    await deleteCollection(offerCandidatesCol);
    await deleteCollection(answerCandidatesCol);
  }catch(e){ /* ignore */ }

  pc = null;
  localStream = null;
  remoteStream = null;
  isMuted = false;
}

/* Helpers to clear previous data */
async function clearRoom(roomDoc, offerCol, answerCol){
  await roomDoc.delete().catch(()=>{});
  await deleteCollection(offerCol);
  await deleteCollection(answerCol);
}
async function deleteCollection(colRef){
  const snap = await colRef.get();
  if(snap.empty) return;
  const batch = db.batch();
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

/* Click floating to restore as well (optional) */
floatingCall.addEventListener('click', restoreCall);

/* When the page unloads, try to end call gracefully */
window.addEventListener('beforeunload', () => {
  try{ endCall(); }catch(e){}
});
