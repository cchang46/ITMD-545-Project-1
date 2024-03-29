'use strict';

const INIT_MESSAGE = '====INIT_MESSAGE====';

const $self = {
  rtcConfig: null,
  constraints: { audio: true, video: true },
  isPolite: false,
  isMakingOffer: false,
  isIgnoringOffer: false,
  isSettingRemoteAnswerPending: false
};

const $peer = {
  connection: null
};

async function requestUserMedia(constraints) {
  const video = document.querySelector('#self-video');
  $self.stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.querySelector('#live-chat').style.display = 'flex';
  // Safari doesn't show video properly if update too quick sometimes, so wait for 1 second
  setTimeout(() => {
    video.srcObject = $self.stream;
  }, 1000);
  return $self.stream;
}

function stopUserMedia() {
  if ($self.stream) {
    $self.stream.getTracks().forEach((track) => {
      track.stop();
    });
    const selfVideo = document.querySelector('#self-video');
    selfVideo.srcObject = null;
    const peerVideo = document.querySelector('#peer-video');
    peerVideo.srcObject = null;
    peerVideo.style.display = 'none';
    document.querySelector('#live-chat').style.display = 'none';
  }
}

/**
* Socket Server Events and Callbacks
*/
const rootSc = io('/', { autoConnect: false});
rootSc.on('pets', handlePets);
rootSc.open();

let sc;

function handlePets(pets) {
  console.log(pets);
  // binding listeners for all pets
  Object.keys(pets).forEach((name) => {
    const button = document.querySelector(`#call-${name}`);
    button.addEventListener('click', (e) => {
      const button = e.target;
      if (button.className === 'join') {
        const ns = pets[name];
        window.location.hash = ns;
        sc = io(`/${ns}`, { autoConnect: false});
        registerChannelEvents();
        button.className = 'leave';
        button.innerText = 'Leave Chat';
        requestUserMedia($self.constraints).then(() => joinChat());
      } else {
        leaveChat();
      }
    });
  });
}

/* Chat Room */
const chatRoom = document.querySelector('#chat-room');
chatRoom.addEventListener('submit', handleChatRoom);

const messenger =  document.querySelector('#messenger');
messenger.addEventListener('click', showChatRoom);

const audioBtn = document.querySelector('#audio');
audioBtn.addEventListener('click', toggleAudio);

function toggleAudio(e) {
  const audio = $self.stream.getAudioTracks()[0];
  if (audio.enabled) {
    audio.enabled = false;
    e.target.innerText = 'Unmute';
  } else {
    audio.enabled = true;
    e.target.innerText = 'Mute';
  }
}

function handleMessenger() {
  if(!$self.chatChannelPromise) {
    if ($peer.chatChannel) {
      // chat channel is already established
      $self.chatChannelPromise = Promise.resolve();
    } else  {
      $self.chatChannelPromise = new Promise((resolve, reject) => {
        $self.resolveChatChannel = resolve;
        $peer.chatChannel = $peer.connection.createDataChannel('chat');
        $peer.chatChannel.onmessage = handleMessage;
      });
    }
  }

  return $self.chatChannelPromise;
}

function showChatRoom () {
  document.querySelector('#chat-room').style.display = 'block';
}

function handleMessage ({data}) {
  if ($self.resolveChatChannel && data === INIT_MESSAGE) {
    console.log('chat channel initiated');
    $self.resolveChatChannel();
    $self.resolveChatChannel = null;
  } else {
    console.log('received message ', data);
    appendMessage(data, 'receiver');
  }
}

function handleChatRoom(e) {
  e.preventDefault();
  const form = e.target;
  const input = form.querySelector('#message');
  const message = input.value;
  input.value = '';

  // Make sure chat channel is open before sending message
  handleMessenger().then(() => {
    $peer.chatChannel.send(message);
    console.log('Sender msg:', message);
    appendMessage(message, 'sender');
  })
}

function appendMessage(message, msgClass) {
  const messages = document.querySelector('#messages');
  const li = document.createElement('li');
  li.className = msgClass;
  li.innerText = message;
  messages.appendChild(li);
}

function joinChat() {
  window.scrollTo(0, 0);
  $peer.connection = new RTCPeerConnection($self.rtcConfig);
  sc.open();
  registerRtcEvents($peer);
  establishCallFeatures($peer);
}

function leaveChat() {
  const button = document.querySelector('.leave');
  button.className = 'join';
  button.innerText = 'Join Chat';
  stopUserMedia();

  if (sc) {
    sc.disconnect();
    sc = null;
  }

  if ($peer.connection) {
    $peer.connection.close();
    $peer.connection = null;
  }

  $self.chatChannelPromise = null;
  $peer.chatChannel = null;
}

/* WebRTC Events */
function establishCallFeatures(peer) {
  for (let track of $self.stream.getTracks()) {
    console.log(track);
    peer.connection.addTrack(track, $self.stream);
  }
}

function registerRtcEvents(peer) {
  peer.connection
    .onnegotiationneeded = handleRtcNegotiation;
  peer.connection
    .onicecandidate = handleIceCandidate;
  peer.connection
    .ontrack = handleRtcTrack;
  peer.connection
    .ondatachannel = handleRtcDataChannel;
}

async function handleRtcNegotiation() {
  console.log('RTC negotiation needed...');
  if ($self.skipOffer) {
    console.log('Skip offer');
    return;
  }
  // send an SDP description
  $self.isMakingOffer = true;
  try {
    await $peer.connection.setLocalDescription();
  } catch (e) {
    const offer = await $peer.connection.createOffer();
    await $peer.connection.setLocalDescription(offer);
  }finally {
    // finally, however this was done, send the localDescription to the remote peer
    console.log('Send description...');
    sc.emit('signal', { description:
      $peer.connection.localDescription });
  }
  $self.isMakingOffer = false;
}
function handleIceCandidate({ candidate }) {
  // send ICE candidate
  console.log('Send ICE candidate...');
  sc.emit('signal', { candidate:
    candidate });
}
function handleRtcTrack({ streams: [stream] }) {
  console.log('RTC track...');
  // attach incoming track to the DOM
  displayPeer(stream);
}

function handleRtcDataChannel(dataChannelEvent){
   console.log('Heard data channel', dataChannelEvent.channel.label);
   dataChannelEvent.channel.onmessage = handleMessage;
   $peer.chatChannel = dataChannelEvent.channel;
   showChatRoom();

   try {
     $peer.chatChannel.send(INIT_MESSAGE);
   } catch (e) {
     // For Safari, it's too quick to fire, so wait til next event loop
     console.error(e);
     setTimeout(() => {
       $peer.chatChannel.send(INIT_MESSAGE);
     }, 0);
   }
}


/* Video DOM */
function displayPeer(stream) {
  const video = document.querySelector("#peer-video");
  video.style.display = 'block';
  video.srcObject = stream;
}

/* Signaling Channel Events */

function registerChannelEvents() {
  sc.on('connect', handleChannelConnect);
  sc.on('connected peer', handleChannelConnectedPeer);
  sc.on('signal', handleChannelSignal);
  sc.on('disconnected peer', handleChannelDisconnectedPeer);
}

function handleChannelConnect() {
  console.log('Connected to signaling channel!');
}
function handleChannelConnectedPeer() {
  console.log('Heard connected peer event!');
  $self.isPolite = true;
}
function handleChannelDisconnectedPeer() {
  console.log('Heard disconnected peer event!');
  leaveChat();
}
async function handleChannelSignal({ description, candidate, resend }) {
  console.log('Heard signal event!');
  if (description) {
    console.log('Received SDP Signal:', description);
    console.log('isMakingOffer: ', $self.isMakingOffer);
    console.log('signalingState: ', $peer.connection.signalingState);
    console.log('isSettingRemoteAnswerPending: ', $self.isSettingRemoteAnswerPending);
    const readyForOffer =
        !$self.isMakingOffer &&
        ($peer.connection.signalingState === 'stable'
          || $self.isSettingRemoteAnswerPending);

    console.log('readyForOffer: ', readyForOffer);
    const offerCollision = description.type === 'offer' && !readyForOffer;

    console.log('offerCollision: ', offerCollision);
    //inPolite && have offerCollision
    //offerCollision will be true if type is offer && not readyForOffer
    //but I'm inPolite I'm aways providing offer for the first connection
    //so offerCollision only occurs if it's not the first connection and the remote end initiate the offerCollision
    //and I'm not currently making an offer, and the connection is not stable or I'm about to accepting the answer from the remote end.
    $self.isIgnoringOffer = !$self.isPolite && offerCollision;
    console.log('isIgnoringOffer: ', $self.isIgnoringOffer);

    if ($self.isIgnoringOffer) {
      return;
    }

    console.log('description type: ', description.type);
    $self.isSettingRemoteAnswerPending = description.type === 'answer';
    try {
      await $peer.connection.setRemoteDescription(description);
    } catch(e) {
      console.error('Cannot set remote description', e);
      if (!$self.isSettingRemoteAnswerPending && $peer.connection.signalingState === 'have-local-offer') {
        // the browser (Safari) can't handle state conflict, so reset myself and tell remote end to send again
        resetConnection();
      }
      return;
    }
    $self.isSettingRemoteAnswerPending = false;

    if (description.type === 'offer') {
      try {
        await $peer.connection.setLocalDescription();
      } catch(e) {
        const answer = await $peer.connection.createAnswer();
        await $peer.connection.setLocalDescription(answer);
      } finally {
        console.log('Send answer');
        console.log($peer.connection.localDescription);
        sc.emit('signal',
          { description:
            $peer.connection.localDescription });
        $self.skipOffer = false;
      }
    }

  } else if (candidate) {
    console.log('Received ICE candidate:', candidate);
    try {
      await $peer.connection.addIceCandidate(candidate);
    } catch(e) {
      if (!$self.isIgnoringOffer) {
        console.error('Cannot add ICE candidate for peer', e);
      }
    }
  } else if (resend) {
    console.log('Received resend signal')
    handleRtcNegotiation();
  }
}

function resetConnection() {
  $self.isMakingOffer = false;
  $self.isIgnoringOffer = false;
  $self.isSettingRemoteAnswerPending = false;
  $peer.connection.close();
  $peer.connection = new RTCPeerConnection($self.rtcConfig);
  registerRtcEvents($peer);
  $self.skipOffer = true;
  establishCallFeatures($peer);
  sc.emit('signal', { resend: true });
}
