var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var path = require('path');
var https = require('https');
var kurento = require('kurento-client');
var fs = require('fs');

var options = {
	key:  fs.readFileSync('keys/server.key'),
  	cert: fs.readFileSync('keys/server.crt')
}

var app = express();

app.use(cookieParser());


var sessionHandler = session({
    secret : 'none',
    rolling : true,
    resave : true,
    saveUninitialized : true
});

app.use(sessionHandler);

var sessions = [];
var candidateQueue = [];
var kurentoClient = null;

var server = https.Server(options,app).listen(8443,function () {
	console.log('app listen on port 8443');
})

var io = require('socket.io')(server);

io.of('/webrtc').on('connection',function (socket) {
	//console.log(socket.id);
	sessionId = null
	var request = socket.request;
	var response = {
		writeHead : {}
	};
	sessionHandler(request,response,function (err) {
		sessionId = request.session.id;
		console.log('has connection with sessionId : ',sessionId);
	});

	socket.on('message',function (_message) {
		var message = JSON.parse(_message);
		console.log('connection with '+sessionId+' has received a message : ',message);

		switch (message.id) {
			case 'start':
				//console.log(message.offerSdp);
				sessionId = request.session.id;
				start(sessionId,socket,message.sdpOffer,function (error,sdpAnswer) {
					if(error){
						return socket.emit('message',JSON.stringify({
							id : 'error',
							message : error
						}));
					}
					socket.emit('message',JSON.stringify({
						id : 'startResponse',
						sdpAnswer : sdpAnswer
					}));
				});
				break;
			case 'stop':
				stop(sessionId);
				break;
			case 'onIceCandidate':
				onIceCandidate(sessionId,message.candidate);
				break;
			default:
				socket.emit("message",JSON.stringify({
					id : 'error',
					message : 'Invalid message '+message
				}))
				break;
		}
	})
	
	socket.on('error',function () {
		console.log('error');
		stop(sessionId);
	})

	socket.on('disconnect',function () {
		console.log('disconnect with ',sessionId);
		stop(sessionId);
	});

});

function getKurentoClient (callback) {
	if(kurentoClient !== null){
		return callback(null,kurentoClient);
	}

	kurento("ws://localhost:8888/kurento",function (error,_kurentoClient) {
		if(error){
			return callback('could not find media from : '+ sessionId+ '. Exiting with error: '+error);
		}
		kurentoClient = _kurentoClient;
		callback(null,kurentoClient);
	})
}

function start (sessionId,socket,sdpOffer,callback) {
	if(!sessionId){
		return callback('Cannot use undefined session ID');
	}
	console.log(sessionId+" is geeting kurento Client");
	getKurentoClient(function (err,kurentoClient) {
		if(err){
			return callback(err);
		}
		//console.log('successful get kurentoClient');
		kurentoClient.create('MediaPipeline',function (error,pipeline) {
			if(error){
				return callback(error);
			}
			//console.log('pipeline : ',pipeline);
			createMediaElements(pipeline,socket,function (error,webRtcEndpoint) {
				if(error){
					return callback(error);
				}
				if(candidateQueue[sessionId]){
					while(candidateQueue[sessionId].length){
						var candidate = candidateQueue[sessionId].shift();
						webRtcEndpoint.addIceCandidate(candidate);
					}
				}

				connectMediaElements(webRtcEndpoint,function (error) {
					if(error){
						pipeline.release();
						return callback(error);
					}

					webRtcEndpoint.on('OnIceCandidate',function (event) {
						var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
						socket.emit('message',JSON.stringify({
							id : 'iceCandidate',
							candidate : candidate
						}));
					})

					webRtcEndpoint.processOffer(sdpOffer,function (error, sdpAnswer) {
						if(error){
							pipeline.release();
							return callback(error);
						}
						sessions[sessionId] = {
							'pipeline' : pipeline,
							'webRtcEndpoint' : webRtcEndpoint
						}
						return callback(null,sdpAnswer);
					})

					webRtcEndpoint.gatherCandidates(function (error) {
						if(error){
							return callback(error);
						}
					})
				})
			})
		})
	})
}

function createMediaElements(pipeline,socket,callback) {
	pipeline.create('WebRtcEndpoint',function (error,webRtcEndpoint) {
		if(error){
			return callback(error);
		}
		return callback(null,webRtcEndpoint);
	})
}

function connectMediaElements(webRtcEndpoint,callback) {
	webRtcEndpoint.connect(webRtcEndpoint,function (error) {
		if(error){
			return callback(error);
		}
		return callback(null);
	})
}

function onIceCandidate (sessionId,_candidate){
	var candidate = kurento.getComplexType('IceCandidate')(_candidate);

	if(sessions[sessionId]){
		var webRtcEndpoint = sessions[sessionId].webRtcEndpoint;
		webRtcEndpoint.addIceCandidate(candidate);
	}else{
		if(!candidateQueue[sessionId]){
			candidateQueue[sessionId] = [];
		}
		candidateQueue[sessionId].push(candidate);
	}
}


function stop(sessionId) {
    if (sessions[sessionId]) {
        var pipeline = sessions[sessionId].pipeline;
        console.info('Releasing pipeline');
        pipeline.release();

        delete sessions[sessionId];
        delete candidateQueue[sessionId];
    }
}

app.use(express.static(path.join(__dirname,"static")));