(function () {

"use strict";

var SEQUENCES = [
	["nose", "nose"],
	["nose", "mouth"],
	["mouth", "mouth"],

	["nose", "mouth"],
	["mouth", "mouth"],
	["nose", "nose"],

	["mouth", "mouth"],
	["nose", "nose"],
	["nose", "mouth"]
];

var RHYTHM = ["rest", "in", "hold", "out"];

var SEQUENCE_AUDIO = {
	"nose-in"   :  "nose-in.mp3",
	"nose-out"  :  "nose-out.mp3",
	"mouth-in"  :  "mouth-in.mp3",
	"mouth-out" :  "mouth-out.mp3",
	"silence"   :  "silence.mp3"
};

var savableGlobalStateKeys = ["timing", "times", "audioEnabled", "repeatEnabled"];

function defaultGlobalState() {
	var timing = {};
	RHYTHM.forEach(function (item) {
		timing[item] = 10;
	});
	return {
		timing: timing,
		times: 7,
		audioEnabled: true,
		audioLoaded: false,
		audioLoadError: null,
		repeatEnabled: false
	};
}

function updateLoadedGlobalState() {
	var defaultState = defaultGlobalState();
	var missingState = {};
	for (var k in defaultState) {
		if ( defaultState.hasOwnProperty(k) && !globalState.hasOwnProperty(k) ) {
			missingState[k] = defaultState[k];
		}
	}
	setGlobalState(missingState);
}

var globalState;
var savedGlobalState = localStorage.getItem("7breaths");
if (savedGlobalState) {
	try {
		globalState = JSON.parse(savedGlobalState);
	} catch(e) {
		window.console.error(e);
		globalState = defaultGlobalState();
	}
	updateLoadedGlobalState();
}
if ( !globalState ) {
	globalState = defaultGlobalState();
}

function stringifyGlobalState() {
	var state = {};
	for (var k in globalState) {
		if (globalState.hasOwnProperty(k) && savableGlobalStateKeys.indexOf(k) !== -1) {
			state[k] = globalState[k];
		}
	}
	return JSON.stringify(state);
}

function setGlobalState(state) {
	for (var k in state) {
		if (state.hasOwnProperty(k)) {
			globalState[k] = state[k];
		}
	}
	localStorage.setItem("7breaths", stringifyGlobalState());
	if (breathSequencer) {
		breathSequencer.setState(breathSequencer.state);
	}
}

function copy(other) {
	var obj = {};
	for (var k in other) {
		if (other.hasOwnProperty(k)) {
			obj[k] = other[k];
		}
	}
	return obj;
}

var maxSequenceIndex = SEQUENCES.length-1;
var maxSequenceStepIndex = SEQUENCES[0].length-1;
var maxRhythmIndex = RHYTHM.length-1;


window.AudioContext = window.AudioContext || window.webkitAudioContext;
var BreathSequencer = function () {
	this.__changeListeners = [];
	this.__audioContext = new window.AudioContext();
	this.__audioData = {};
	this.state = this.getInitialState();
};

BreathSequencer.prototype.getInitialState = function () {
	return {
		rhythmIndex: 0,
		rhythmFrequencyCounter: 0,
		sequenceIndex: 0,
		sequenceStepIndex: 0,
		sequenceRepeatCounter: 0
	};
};

BreathSequencer.prototype.getData = function () {
	var state = this.state;
	var totalTime = 0;
	RHYTHM.forEach(function (item) {
		totalTime = totalTime + (globalState.timing[item] * globalState.times);
	});
	totalTime = totalTime * SEQUENCES.length;
	return {
		isRunning: !!this.started,
		rhythm: globalState.timing[RHYTHM[state.rhythmIndex]] - state.rhythmFrequencyCounter,
		rhythmIndex: state.rhythmIndex,
		sequenceIndex: state.sequenceIndex,
		sequenceStepIndex: state.sequenceStepIndex,
		repeatIndex: globalState.times - state.sequenceRepeatCounter,
		totalTime: totalTime
	};
};

BreathSequencer.prototype.tick = function () {
	var state = copy(this.state);
	var timing = globalState.timing[RHYTHM[state.rhythmIndex]];
	if (state.rhythmFrequencyCounter++ === timing - 1) {
		state.rhythmFrequencyCounter = 0;
		if (RHYTHM[state.rhythmIndex] !== "hold" && RHYTHM[state.rhythmIndex] !== "rest") {
			if (state.sequenceStepIndex === maxSequenceStepIndex) {
				state.sequenceStepIndex = 0;
				if (state.sequenceRepeatCounter++ === globalState.times - 1) {
					state.sequenceRepeatCounter = 0;
					if (state.sequenceIndex === maxSequenceIndex) {
						if (globalState.repeatEnabled) {
							state.sequenceIndex = 0;
						} else {
							this.stop();
							return;
						}
					} else {
						state.sequenceIndex++;
					}
				}
			} else {
				state.sequenceStepIndex++;
			}
		}
		if (state.rhythmIndex === maxRhythmIndex) {
			state.rhythmIndex = 0;
		} else {
			state.rhythmIndex++;
		}
	}
	var shouldPlayAudio = false;
	if (state.rhythmIndex !== this.state.rhythmIndex || state.sequenceStepIndex !== this.state.sequenceStepIndex || state.sequenceIndex !== this.state.sequenceIndex || state.rhythmIndex === 0) {
		shouldPlayAudio = true;
	}
	this.setState(state);
	if (shouldPlayAudio && globalState.audioEnabled) {
		this.__playAudio();
	}
};

BreathSequencer.prototype.start = function () {
	this.started = true;
	this.__interval = setInterval(this.tick.bind(this), 1000);
	this.__playSilentAudio();
	this.tick();
};

BreathSequencer.prototype.stop = function () {
	this.started = false;
	this.__stopAudio();
	clearInterval(this.__interval);
	this.setState(this.getInitialState());
};

BreathSequencer.prototype.toggle = function () {
	if (this.started) {
		this.stop();
	} else {
		this.start();
	}
};

BreathSequencer.prototype.addChangeListener = function (fn) {
	this.__changeListeners.push(fn);
};

BreathSequencer.prototype.removeChangeListener = function (fn) {
	this.__changeListeners = this.__changeListeners.filter(function (__fn) {
		return __fn !== fn;
	});
};

BreathSequencer.prototype.loadAudio = function () {
	var promises = [];
	for (var k in SEQUENCE_AUDIO) {
		if (SEQUENCE_AUDIO.hasOwnProperty(k)) {
			promises.push(this.__loadAudio(SEQUENCE_AUDIO[k]));
		}
	}
	return Promise.all(promises).then(function () {
		// work-around for iOS
		return new Promise(function (resolve, reject) {
			var audioPath = SEQUENCE_AUDIO.silence;
			var b = this.__audioData[audioPath].slice(0);
			this.__audioContext.decodeAudioData(b, function(buffer) {
				this.__silentAudioBuffer = buffer;
				resolve();
			}.bind(this), function (err) {
				reject();
				window.console.error("Error loading audio context: ", err);
			});
		}.bind(this));
	}.bind(this));
};

BreathSequencer.prototype.__stopAudio = function () {
	if (this.__currentAudioSource) {
		this.__currentAudioSource.disconnect();
		delete this.__currentAudioSource;
	}
};

BreathSequencer.prototype.__playAudio = function () {
	var sequence = SEQUENCES[this.state.sequenceIndex][this.state.sequenceStepIndex];
	var rhythm = RHYTHM[this.state.rhythmIndex];
	var id = sequence +"-"+ rhythm;
	var audioPath = SEQUENCE_AUDIO[id];
	this.__stopAudio();
	if ( !audioPath ) {
		return;
	}

	var b = this.__audioData[audioPath].slice(0);

	this.__audioContext.decodeAudioData(b, function(buffer) {
		var source = this.__audioContext.createBufferSource();
		source.buffer = buffer;
		source.connect(this.__audioContext.destination);
		source.playbackRate.value = 1 / (globalState.timing[rhythm] / buffer.duration); // ensure audio fills rhythm duration
		source.start(0);
		this.__currentAudioSource = source;
	}.bind(this), function (err) {
		window.console.error("Error loading audio context: ", err);
	});
};

// work-around for iOS
BreathSequencer.prototype.__playSilentAudio = function () {
	var source = this.__audioContext.createBufferSource();
	source.buffer = this.__silentAudioBuffer;
	source.connect(this.__audioContext.destination);
	source.playbackRate.value = 1;
	source.start(0);
};

BreathSequencer.prototype.__loadAudio = function (url) {
	var resolve, reject;
	var promise = new Promise(function (rs, rj) {
		resolve = rs;
		reject = rj;
	});
	var request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.responseType = 'arraybuffer';

	request.addEventListener("load", function() {
		if (request.status === 200) {
			this.__audioData[url] = request.response;
			resolve();
		} else {
			reject("Error loading "+ JSON.stringify(url) +": "+ request.statusText);
		}
	}.bind(this), false);
	request.addEventListener("error", function (e) {
		reject(e);
	}, false);
	request.send();
	return promise;
};

BreathSequencer.prototype.setState = function (state) {
	this.state = state;
	this.__changeListeners.forEach(function (fn) {
		fn();
	});
};

var breathSequencer = new BreathSequencer();
breathSequencer.loadAudio().then(function () {
	setGlobalState({
		audioLoaded: true,
		audioLoadError: null
	});
}).catch(function (e) {
	setGlobalState({
		audioLoadError: e
	});
	window.console.error(e);
});

React.render(React.createElement(React.createClass({
	render: function () {
		var state = this.state;
		if (state.isRunning) {
			var isRest = RHYTHM[state.rhythmIndex] === "rest";
			return (
				<div className="main large">
					{SEQUENCES.map(function (s, si) {
						return (
							<div key={"s"+si}>
								{RHYTHM.map(function (text, i) {
									return (
										<span key={"r"+i} className={"rhythm" + (si === state.sequenceIndex && i === state.rhythmIndex ? " active" : "") + (isRest ? " blue" : "")}>{text}</span>
									);
								})}
								{s.map(function (text, i) {
									return (
										<span key={"s"+i} className={"step" + (si === state.sequenceIndex && i === state.sequenceStepIndex && !isRest ? " active" : "")}>{text}</span>
									);
								})}
								{si === state.sequenceIndex ? (
									<span className="count">{state.rhythm} {state.repeatIndex}</span>
								) : (
									<span className="count invisible">4 7</span>
								)}
							</div>
						);
					})}
				</div>
			);
		} else {
			return (
				<div className="main">
					<h1>Breath</h1>

					<div className="config">
						<h3>Timing</h3>
						{RHYTHM.map(function (item) {
							return (
								<label key={"s"+item}>
									{item}:&nbsp;
									<input type="text" defaultValue={globalState.timing[item]} onChange={function (e) {
											globalState.timing[item] = parseInt(e.target.value.trim(), 10) || 0;
											setGlobalState(globalState);
									}} /><span title="seconds">s</span>
								</label>
							);
						})}
					</div>

					<div className="config">
						<label>
							Repeat?&nbsp;
							<input
								type="checkbox"
								checked={globalState.repeatEnabled}
								onChange={function (e) {
									setGlobalState({
										repeatEnabled: !e.target.checked
									});
								}} />
						</label>
					</div>

					<div className="config">
						Session time: {state.totalTime / 60} minutes
					</div>

					<div className="config">
						{globalState.audioLoadError ? (
							<p style={{ color: "red" }}>{globalState.audioLoadError}</p>
						) : null}
						<label>
						Audio enabled:&nbsp;
						<input
							type="checkbox"
							checked={globalState.audioLoadError === null && globalState.audioEnabled} disabled={globalState.audioLoadError}
							onChange={function (e) {
								setGlobalState({
									audioEnabled: !e.target.checked
								});
							}} />
						</label>
					</div>

					<div>
						<button onClick={breathSequencer.toggle.bind(breathSequencer)} disabled={(globalState.audioEnabled && !globalState.audioLoaded) || globalState.audioLoadError}>Start</button>
					</div>
				</div>
			);
		}
	},

	componentDidMount: function () {
		breathSequencer.addChangeListener(this.__handleChange);
	},

	componentWillUnmount: function () {
		breathSequencer.removeChangeListener(this.__handleChange);
	},

	getInitialState: function () {
		return this.__getState(this.props);
	},

	__getState: function () {
		return breathSequencer.getData();
	},

	__handleChange: function () {
		this.setState(this.__getState(this.props));
	}
})), document.getElementById("main"));

document.body.addEventListener("click", breathSequencer.stop.bind(breathSequencer), false);

})();
