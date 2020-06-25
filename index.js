const record = require('node-record-lpcm16');

const util = require('util');

var loudness = require('loudness');

// Imports the Google Cloud client library
const Speech = require('@google-cloud/speech');

// Instantiates a client
const speech = Speech();

var googleTTS = require('google-tts-api');

//var Player = require('player');
//var StreamPlayer = require('stream-player');

const WebSocket = require('ws');

// Google Speech API event type for end of single utterance
const SPEECH_EVENT_END_OF_UTTERANCE = 'END_OF_SINGLE_UTTERANCE';

var wget = require('node-wget');

const NS_PER_MS = 1e6;

const MS_PER_SEC = 1e3;

var lastRequestTimestamp;
var lastResponseTime = [0, 0];

// The encoding of the audio file, e.g. 'LINEAR16'
const encoding = 'LINEAR16';

// The sample rate of the audio file in hertz, e.g. 16000
const sampleRateHertz = 16000;

// The BCP-47 language code to use, e.g. 'en-US'
const languageCode = 'fi-FI';

//const conversation_URL = 'ws://localhost:1880/mami/discussion';
const conversation_URL = 'ws://mami-red.eu-gb.mybluemix.net/ws/mami-conversation';

// Generate userID for the conversation
const userId = Date.now();

const wsUi = new WebSocket("ws://localhost:9000");

// Recording configuration
const recordConfig = {
    sampleRateHertz: sampleRateHertz,
    threshold: 0,
    // Other options, see https://www.npmjs.com/package/node-record-lpcm16#options
    verbose: true,
    recordProgram: 'arecord', // 'arecord' works on raspberry, other options are sox, arec. leave undefined in macos
    silence: '60.0', // silence value '10.0' has been used so far successfully
    device: "hw:1,0" // Jabra USB on raspberry is found as 'hw:1,0', leave undefined in macos
};

// Speech recognition configuration
const request = {
  config: {
    encoding: encoding,
    sampleRateHertz: sampleRateHertz,
    languageCode: languageCode
  },
  interimResults: true, // If you want interim results, set this to true
  singleUtterance: true,
  verbose: true
};

function getLastResponseTimeinMs() {

	millisecs = lastResponseTime[0] * MS_PER_SEC +
		lastResponseTime[1] / NS_PER_MS;
	return millisecs;
};

/**
 * Send conversation status to UI. Valid values are:
 * - LISTENING
 * - PAUSED
 * - INITIALISING
 * - SPEAKING
 * - PROCESSING
 *
 */
function sendStatusToUi(status) {

  //Send message to UI
  uiMessage = {
    messageType: 'STATUS',
    payload: status
  };
  wsUi.send(JSON.stringify(uiMessage));

};

function adjustVolume(direction, callback) {

  var targetVolume;

  loudness.getVolume(function (err, vol) {
      console.log("Current volume: " + vol);

      if (direction == 'up') {
          if (vol > 90) {
            targetVolume = 100;
          } else {
            targetVolume = vol + 10;
          }

          loudness.setVolume(targetVolume, function (err) {
              console.log("Volume set to :" + targetVolume);
              callback(targetVolume);
          });

      } else if (direction == 'down') {
          if (vol <= 10) {
            targetVolume = vol;
          } else {
            targetVolume = vol - 10;
          }

          loudness.setVolume(targetVolume, function (err) {
              console.log("Volume set to :" + targetVolume);
              callback(targetVolume);
          });

      } else {
          console.log("No direction defined, keeping current volume");
          targetVolume = vol;
          callback(targetVolume);
      }

  });

}

function getRecognitionStream() {

  var writeStream = speech.createRecognizeStream(request)
  	  .on('error', function(error) {
  		  console.log("Error occured in recognizeStream");
  		  console.log(error);
  		  //~ console.log("Re-starting recording");
  		  //~ startRecording();
  	  })
  	  .on('data', function(data) {

  			processRecognitionResult(data);
  		})
      .on('close', function() {
        console.log("Speech recognition steam was closed!");
      })
      .on('finish', function() {
        console.log("Speech recognition steam was finished!");
      });

  return writeStream;
}

function startRecording() {
	// Create a recognize stream
	recognizeStream = getRecognitionStream();


	// Start recording and send the microphone input to the Speech API
	//record
	  //.start(recordConfig)
	  //.on('error', console.error)
	  //.pipe(recognizeStream);

  recordStream = record.start(recordConfig);
  recordStream.on('error', console.error);
  recordStream.on('end', function() {
    console.log("Record stream ended!");
  });
  recordStream.on('start', function() {
    console.log("Record stream started!");
  });
  recordStream.on('close', function() {
    console.log("Record stream closed!");
  });
  recordStream.pipe(recognizeStream);
  sendStatusToUi('LISTENING');

}

function processRecognitionResult(data) {
   process.stdout.write("New Event\n");
   console.log(data);

   //wsUi.send(JSON.stringify(data));

   process.stdout.write(util.inspect(data.results, {showHidden: false, depth: null}) + "\n");

   // We always assume that the first result is the only one
   const result = data.results[0];

   // Check if end of utterance event was received
   if (data.speechEventType == SPEECH_EVENT_END_OF_UTTERANCE) {
      sendStatusToUi('PAUSED');
      recordStream.pause();
      recordStream.unpipe(recognizeStream);
      recognizeStream.end();

      recognizeStream = getRecognitionStream();
      recordStream.pipe(recognizeStream);
      sendStatusToUi('LISTENING');

   } else if (result) {
     // Send to UI
     uiMessage = {
       messageType: 'speech_transcript',
       payload: result
     };
     wsUi.send(JSON.stringify(uiMessage));
   }

   if (result && result.isFinal) {
	   console.log("Final transscript");
	   console.log("Stopping recording");

	   interimResultsReceived = false;
	   record.stop();
     sendStatusToUi('PROCESSING');

	   //recognizeStream.end(); // 27.11.2017: Tämä kommentoitu ulos tarpeettomana
      console.log("Sending result to ws");
      let request = {
        userId: userId,
        inputSentence:  result.transcript.trim(),
        confidence: result.confidence,
        lastResponseTime: getLastResponseTimeinMs()
      }
      console.log(request);

      lastRequestTimestamp = process.hrtime();
      ws.send(JSON.stringify(request));


   }
}

function playTextAsSpeech(sentence, speechLang, callback) {

  googleTTS(sentence, speechLang, 1)   // speed normal = 1 (default), slow = 0.24
	.then(function (url) {
	  //console.log(url); // https://translate.google.com/translate_tts?...
	  console.log(url);
	  var d = new Date();
	  var n = d.getTime();
	  filename = "audiodata/speech_" + n + ".mp3";

	  wget({
		  url: url,
		  dest: filename,
	  },
		function (error, response, body) {
			if (error) {
				console.log('--- error:');
				console.log(error);            // error encountered
			} else {

				var exec = require('child_process').exec;
				var cmd = 'play ' + filename;

        if (recordStream._readableState.flowing) {
          console.log("Backend initiated speech, stopping recording.");
          record.stop();
        }
        sendStatusToUi('SPEAKING');
				exec(cmd, function(error, stdout, stderr) {
					console.log(stdout);
					callback();
				});
			}
		});
	})
	.catch(function (err) {
		console.error(err.stack);
	});


}

function processMirrorActions(actions) {

  if (actions === undefined || actions.length == 0) {
    console.log("No mirror actions to perform.");
    return;

  }

  uiMessage = {
    messageType: 'mirror_actions',
    payload: actions
  };

  wsUi.send(JSON.stringify(uiMessage));
}

function processServerMessage(data) {

  lastResponseTime = process.hrtime(lastRequestTimestamp);
	console.log(lastResponseTime);
	console.log(data);

	//var shorter = data.substring(0, 199);
	var obj = JSON.parse(data);

  processMirrorActions(obj.actions);

	var response = obj.response;
	var shorter = response.substring(0, 199);
	var speechLang;
	// We need convert language code
	if (obj.lang == 'fi') {
		speechLang = 'fi-fi';
	} else if (obj.lang == 'sv') {
		speechLang = 'sv-SE';
	} else if (obj.lang == 'de') {
		speechLang = 'de-DE';
	} else {
		speechLang = data.lang;
	}

  //Send message to UI
  uiMessage = {
    messageType: 'response_transcript',
    payload: response
  };
  wsUi.send(JSON.stringify(uiMessage));

  adjustVolume(obj.volume, function() {
    playTextAsSpeech(shorter, speechLang, function() {
      console.log("Speaking finished, startRecording() invoked");
      startRecording();
    });
  });


}

var recognizeStream;

const ws = new WebSocket(conversation_URL);
ws.on('open', function open() {
  console.log("WebSocket connection to Discussion server established");
});

wsUi.on('open', function open() {
  console.log("WebSocket connection to UI established");
});

ws.on('message', function incoming(data) {

  processServerMessage(data);

});
setTimeout(function() {
  startRecording();
  console.log('Listening, press Ctrl+C to stop.');

}, 5000);
//startRecording();
