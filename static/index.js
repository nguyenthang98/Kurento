var socket = io.connect("https://localhost:8433/webrtc");

var videoInput;
var videoOutput;
const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;
var state = null;
var webRtcPeer;

window.onload = function() {
	console.log('Page loaded ...');
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');
	setState(I_CAN_START);
}

socket.on('message',function (message) {
	var parsedMessage = JSON.parse(message);
	switch (parsedMessage.id) {
		case 'error':
			console.log("Something went wrong: ",parsedMessage.message);
			break;
		case 'startResponse':
			//console.log("Sdp Answer: "+parsedMessage.sdpAnswer);
			startResponse(parsedMessage);
			break;
		case 'iceCandidate':
			//console.log(parsedMessage.candidate);
			webRtcPeer.addIceCandidate(parsedMessage.iceCandidate);
			break;
		default:
			// statements_def
			break;
	}
})

window.onbeforeunload = function() {
	socket.close();
}

function startResponse(message) {
	setState(I_CAN_STOP);
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function start() {
	//console.log("starting video call...");
	setState(I_AM_STARTING);

	var options = {
		localVideo : videoInput,
		remoteVideo : videoOutput,
		onicecandidate : onIceCandidate
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options,function (err) {
		if(err) return onError(err);
		this.generateOffer(onOffer);
	})
}

function onOffer(error,offerSdp) {
	if(error) return onError(error);

	console.info('Invoking SDP offer callback function ' + location.host);
	var message = {
		id : 'start',
		sdpOffer : offerSdp
	}
	sendMessage(message);
}

function onIceCandidate (candidate) {
	//console.log('Local candidate' + JSON.stringify(candidate));

	var message = {
		id : 'onIceCandidate',
		candidate : candidate
	};
	sendMessage(message);
}

function onError (error) {
	console.log(error);
}

function stop () {
	console.log('stop');
	setState(I_CAN_START);
	sendMessage({
		id : 'stop'
	})
}

function setState(nextState) {
	switch (nextState) {
	case I_CAN_START:
		$('#start').attr('disabled', false);
		$('#start').attr('onclick', 'start()');
		$('#stop').attr('disabled', true);
		$('#stop').removeAttr('onclick');
		break;

	case I_CAN_STOP:
		$('#start').attr('disabled', true);
		$('#stop').attr('disabled', false);
		$('#stop').attr('onclick', 'stop()');
		break;

	case I_AM_STARTING:
		$('#start').attr('disabled', true);
		$('#start').removeAttr('onclick');
		$('#stop').attr('disabled', true);
		$('#stop').removeAttr('onclick');
		break;

	default:
		onError('Unknown state ' + nextState);
		return;
	}
	state = nextState;
}

function sendMessage (_message) {
	var jsonMessage = JSON.stringify(_message);
	//console.log('sending message: ',jsonMessage);
	socket.emit('message',jsonMessage);
}
