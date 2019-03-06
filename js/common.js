var APPNAME = "SendNotification Login";
var sessionId = null;
var csrfToken = null;
var userId = "";
var password = "";
// var server = "http://192.168.222.171:8018/icws/";
// var server = "http://avphv:8018/icws/";
var server = "";
var server_url = "nothing";
//
// Credential storage
//

// Stores values for the currently connected ICWS session.
//   server The ICWS server with which the ICWS session was established.
//   userId The IC user ID that was used to login.
//   csrfToken The ICWS session's CSRF token.
//   sessionId The ICWS session's session ID.  This value must be passed in with every request.
var icwsCurrentSession = null;

// Stores the current version of messaging supported by the connected ICWS session.
// This value is used in helping to determine if short-polling or server sent events should be used for message processing.
var icwsCurrentMessagingVersion = null;

// This holds the value of the messaging version that supports server sent events.
var icwsMessagingVersionForServerSentEvents = 2;

// This holds the list of last attempted alternative switching servers.
var icwsLastAttemptedSwitchServers = [];

// This holds the list of available alternative switching servers.
var icwsAvailableSwitchServers = [];

// Stores the effective station ID for the user
var icwsEffectiveStationId = null;


//sendRequest is a wrapper around the XMLHttpRequest to make ajax calls a little easier.		
function sendRequest(verb, url, data, callback, errorCallback) {
	var xmlhttp = new XMLHttpRequest();

	if (callback) {
		xmlhttp.onreadystatechange = function () {
			if (xmlhttp.readyState == 4 && (xmlhttp.status >= 200 && xmlhttp.status < 300)) {
				if (xmlhttp.responseText.length > 0) {
					console.warn('GOOD');
					callback(JSON.parse(xmlhttp.responseText));
				} else callback();
			}
			else if (xmlhttp.readyState == 4 && (xmlhttp.status >= 300)) {
				console.warn('ERROR' , xmlhttp.status);
				console.log(xmlhttp.status, xmlhttp.statusText, xmlhttp.responseText);
				$('#icwsInfo').prepend('<br>' + xmlhttp.status  + ' ' + xmlhttp.statusText + '<br>');
				$('#icwsInfo').prepend('<br>' + xmlhttp.responseText);
				errorCallback();
			}
		};
	}
	console.log(url);
	xmlhttp.open(verb, server + url, true);
	// xmlhttp.open(verb, server_url + url, true);
	xmlhttp.setRequestHeader("Accept-Language", "en-us");
	xmlhttp.withCredentials = true;

	if (csrfToken) {
		xmlhttp.setRequestHeader("ININ-ICWS-CSRF-Token", csrfToken);
	}

	if (errorCallback) {
		xmlhttp.onerror = errorCallback;
	}
	else {
		xmlhttp.onerror = function () {
			console.log(xmlhttp.status, xmlhttp.statusText);
		};
	}

	if (data) {
		xmlhttp.send(JSON.stringify(data));
	}
	else {
		xmlhttp.send();
	}

}


function onLoad() {
	login();
}


function login(servername, userId, password) {
	payload = {
		"__type": "urn:inin.com:connection:icAuthConnectionRequestSettings",
		"applicationName": APPNAME,
		"userID": userId,
		"password": password
	};
	server = "http://" + servername + ":8018/icws/";
	console.log(server);
	// sendRequest("POST", "connection", payload, afterLogin);
	// Adding the "features" value for the optional "include" query string so we can retrieve the currently supported messaging version.
	sendRequest('POST', 'connection?include=features,effective-station,version', payload, afterLogin, errorFn);
	// sendRequest('POST', 'connection?include=features,effective-station', payload, sendSessionlessRequestCallback, errorFn);
	
}




// Dictionary of ICWS message __type ID to the callback (type: icwsMessageCallback) to invoke when that message is received.
var icwsMessageCallbacks = {};
// Optional callback for processing unhandled ICWS messages.
// Type: icwsMessageCallback
var icwsUnhandledMessageCallback = null;
// Timer for when short-polling is used.
var messageProcessingTimerId;
// EventSource object for when Server Sent Events is used.
var eventSource;

// Polling interval for retrieving ICWS message queue.
var ICWS_MESSAGE_RETRIEVAL_INTERVAL_MS = 1000;

// Reconnect interval for establish a connection with alternate swith over server.
var ICWS_RECONNECT_INTERVAL_MS = 15000;

/**
 * The callback for receiving messages due to using {@link registerMessageCallback}.
 * @callback icwsMessageCallback
 * @param {Object} jsonMessage The JSON message payload.
 * @see icwsDirectUsageExample.session.registerMessageCallback
 */

/**
 * Sets the callback for a particular type of ICWS message.
 * @param {String} messageType The ICWS message type. (ex: urn:inin.com:status:userStatusMessage)
 * @param {icwsMessageCallback} messageCallback The callback to invoke with the message details.
 * @throws {Error} The messageCallback was undefined.
 * @throws {Error} A callback is already registered for the specified messageType.
 */
var registerMessageCallback = function (messageType, messageCallback) {
	if (messageCallback === undefined) {
		throw new Error('Invalid argument "messageCallback".');
	}

	if (!icwsMessageCallbacks[messageType]) {
		icwsMessageCallbacks[messageType] = messageCallback;
	} else {
		throw new Error('Message callback already registered for message type: ' + messageType);
	}
};

/**
 * Sets the callback for unhandled ICWS messages.
 * @param {icwsMessageCallback} messageCallback The callback to invoke with the message details.
 * @throws {Error} The messageCallback was undefined.
 * @throws {Error} A callback is already registered for unhandled messages.
 */
var registerUnhandledMessageCallback = function (messageCallback) {
	if (messageCallback === undefined) {
		throw new Error('Invalid argument "messageCallback".');
	}

	if (!icwsUnhandledMessageCallback) {
		icwsUnhandledMessageCallback = messageCallback;
	} else {
		throw new Error('Message callback already registered for unhandled messages.');
	}
};


/**
 * Starts the message processing mechanism, if not already running.
 * @see stopMessageProcessing
 */
function startMessageProcessing() {
	// Check to see if the browser being used supports EventSource, and check
	// if the connected ICWS session supports server sent events.  If they are
	// both supported, then we will elect to use the message processing for
	// server sent events instead of short-polling.
	if (typeof EventSource !== 'undefined'
		&& icwsCurrentMessagingVersion >= icwsMessagingVersionForServerSentEvents) {

		startServerSentEventsMessageProcessing();

		console.log('server sent event messaging started...');
	} else {
		startShortPollingMessageProcessing();
		console.log('short polling started...');
	}
}

/**
 * Starts the message processing mechanism for server sent events, if not already running.
 * @see stopMessageProcessing
 * @see startMessageProcessing
 */
function startServerSentEventsMessageProcessing() {
	if (!eventSource) {
		var messagesUrl = icwsCurrentSession.server + '' + icwsCurrentSession.sessionId + '/messaging/messages';

		eventSource = new EventSource(messagesUrl, { withCredentials: true });

		// Add in some event handlers to display the status of the EventSource socket.
		eventSource.onopen = function () {
			//icwsDirectUsageExample.diagnostics.reportInformationalMessage('EventSource socket was opened.', null);
			console.log('EventSource socket was opened.');
			$('#icwsInfo').prepend('<br>' + 'EventSource socket was opened.' + '<br>' + syntaxHighlight(messagesUrl) + '<br>');
		};
		eventSource.onerror = function () {
			var status;

			switch (eventSource.readyState) {
				case EventSource.CONNECTING:
					status = 'EventSource socket is reconnecting.';
					break;
				case EventSource.CLOSED:
					status = 'EventSource socket was closed.';
					break;
			}

			//icwsDirectUsageExample.diagnostics.reportInformationalMessage(status, null);
			console.log(status);
		};

		eventSource.addEventListener('message', function (e) {
			//icwsDirectUsageExample.diagnostics.reportInformationalMessage('Received Message', e.data);
			console.log('Received Message', e.data);
			var message = JSON.parse(e.data);
			var messageType = message.__type;
			// var message = syntaxHighlight(e.data);
			console.log(messageType, message);
			// $('#icwsInfo').append('<br>' + messageType);
			$('#icwsInfo').prepend('<br>' + syntaxHighlight(e.data));
			processMessage(message);
			// $('#notificationInfo').append('<br>', message.data[0],' ',message.data[1]);
			$("#notificationLoader").hide();
		});
	}
}

function stopServerSentEventsMessageProcessing() {
	if (!!eventSource) {
		eventSource.close();
		eventSource = null;
		console.error('CLOSED!');
	}
}
/**
	 * Stops the message processing mechanism for short-polling, if running.
	 * @see startMessageProcessing
	 * @see stopMessageProcessing
	 */
function stopShortPollingMessageProcessing() {
	if (!!messageProcessingTimerId) {
		clearTimeout(messageProcessingTimerId);
		messageProcessingTimerId = null;
	}
}

/**
 * Calls the registered callback for a message received from the server.
 * @see startMessageProcessing
 * @see stopMessageProcessing
 */
function processMessage(jsonMessage) {
	var messageType, messageCallback;
	messageType = jsonMessage.__type;

	console.log('Processing message: ');
	console.warn(jsonMessage);
	console.log(messageType);
	$('#icwsInfo').prepend('<br>' + messageType);
	// For each message, invoke a registered message callback if there is one;
	// otherwise, invoke the unhandled message callback.
	messageCallback = icwsMessageCallbacks[messageType];
	if (messageCallback) {
		messageCallback(jsonMessage);
	} else if (icwsUnhandledMessageCallback !== null) {
		icwsUnhandledMessageCallback(jsonMessage);
	}
}



/**
 * Implements the message processing mechanism timer callback.
 * @see startMessageProcessing
 * @see stopMessageProcessing
 */
function messageProcessingTimerCallback() {
	// var diagnostics = icwsDirectUsageExample.diagnostics;
	// var utilities = icwsDirectUsageExample.utilities;
	var currentSessionId, payload, messageIndex, messageCount;

	// Provide contextual information for the request.
	console.log('Retrieve messages from ICWS', 'Retrieve any pending event messages from the ICWS server.');

	currentSessionId = icwsCurrentSession.sessionId;

	payload = {};

	sendRequest('GET', currentSessionId + '/messaging/messages', payload, function (jsonResponse) {
		// Ignore results for an older session.
		// if (currentSessionId === sessionId) {

		if (jsonResponse.length >= 1) {
			console.warn('RETRIEVING.... ');
			console.warn(jsonResponse);
			// var message = JSON.parse(jsonResponse[0].data);
			// messageType = message.__type;
			console.log(JSON.stringify(jsonResponse));
			$('#icwsInfo').prepend('<br>' + JSON.stringify(jsonResponse));
			processMessage(jsonResponse[0]);
			// processMessage(message);
			// $('#notificationInfo').append('<br>', message.data[0],' ',message.data[1]);
			$("#notificationLoader").hide();
			// // Process retrieved messages.
			// for (messageIndex = 0, messageCount = jsonResponse.length; messageIndex < messageCount; messageIndex++) {
			// 	processMessage(jsonResponse[messageIndex].data);
			// }
		}
		// }
	});
}




/**
	* Determines whether an http status code is in the successful range (200-299).
	* @param {Number} statusCode The status code to check.
	* @returns {Boolean} true if the statusCode represents a success.
	*/
function isSuccessStatus(statusCode) {
	return ((statusCode >= 200) && (statusCode <= 299));
};



function startShortPollingMessageProcessing() {
	// Only send the next request once the previous result has been received.
	var messagesUrl = icwsCurrentSession.server + '' + icwsCurrentSession.sessionId + '/messaging/messages';
	$('#icwsInfo').prepend('<br>' + 'IE message polling initiated.' + '<br>' + syntaxHighlight(messagesUrl) + '<br>');

	function runTimerInstance() {
		messageProcessingTimerCallback();

		messageProcessingTimerId = setTimeout(runTimerInstance, ICWS_MESSAGE_RETRIEVAL_INTERVAL_MS);
	}

	if (!messageProcessingTimerId) {
		runTimerInstance();
	}
}
/**
	* Stops the message processing mechanism, if running.
	* @see startMessageProcessing
	*/
function stopMessageProcessing() {
	// Call the appropriate stop based on if we used server sent events or short-polling.
	if (eventSource) {
		stopServerSentEventsMessageProcessing();
	} else {
		stopShortPollingMessageProcessing();
	}
}


// Initialize an internal message callback only once.
var connectionMessageCallbacksInitialized = false;

/**
 * Initialize monitoring of connection state messages.
 */
function initializeConnectionMessageCallbacks() {
	if (!connectionMessageCallbacksInitialized) {
		// Subscribe to the session model's callback mechanism for receiving ICWS messages.
		// The session module itself handles connectionStateChanged messages, invoking the disconnectCallback passed in to icwsConnect.
		registerMessageCallback('urn:inin.com:connection:connectionStateChangeMessage', connectionStateChanged);
		registerMessageCallback('urn:inin.com:connection:effectiveStationChangeMessage', effectiveStationChanged);
		connectionMessageCallbacksInitialized = true;
	}
}
/**
 * Connection state changed message processing callback.
 * @param {Object} jsonMessage The JSON message payload.
 * @param {String} jsonMessage.newConnectionState The new ICWS connection state.
 * @param {String} jsonMessage.reason The reason for the change.
 */
function connectionStateChanged(jsonMessage) {
	var newConnectionState = jsonMessage.newConnectionState;

	// If the connection changes to down, and the application state shows that it is currently connection.
	if (newConnectionState === 'down') {
		if (exports.isConnected()) {
			// Stop message processing for the current ICWS session.
			stopMessageProcessing();

			// Clear the cached ICWS credentials for the current ICWS session.
			clearCredentials();

			// If there is a cached disconnect callback, invoke it.
			if (sessionDisconnectCallback) {
				sessionDisconnectCallback(jsonMessage.reason);
			}
		}
	}
}

/**
* Effective station changed message processing callback.
* @param {Object} jsonMessage The JSON message payload.
* @param {Object} jsonMessage.effectiveStation.stationId The new effective station.
*/
function effectiveStationChanged(jsonMessage) {
	if (jsonMessage.effectiveStation) {
		icwsEffectiveStationId = jsonMessage.effectiveStation.stationId;
	}
}


/**
 * Stores a set of ICWS session credentials.
 * @param {String} icwsServer The server name where ICWS is available.
 * @param {String} icwsUserId The IC user ID for the session.
 * @param {String} icwsCsrfToken The ICWS CSRF token.
 * @param {String} icwsSessionId The ICWS session ID.
 */
function setCredentials(icwsServer, icwsUserId, icwsCsrfToken, icwsSessionId) {
	icwsCurrentSession = {
		server: icwsServer,
		userId: icwsUserId,
		csrfToken: icwsCsrfToken,
		sessionId: icwsSessionId
	};
	console.log(icwsCurrentSession);
	console.log(icwsCurrentSession.sessionId);
}

function afterLogin(data) {

	sessionId = data.sessionId;
	
	//sessionId = data['sessionId']; //grabs the sessionId from the data object
	csrfToken = data['csrfToken']; //grabs the csrfToken from the data object
	// setCredentials(server_url, userId, csrfToken, sessionId);
	setCredentials(server, userId, csrfToken, sessionId);
	// console.log(data , server , server_url);
	// startIcws();

	// Cache the supported messaging version for this ICWS session connection.
	// This is used to help determine if we can use server sent events over short-polling for message processing.
	// The features property is an array that does not guarantee index positions of features,
	//   so we need to search it for the featureId we are interested in.
	// console.log(data.version);
	console.warn(data.version);
	console.warn(data.features);
	$('#icwsInfo').prepend('<br>' + JSON.stringify(data.features));
	$('#icwsInfo').prepend('<br>' + data.version.productPatchDisplayString);

	if (data.features) {
		for (var i = data.features.length - 1; i >= 0; i--) {
			var featureObject = data.features[i];

			if (featureObject.featureId === 'messaging') {
				icwsCurrentMessagingVersion = featureObject.version;
				break;
			}
		}
	}


	// Start monitoring for connection state changed messages.
	// initializeConnectionMessageCallbacks();
	startMessageProcessing();

	//subscribe to handler sent response after login
	var notificationData = {
		"headers": [{
			"__type": "urn:inin.com:system:handlerSentNotificationsSubscription",
			"objectId": "addinHandler",			//sUserQueueName or agent ID
			"eventIds": ["sayHelloResponse"]	//"BrokerSolutions_LoanAgentRouting_TransferUpdate"
		}]
	}

	// var uri = '/messaging/subscriptions/system/handler-sent-notifications';
	var uri = '/messaging/subscriptions/system/handler-sent-notifications';
	sendRequest("PUT", sessionId + uri, notificationData, function () {
		// $("#notificationLoader").hide();
		console.warn('Notification Subscribed.');
	}, errorFn)



}


