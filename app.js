// --- Firebase Config (replace with your values from Firebase console) ---
const firebaseConfig = {
  apiKey: "AIzaSyBsEfun4555Y1TaBqxFEBz-7vmjKYcDCqg",
  authDomain: "ps-chat-5699a.firebaseapp.com",
  projectId: "ps-chat-5699a",
  storageBucket: "ps-chat-5699a.firebasestorage.app",
  messagingSenderId: "1087992118523",
  appId: "1:1087992118523:web:5ca154a66ca6a917fb845e"
};
firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();

// --- WebRTC Setup ---
let pc = null;
let localStream = null;
let remoteStream = null;

const videoBtn = document.getElementById("videoBtn");
const videoModal = document.getElementById("videoModal");
const closeVideo = document.getElementById("closeVideo");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

videoBtn.addEventListener("click", startCall);
closeVideo.addEventListener("click", () => {
  videoModal.classList.add("hidden");
  if (pc) pc.close();
});

async function startCall() {
  videoModal.classList.remove("hidden");

  // Create RTCPeerConnection
  pc = new RTCPeerConnection();
  remoteStream = new MediaStream();

  // Get local camera + mic
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  localVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  pc.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };

  // Firebase signaling
  const callDoc = firestore.collection("calls").doc("room1");
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  pc.onicecandidate = event => {
    if (event.candidate) {
      offerCandidates.add(event.candidate.toJSON());
    }
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };
  await callDoc.set({ offer });

  // Listen for answer
  callDoc.onSnapshot(snapshot => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // Listen for ICE candidates
  answerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
}
