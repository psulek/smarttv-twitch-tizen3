//Variable initialization
//A webapis.avplay compatible player that uses a <video> element + hls.js (app/lib/hls.light.min.js)
//Twitch serves fMP4 segments (#EXT-X-MAP) for some channels (eg.: Enhanced Broadcasting channels),
//AVPlay of older TVs (Tizen 3.0) can't play those, it shows only a black screen.
//Only the AVPlay functions used by this app are implemented, times are in ms as in AVPlay.
var PlayHls_video = null;
var PlayHls_hls = null;
var PlayHls_url = null;
var PlayHls_state = 'NONE';
var PlayHls_listener = {};
var PlayHls_startPosition = -1;
var PlayHls_prepareCallbacks = null;
var PlayHls_mediaErrorRecoverCount = 0;
var PlayHls_levelDuration = 0;
//on screen diagnostics for the hls.js player (retail TVs don't allow remote debugging), set to true to debug playback
var PlayHls_ShowDebug = false;
var PlayHls_DebugLines = [];
var PlayHls_DebugCounters = {};
var PlayHls_DebugId;
var PlayHls_DebugHeader = '';
//Variable initialization end

function PlayHls_Debug(text) {
    if (!PlayHls_ShowDebug) return;
    console.log('PlayHls ' + text);
    PlayHls_DebugLines.push(Math.floor(performance.now() / 100) / 10 + 's ' + text);
    if (PlayHls_DebugLines.length > 18) PlayHls_DebugLines.shift();
    PlayHls_DebugRender();
}

function PlayHls_DebugCount(name) {
    PlayHls_DebugCounters[name] = (PlayHls_DebugCounters[name] || 0) + 1;
}

function PlayHls_DebugRender() {
    var div = document.getElementById('playhls_debug');
    if (!div) {
        div = document.createElement('div');
        div.id = 'playhls_debug';
        div.setAttribute(
            'style',
            'position: fixed; left: 1%; top: 18%; width: 55%; z-index: 99999; background: rgba(0, 0, 0, 0.8); color: #00ff00; font-size: 1.4vh; font-family: monospace; white-space: pre-wrap; word-break: break-all; padding: 0.5%; pointer-events: none;'
        );
        document.body.appendChild(div);
    }

    var video = PlayHls_video,
        status = 'state ' + PlayHls_state;

    if (video) {
        var buffered = '';
        for (var i = 0; i < video.buffered.length; i++) buffered += '[' + video.buffered.start(i).toFixed(1) + '-' + video.buffered.end(i).toFixed(1) + ']';
        status +=
            ' | rs ' + video.readyState + ' ns ' + video.networkState + ' paused ' + video.paused + ' ct ' + video.currentTime.toFixed(2) +
            ' | ' + video.videoWidth + 'x' + video.videoHeight + ' | buf ' + (buffered || 'none') + (video.error ? ' | video error ' + video.error.code : '');
    }

    var counters = '';
    for (var key in PlayHls_DebugCounters) counters += key + ' ' + PlayHls_DebugCounters[key] + '  ';

    div.textContent = 'hls.js debug  ' + status + '\n' + PlayHls_DebugHeader + '\n' + counters + '\n' + PlayHls_DebugLines.join('\n');
}

function PlayHls_DebugStart() {
    if (!PlayHls_ShowDebug) return;
    PlayHls_DebugCounters = {};

    var types = [
        'video/mp4; codecs="avc1.4D401F,mp4a.40.2"',
        'video/mp4; codecs="avc1.4D401F"',
        'audio/mp4; codecs="mp4a.40.2"',
        'video/mp4; codecs="avc1.42E01E"'
    ];
    var support = 'MSE ' + (typeof MediaSource) + (typeof Hls !== 'undefined' ? ' hls.js ' + Hls.version : ' no hls.js'); // jshint ignore:line
    if (typeof MediaSource !== 'undefined') {
        for (var i = 0; i < types.length; i++) support += ' | ' + types[i].split('codecs=')[1] + ' ' + MediaSource.isTypeSupported(types[i]);
    }
    PlayHls_DebugHeader = support + '\nUA ' + navigator.userAgent;

    window.clearInterval(PlayHls_DebugId);
    PlayHls_DebugId = window.setInterval(PlayHls_DebugRender, 1000);
}

function PlayHls_DebugStop() {
    window.clearInterval(PlayHls_DebugId);
    var div = document.getElementById('playhls_debug');
    if (div) div.parentNode.removeChild(div);
}

window.addEventListener('error', function (event) {
    if (PlayHls_ShowDebug && PlayHls_state !== 'NONE') PlayHls_Debug('JS ERROR ' + event.message + ' @' + (event.filename || '').split('/').pop() + ':' + event.lineno);
});

function PlayHls_IsSupported() {
    try {
        return typeof Hls !== 'undefined' && Hls.isSupported(); // jshint ignore:line
    } catch (e) {
        return false;
    }
}

function PlayHls_CallListener(name, value) {
    if (PlayHls_listener && PlayHls_listener[name]) PlayHls_listener[name](value);
}

function PlayHls_GetVideo() {
    if (PlayHls_video) return PlayHls_video;

    var video = document.createElement('video');
    //z-index 1 places the video above the page background and below all play UI (z-index >= 2)
    video.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; z-index: 1; background: #000000; display: none;');
    video.style.objectFit = 'fill';

    video.addEventListener('waiting', function () {
        if (PlayHls_state === 'PLAYING') PlayHls_CallListener('onbufferingstart');
    });
    video.addEventListener('playing', function () {
        PlayHls_CallListener('onbufferingcomplete');
    });
    video.addEventListener('timeupdate', function () {
        if (PlayHls_state === 'PLAYING') PlayHls_CallListener('oncurrentplaytime', Math.floor(video.currentTime * 1000));
    });
    video.addEventListener('ended', function () {
        PlayHls_CallListener('onstreamcompleted');
    });

    var debugEvents = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'seeking', 'seeked', 'pause', 'error', 'emptied'];
    for (var i = 0; i < debugEvents.length; i++) {
        video.addEventListener(debugEvents[i], function (event) {
            PlayHls_Debug('video ' + event.type + (event.type === 'error' && video.error ? ' code ' + video.error.code : ''));
        });
    }

    var scene = document.getElementById('scene2');
    scene.insertBefore(video, scene.firstChild);

    PlayHls_video = video;
    return video;
}

function PlayHls_Destroy() {
    if (PlayHls_hls) {
        try {
            PlayHls_hls.destroy();
        } catch (e) {
            console.log('PlayHls_Destroy ' + e);
        }
        PlayHls_hls = null;
    }

    if (PlayHls_video) {
        PlayHls_video.pause();
        PlayHls_video.removeAttribute('src');
        try {
            PlayHls_video.load();
        } catch (e) {}
        PlayHls_video.style.display = 'none';
    }
}

function PlayHls_CopyObject(value) {
    var result = {};
    for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = value[key];
    }
    return result;
}

//Twitch fMP4 has audio and video in the same track set (muxed), hls.js appends it to a single 'audiovideo' SourceBuffer,
//the MSE of older TVs (Tizen 2.4 / 3.0) fails to decode that (video error 3, MEDIA_ERR_DECODE).
//This intercepts the hls.js events and splits the init segment and the fragments in separated audio and video buffers
//using Fmp4TrackIsolation (lib/Fmp4TrackIsolation.js).
//Ported from LegacyFmp4Buffers.js of https://github.com/numbereleven-a/smarttv-twitch-old-tizen (GPL v3)
function PlayHls_SplitFmp4Buffers(hls) {
    var trigger = hls.trigger,
        tracks = null;

    if (typeof Fmp4TrackIsolation === 'undefined') return; // jshint ignore:line

    //the buffer controller decides which buffers a fragment waits for from its elementaryStreams
    var splitStreamInfo = function (owner) {
        var streams = owner && owner.elementaryStreams;
        if (streams && streams.audiovideo) {
            streams.audio = PlayHls_CopyObject(streams.audiovideo);
            streams.video = PlayHls_CopyObject(streams.audiovideo);
            streams.audiovideo = null;
        }
    };

    /* jshint ignore:start */
    hls.trigger = function (event, data) {
        if (event === Hls.Events.MANIFEST_LOADING) tracks = null;

        if (tracks && event === Hls.Events.FRAG_PARSED) {
            splitStreamInfo(data.frag);
            splitStreamInfo(data.part);
        }

        if (event === Hls.Events.BUFFER_CODECS) {
            tracks = null;
            var combined = data.audiovideo;

            if (combined && combined.initSegment) {
                try {
                    var found = Fmp4TrackIsolation.tracks(combined.initSegment),
                        codecs = (combined.codec || '').split(','),
                        audioCodec,
                        videoCodec,
                        i;

                    for (i = 0; i < codecs.length; i++) {
                        if (codecs[i].indexOf('mp4a') !== -1) audioCodec = codecs[i].trim();
                        if (codecs[i].indexOf('avc') !== -1) videoCodec = codecs[i].trim();
                    }

                    if (
                        found.length === 2 &&
                        audioCodec &&
                        videoCodec &&
                        found[0].type !== found[1].type &&
                        found[0].type !== 'other' &&
                        found[1].type !== 'other'
                    ) {
                        var replacement = {};
                        for (i = 0; i < found.length; i++) {
                            var track = PlayHls_CopyObject(combined),
                                type = found[i].type;

                            track.container = type + '/mp4';
                            track.codec = type === 'audio' ? audioCodec : videoCodec;
                            track.levelCodec = track.codec;
                            track.initSegment = Fmp4TrackIsolation.isolate(combined.initSegment, found[i].id);
                            replacement[type] = track;
                        }

                        tracks = found;
                        PlayHls_Debug('fMP4 split: separate audio ' + audioCodec + ' / video ' + videoCodec + ' buffers');
                        return trigger.call(hls, event, replacement);
                    }
                } catch (e) {
                    tracks = null;
                    PlayHls_Debug('fMP4 split init failed, using a single buffer: ' + e.message);
                }
            }
        }

        if (event === Hls.Events.BUFFER_APPENDING && tracks && data.type === 'audiovideo') {
            splitStreamInfo(data.frag);
            splitStreamInfo(data.part);

            //prepare both before appending any, so a parse failure doesn't append half a fragment
            var jobs = [],
                j;

            try {
                for (j = 0; j < tracks.length; j++) {
                    var job = PlayHls_CopyObject(data);
                    job.type = tracks[j].type;
                    job.data = Fmp4TrackIsolation.isolate(data.data, tracks[j].id);
                    jobs.push(job);
                }
            } catch (e) {
                PlayHls_Debug('fMP4 split fragment failed: ' + e.message);
                return;
            }

            for (j = 0; j < jobs.length; j++) trigger.call(hls, event, jobs[j]);
            return;
        }

        if (tracks && event === Hls.Events.BUFFER_APPENDED) PlayHls_DebugCount('splitAppended');

        return trigger.apply(hls, arguments);
    };
    /* jshint ignore:end */
}

//hls.js fragment loader (config.fLoader) that converts Twitch fMP4 fragments to MPEG-TS (PlayHlsRemux.js) after loading them,
//hls.js detects TS by probing the data and remuxes it with its own TS path, that plays on Tizen 3.0
function PlayHls_FragmentLoader(config) {
    this.loader = new Hls.DefaultConfig.loader(config); // jshint ignore:line
    //hls.js reads the stats object right after creating the loader
    this.stats = this.loader.stats;
    this.context = null;
}

PlayHls_FragmentLoader.prototype.load = function (context, config, callbacks) {
    var frag = context.frag,
        wrapped = PlayHls_CopyObject(callbacks);

    this.context = context;

    wrapped.onSuccess = function (response, stats, loaderContext, networkDetails) {
        //the init segment (EXT-X-MAP) is loaded first and kept in frag.initSegment.data
        if (frag && frag.sn !== 'initSegment' && frag.initSegment && frag.initSegment.data && response.data) {
            try {
                var info = PlayHlsRemux_GetInit(frag.initSegment.data);
                var ts = info && PlayHlsRemux_FragmentToTs(new Uint8Array(response.data), info);
                if (ts) {
                    response.data = ts.buffer;
                    PlayHls_DebugCount('toTs');
                }
            } catch (e) {
                //keep the fMP4 data, PlayHls_SplitFmp4Buffers is the fallback
                PlayHls_Debug('fMP4 to TS failed: ' + e.message);
            }
        }
        callbacks.onSuccess(response, stats, loaderContext, networkDetails);
    };

    this.loader.load(context, config, wrapped);
};

PlayHls_FragmentLoader.prototype.abort = function () {
    this.loader.abort();
};

PlayHls_FragmentLoader.prototype.destroy = function () {
    this.loader.destroy();
};

PlayHls_FragmentLoader.prototype.getCacheAge = function () {
    return this.loader.getCacheAge ? this.loader.getCacheAge() : null;
};

PlayHls_FragmentLoader.prototype.getResponseHeader = function (name) {
    return this.loader.getResponseHeader ? this.loader.getResponseHeader(name) : null;
};

function PlayHls_OnError(event, data) {
    console.log('PlayHls error: ' + data.type + ' ' + data.details + ' fatal ' + data.fatal);
    PlayHls_Debug(
        'ERROR ' + data.type + ' ' + data.details + ' fatal ' + data.fatal +
            (data.reason ? ' reason ' + data.reason : '') + (data.error ? ' err ' + data.error.message : '') +
            (data.response ? ' http ' + data.response.code : '') + (data.mimeType ? ' mime ' + data.mimeType : '')
    );

    if (!data.fatal) return;

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && PlayHls_mediaErrorRecoverCount < 2) { // jshint ignore:line
        PlayHls_mediaErrorRecoverCount++;
        PlayHls_hls.recoverMediaError();
        return;
    }

    var callbacks = PlayHls_prepareCallbacks;
    PlayHls_prepareCallbacks = null;
    PlayHls_Destroy();
    PlayHls_state = 'NONE';

    //before prepare finishes report the error to prepareAsync as AVPlay does
    if (callbacks) {
        if (callbacks.error) callbacks.error(data.details);
    } else PlayHls_CallListener('onerror', 'PLAYER_ERROR_CONNECTION_FAILED');
}

var PlayHls_Player = {
    open: function (url) {
        PlayHls_Destroy();
        PlayHls_url = url;
        PlayHls_startPosition = -1;
        PlayHls_levelDuration = 0;
        PlayHls_mediaErrorRecoverCount = 0;
        PlayHls_state = 'IDLE';
    },
    prepareAsync: function (successCallback, errorCallback) {
        var video = PlayHls_GetVideo();

        PlayHls_prepareCallbacks = { success: successCallback, error: errorCallback };

        PlayHls_hls = new Hls({ // jshint ignore:line
            startPosition: PlayHls_startPosition,
            //older TVs web engines have issues with the hls.js web worker, the fork that fixed fMP4 disables it too
            enableWorker: false,
            //convert fMP4 fragments to MPEG-TS, see PlayHls_FragmentLoader
            fLoader: typeof PlayHlsRemux_FragmentToTs !== 'undefined' ? PlayHls_FragmentLoader : undefined,
            //memory of older TVs is limited
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            backBufferLength: 30
        });

        PlayHls_SplitFmp4Buffers(PlayHls_hls);

        //prepare finishes after the first media playlist is loaded, so getDuration knows the VOD duration
        //as AVPlay does when its prepareAsync success is called
        PlayHls_hls.on(Hls.Events.LEVEL_LOADED, function (event, data) { // jshint ignore:line
            PlayHls_levelDuration = data.details && !data.details.live ? data.details.totalduration : 0;

            var callbacks = PlayHls_prepareCallbacks;
            if (!callbacks) return;

            PlayHls_prepareCallbacks = null;
            PlayHls_state = 'READY';
            if (callbacks.success) callbacks.success();
        });
        PlayHls_hls.on(Hls.Events.ERROR, PlayHls_OnError); // jshint ignore:line

        PlayHls_DebugStart();
        PlayHls_Debug('prepare startPosition ' + PlayHls_startPosition + ' url ' + (PlayHls_url + '').slice(0, 50));
        /* jshint ignore:start */
        PlayHls_hls.on(Hls.Events.MANIFEST_PARSED, function (e, data) {
            PlayHls_Debug('MANIFEST_PARSED levels ' + data.levels.length);
        });
        PlayHls_hls.on(Hls.Events.LEVEL_LOADED, function (e, data) {
            PlayHls_DebugCount('level');
            if (PlayHls_DebugCounters.level === 1)
                PlayHls_Debug('LEVEL_LOADED live ' + data.details.live + ' frags ' + data.details.fragments.length + ' dur ' + data.details.totalduration.toFixed(0));
        });
        PlayHls_hls.on(Hls.Events.FRAG_LOADED, function () {
            PlayHls_DebugCount('fragLoaded');
        });
        PlayHls_hls.on(Hls.Events.BUFFER_CODECS, function (e, data) {
            var codecs = '';
            for (var key in data) codecs += key + ':' + (data[key].container || '') + ' ' + (data[key].codec || '') + ' ';
            PlayHls_Debug('BUFFER_CODECS ' + codecs);
        });
        PlayHls_hls.on(Hls.Events.BUFFER_CREATED, function (e, data) {
            var tracks = '';
            for (var key in data.tracks) tracks += key + ' ' + data.tracks[key].mimeType + '; ';
            PlayHls_Debug('BUFFER_CREATED ' + tracks);
        });
        PlayHls_hls.on(Hls.Events.BUFFER_APPENDED, function () {
            PlayHls_DebugCount('appended');
        });
        PlayHls_hls.on(Hls.Events.FRAG_BUFFERED, function () {
            PlayHls_DebugCount('fragBuffered');
        });
        /* jshint ignore:end */

        video.style.display = '';
        PlayHls_hls.attachMedia(video);
        PlayHls_hls.loadSource(PlayHls_url);
    },
    play: function () {
        PlayHls_state = 'PLAYING';
        var promise = PlayHls_GetVideo().play();
        PlayHls_Debug('play() called, promise ' + !!promise);
        if (promise && promise.catch) {
            promise.catch(function (e) {
                console.log('PlayHls play ' + e);
                PlayHls_Debug('play() rejected ' + e);
            });
        }
    },
    pause: function () {
        PlayHls_state = 'PAUSED';
        PlayHls_GetVideo().pause();
    },
    stop: function () {
        if (PlayHls_video) PlayHls_video.pause();
        if (PlayHls_state !== 'NONE') PlayHls_state = 'IDLE';
    },
    close: function () {
        PlayHls_prepareCallbacks = null;
        PlayHls_Destroy();
        PlayHls_state = 'NONE';
        PlayHls_DebugStop();
    },
    getState: function () {
        return PlayHls_state;
    },
    getCurrentTime: function () {
        return PlayHls_video ? Math.floor(PlayHls_video.currentTime * 1000) : 0;
    },
    getDuration: function () {
        var duration = PlayHls_video ? PlayHls_video.duration : 0;
        //the video duration is only known after the first fragment is buffered, the playlist has it before
        if (!isFinite(duration) || !duration) duration = PlayHls_levelDuration;
        return Math.floor(duration * 1000);
    },
    seekTo: function (ms, successCallback) {
        //the live edge is unknown right after prepare (GET_LIVE_DURATION '0|0'), ignore invalid positions
        if (!(ms >= 0)) {
            if (successCallback) successCallback();
            return;
        }

        if (PlayHls_state === 'IDLE' || !PlayHls_hls) {
            //before prepare, start from this position
            PlayHls_startPosition = ms / 1000;
        } else if (PlayHls_video) {
            PlayHls_video.currentTime = ms / 1000;
        }
        if (successCallback) successCallback();
    },
    getStreamingProperty: function (property) {
        //AVPlay returns 'start|end' in ms, the app uses the end to seek close to the live edge
        if (property === 'GET_LIVE_DURATION') {
            var end = PlayHls_hls && PlayHls_hls.liveSyncPosition ? PlayHls_hls.liveSyncPosition : PlayHls_video ? PlayHls_video.currentTime : 0;
            return '0|' + Math.floor(end * 1000);
        }
        return '';
    },
    setListener: function (listener) {
        PlayHls_listener = listener || {};
    },
    setDisplayRect: function (x, y, width, height) {
        var video = PlayHls_GetVideo();
        //AVPlay uses screen pixels, the page uses % so it works with any viewport size
        video.style.left = (x / screen.width) * 100 + '%';
        video.style.top = (y / screen.height) * 100 + '%';
        video.style.width = (width / screen.width) * 100 + '%';
        video.style.height = (height / screen.height) * 100 + '%';
    },
    setDisplayMethod: function (method) {
        PlayHls_GetVideo().style.objectFit = method === 'PLAYER_DISPLAY_MODE_LETTER_BOX' ? 'contain' : 'fill';
    },
    setBufferingParam: function () {},
    setSilentSubtitle: function () {},
    setStreamingProperty: function () {}
};
