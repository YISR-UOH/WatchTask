const peerConnections = {};

export const createPeerConnection = (peerId, signalingServer) => {
    const peerConnection = new RTCPeerConnection();

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            signalingServer.send({
                type: 'ice-candidate',
                candidate: event.candidate,
                peerId: peerId,
            });
        }
    };

    peerConnection.ondatachannel = (event) => {
        const dataChannel = event.channel;
        dataChannel.onmessage = (messageEvent) => {
            console.log('Message received:', messageEvent.data);
        };
    };

    return peerConnection;
};

export const initiateConnection = async (peerConnection, signalingServer) => {
    const dataChannel = peerConnection.createDataChannel('chat');

    dataChannel.onopen = () => {
        console.log('Data channel is open');
    };

    dataChannel.onclose = () => {
        console.log('Data channel is closed');
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    signalingServer.send({
        type: 'offer',
        offer: offer,
    });
};

export const handleSignalingData = async (data, peerConnection) => {
    switch (data.type) {
        case 'offer':
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            break;
        case 'answer':
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
        case 'ice-candidate':
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            break;
        default:
            break;
    }
};