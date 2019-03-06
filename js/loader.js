$(document).ready(function () {
    console.log('Page is ready and loaded!');

    $("#notificationLoader").hide();

    var btnConnect1 = document.getElementById('btnConnect');
    var btnDisconnect1 = document.getElementById('btnDisconnect');
    
    btnConnect1.addEventListener('click', function (evt) {
        // evt.preventDefault();
        console.log('clicked');
        // Init();
        userId = $('#username').val();
        password = $('#password').val();
        serverName = $('#server').val();
        server_url = "http://" + serverName + ":8018/icws/";
        console.log(serverName, userId, password);
        login(serverName,userId,password);
        btnConnect1.style.display = 'none';
        btnDisconnect1.style.display = 'block';
        $('#icwsInfo').empty();
    }); //end btnConnect

    $('#btnDisconnect').on('click', function () {
        var uri = '/connection/station';
        sendRequest("DELETE", sessionId + uri, null, function () {
            // $("#notificationLoader").hide();
            console.warn('Station connection deleted.');
        }, errorFn);
        var uri = '/messaging/subscriptions/connection/station';
        sendRequest("DELETE", sessionId + uri, null, function () {
            // $("#notificationLoader").hide();
            console.warn('Station watch deleted.');
        }, errorFn);
        var uri = '/connection/';
        sendRequest("DELETE", sessionId + uri, null, function () {
            // $("#notificationLoader").hide();
            console.warn('Connection deleted.');
        }, errorFn);
        btnConnect1.style.display = 'block';
        btnDisconnect1.style.display = 'none';
        stopMessageProcessing();
        // stopServerSentEventsMessageProcessing();
        $('#icwsInfo').prepend('Disconnected...');
    });

    $('#btnSendNotification').on('click', function () {
        console.warn('Sending notification.')
        $("#notificationLoader").show();
        var dataInfo = $("#notificationData").val();
        // ICWS configuration API retrievals utilize query parameters to specify which values should be returned.
        // uri = '/configuration/users/' + userId;

        var notificationData = {
            "__type": "urn:inin.com:system:handlerNotification",
            "objectId": "addinHandler",  //Broker_LoanAgentRouting
            "eventId": "sayHello", //Start or SC_Start
            "data": [dataInfo]      //[agentID, callid, zipcode, other stuff]
        }
        var uri = '/system/handler-notification';
        sendRequest("POST", sessionId + uri, notificationData, function () {
            // $("#notificationLoader").hide();
            console.warn('Notification sent.');
        }, errorFn)
        // $('#icwsInfo').append(JSON.stringify(data) + '<br>');
        // $('#icwsInfo').prepend('<br>' + syntaxHighlight(data));
    });
});

/**
       * Performs simple syntax highlighting for the provided JSON.
       * @param {Object|String} json The JSON to be syntax highlighted.
       * @returns {String} The highlighted text.
       */
function syntaxHighlight(json) {
    var cls;

    if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
};


// function to handle errors during ajax request
function errorFn(status) {
    var btnConnect1 = document.getElementById('btnConnect');
    var btnDisconnect1 = document.getElementById('btnDisconnect');
    // generate a console message
    // Typically you would let the user know that something didn't work correctly      and not log messages to the console
    console.log('Something has gone terribly wrong with your Ajax request!');
    $('#icwsInfo').prepend('ERROR with Connection');
    btnConnect1.style.display = 'block';
    btnDisconnect1.style.display = 'none';
    
}
