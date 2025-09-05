import React, { useEffect, useRef, useState } from 'react';
import { initializePeerConnection, sendData, receiveData } from '../utils/p2p';

const PeerConnection = () => {
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');
    const [message, setMessage] = useState('');
    const peerConnectionRef = useRef(null);

    useEffect(() => {
        peerConnectionRef.current = initializePeerConnection(handleConnectionStateChange);
        
        return () => {
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
            }
        };
    }, []);

    const handleConnectionStateChange = (state) => {
        setConnectionStatus(state);
    };

    const handleSendMessage = () => {
        if (peerConnectionRef.current) {
            sendData(peerConnectionRef.current, message);
            setMessage('');
        }
    };

    const handleReceiveMessage = (data) => {
        console.log('Received message:', data);
    };

    return (
        <div>
            <h2>Peer Connection Status: {connectionStatus}</h2>
            <input 
                type="text" 
                value={message} 
                onChange={(e) => setMessage(e.target.value)} 
                placeholder="Type a message" 
            />
            <button onClick={handleSendMessage}>Send Message</button>
        </div>
    );
};

export default PeerConnection;