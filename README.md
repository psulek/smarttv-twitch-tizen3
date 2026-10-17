# SmartTV Client for Twitch (Tizen 3.0 fork)

A fork of [fgl27/smarttv-twitch](https://github.com/fgl27/smarttv-twitch), the Twitch web app for Samsung Tizen TVs, made to keep it working on an older **Samsung TV with Tizen 3.0** (2017 models, tested on a UE65MU8002).

The main fix: Twitch channels that use **Enhanced Broadcasting / custom transcode** stream video in a format Tizen 3.0 can't play, so they showed a black screen or an endless loading spinner. This fork plays them again, see [Enhanced Broadcasting / custom transcode streams on Tizen 3.0](#enhanced-broadcasting--custom-transcode-streams-on-tizen-30).

The app is built from this repository and installed on the TV with one command (`npm run deploy`), without Tizen Studio's IDE.

-   [What this fork changes](#what-this-fork-changes)
-   [Enhanced Broadcasting / custom transcode streams on Tizen 3.0](#enhanced-broadcasting--custom-transcode-streams-on-tizen-30)
-   [Requirements](#requirements)
-   [One-time setup](#one-time-setup)
-   [Deploy to the TV from the command line](#deploy-to-the-tv-from-the-command-line)
-   [Test in a PC browser](#test-in-a-pc-browser)
-   [Adding a Twitch user and key](#adding-a-twitch-user-and-key)
-   [Controls](#controls)
-   [Building the minified release package](#building-the-minified-release-package)
-   [Troubleshooting](#troubleshooting)
-   [Credits and licenses](#credits-and-licenses)

## What this fork changes

**Playback**

-   Streams and VODs in fMP4 format (Enhanced Broadcasting / custom transcode) play with [hls.js](https://github.com/video-dev/hls.js), and each segment is converted to MPEG-TS on the fly. Other streams keep using the TV's native player.
-   Quality is capped at **1080p**. Higher qualities (1440p) only showed a black screen on these TVs.
-   The quality marked "source" is the real highest quality. Twitch lists qualities in random order, and the app used to mark whichever came first.
-   VODs played with hls.js show their full length and support seeking.

**Login**

-   Adding a key uses the Twitch **device code login**: the TV shows a code, you enter it on [twitch.tv/activate](https://www.twitch.tv/activate) on a phone or PC, and the TV continues by itself. No more tiny.cc link, external login page or typing a long key with the remote.

**Removed or fixed**

-   Removed the TTV LOL / Purple Adblock proxy options. Both services are gone, and the proxy was enabled by default, which delayed every live stream start.
-   Removed the donation block from About and the app's calls to fgl27's github.io (stylesheet, preconnect, login page). The icon font, app code and the short startup video the native player needs are bundled in the package; the online copy of that video is only a fallback.
-   The follow check is skipped for users without a key (it only produced endless 401 errors), and one malformed chat message no longer breaks loading the recent chat.
-   Screens that rely on removed Twitch APIs (user VODs, live search) show a message instead of failing.

**For development**

-   About shows when and on which PC the installed build was made.
-   The build installs as a separate app, **"SmartTV Client for Twitch (dev)"** with a blue icon (app id `flbtxFhd64.SmartTV`), so it can sit next to the original fgl27 app (`UHdbzowRXA.SmartTV`).
-   [`release/deploy_tv.ps1`](release/deploy_tv.ps1) builds, signs, installs and launches the app from the command line.
-   [`webserver.js`](webserver.js) runs the app in a PC browser, including live streams and VODs.

## Enhanced Broadcasting / custom transcode streams on Tizen 3.0

### The problem

With Enhanced Broadcasting, the streamer's PC encodes all qualities itself (shown by Twitch as a "Custom" transcode). Twitch delivers those streams as **fragmented MP4 (fMP4 / CMAF)** HLS segments: the playlists contain `#EXT-X-MAP` and the segments are `.mp4` instead of the classic `.ts` (MPEG-TS) segments. No Twitch API option returns `.ts` for these channels.

On a Tizen 3.0 TV:

| Player | Result |
| --- | --- |
| Native AVPlay (what the app used) | Black screen or endless loading spinner |
| hls.js + the TV's browser engine (MSE), fMP4 passed through | `MEDIA_ERR_DECODE` (video error 3) right after the first frame metadata |
| hls.js with audio and video in separate buffers (the approach of [numbereleven-a/smarttv-twitch-old-tizen](https://github.com/numbereleven-a/smarttv-twitch-old-tizen), reported to work on Tizen 2.4) | Still `MEDIA_ERR_DECODE` on Tizen 3.0 |
| **hls.js with each fMP4 segment converted to MPEG-TS** | **Works**, live and VOD |

The TV can play the same video and audio when it arrives as MPEG-TS: hls.js then uses its own TS demuxer and builds MP4 data the TV's engine accepts. The likely reason is the timestamp layout of Twitch's fMP4 (very large 64-bit timestamps, chunked CMAF fragments), not the codecs themselves.

### How the fix works

1. Before playing, the app loads the stream's media playlist (`Play_CheckPlayerForPlaylist` in [`Play.js`](app/specific/Play.js)). If it contains `#EXT-X-MAP`, the stream is fMP4 and the app switches to the hls.js player; otherwise it keeps the native AVPlay player.
2. [`PlayHls.js`](app/specific/PlayHls.js) is a player with the same interface as Samsung's AVPlay (open, prepare, play, seek, duration, …), built on a `<video>` element and hls.js, so the rest of the app doesn't need to know which player runs.
3. Its fragment loader passes every downloaded fMP4 segment to [`PlayHlsRemux.js`](app/specific/PlayHlsRemux.js), which converts it to MPEG-TS: it reads the init segment (H.264 SPS/PPS, AAC configuration) and each fragment's samples, then writes TS packets with PES headers and PTS/DTS timestamps, adds SPS/PPS on keyframes and wraps the audio in ADTS frames.
4. hls.js sees MPEG-TS, demuxes it with its TS demuxer and plays it.

The quality line in the player info shows **`| hls.js`** when a stream plays this way. Clips are always MP4 files and keep using the native player.

On a retail TV there are no logs. For diagnostics, set `var PlayHls_ShowDebug = true;` in [`PlayHls.js`](app/specific/PlayHls.js) and redeploy: a green panel on screen shows what the player is doing.

### Tested on

| | |
| --- | --- |
| TV | Samsung **UE65MU8002** (65" 4K UHD, MU8000 series, 2017) |
| System | **Tizen 3.0**, browser engine `AppleWebKit/538.1` |
| Stream tested | Enhanced Broadcasting channel [oatley](https://www.twitch.tv/oatley) (fMP4, played at 1080p60) |
| Works | Live streams, VODs with full length and seeking, quality changes |
| Before the fix | Black screen or endless loading spinner on the same channels |
| Date | October 2026 |

Channels without Enhanced Broadcasting (MPEG-TS) were checked on the same TV and still play with the native player. Other Tizen 3.0 TVs (2017 Samsung models) very likely behave the same, but only this one was tested.

## Requirements

-   Windows PC (the deploy script is PowerShell; Windows PowerShell 5.1 or PowerShell 7)
-   [Node.js](https://nodejs.org/) 18 or newer
-   [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) with the TV extensions, installed in `C:\tizen-studio` (another folder works with `-TizenStudio`)
-   A Samsung account and a Tizen certificate profile, see below
-   The TV and the PC on the same network

## One-time setup

### 1. Install Tizen Studio

1. Download and install **Tizen Studio with IDE installer** from the [Samsung developer site](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html).
2. Open **Package Manager** and install:
    - **Main SDK**: Tizen SDK tools
    - **Extension SDK**: under **TV Extensions-x.x**, **Web app. Development**, the **Samsung Certificate Extension** and, under TV Extension Tools, **Web app. Tools**

If the TV Extensions are missing in Package Manager, see [fgl27/smarttv-twitch#157](https://github.com/fgl27/smarttv-twitch/issues/157#issuecomment-842215657).

### 2. Create a certificate profile

In Tizen Studio: **Tools > Certificate Manager > + > Tizen**, give the profile a name, create a new author certificate (name and password), keep the default distributor and click **Finish**. Make sure the profile has the check mark (active).

Remember the profile name, the deploy script needs it (`CERT_PROFILE`). If creating the author certificate hangs, use the workaround in fgl27's [certificate instructions](https://github.com/fgl27/smarttv-twitch#generate-a-certificate).

### 3. Enable developer mode on the TV

1. Find your PC's IP address: run `ipconfig` and use the IPv4 address of the adapter connected to the TV's network (not a VirtualBox/VPN adapter).
2. On the TV, open **Apps** and press **1 2 3 4 5** on the remote.
3. Turn **Developer mode** on, enter the PC's IP as **Host PC IP** and confirm.
4. Restart the TV (hold the power button, or unplug it).

The TV's own IP is in **Settings > General > Network > Network Status > IP Settings**.

### 4. Clone the repository

```
git clone https://github.com/psulek/smarttv-twitch-tizen3.git
cd smarttv-twitch-tizen3
```

`node_modules` aren't needed to deploy; the scripts only use Node's built-in modules.

## Deploy to the TV from the command line

### Settings: `.env`

Copy [`.env.example`](.env.example) to `.env` in the repository root and fill it in (`.env` is git-ignored):

```
TV_IP=192.168.1.50
CERT_PROFILE=MyProfile
```

Values that are missing or empty are asked for when the script runs. For the certificate profile, pressing Enter uses the active Tizen Studio profile.

### Deploy

```
npm run deploy
```

or, with parameters:

```
powershell -ExecutionPolicy Bypass -File release/deploy_tv.ps1 -Ip 192.168.1.50 -NoRun
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `-Ip` | `.env` `TV_IP`, else asked | TV IP address |
| `-TvPort` | `26101` | TV developer port |
| `-CertProfile` | `.env` `CERT_PROFILE`, else asked | Tizen Studio certificate profile used to sign |
| `-TizenStudio` | `C:\tizen-studio` | Tizen Studio folder |
| `-NoRun` | off | Install only, don't launch the app |
| `-TestMode` | off | Keep test mode: red "TEST ONLY" warning, extra logs |

Parameters win over `.env`. Unknown parameter names stop the script with an error.

### What the script does

1. Writes `app/build_info.js` (PC name, user, date, shown in About; git-ignored).
2. Connects to the TV with `sdb`.
3. Builds the app from `app/` into `app/.buildResult` and switches the build copy to release mode (`Main_isReleased = true`). The source stays in test mode for browser testing.
4. Packages and signs the `.wgt` with your certificate profile.
5. Installs it on the TV and launches it.

The app runs from the files in the package; it doesn't download code at startup. To update, pull the changes and deploy again.

## Test in a PC browser

```
npm run serve
```

Then open [http://localhost:8765](http://localhost:8765). In VS Code, **Run and Debug** has two entries that start the server and open the browser, one of them with Chrome debugging (breakpoints in `app/`).

[`webserver.js`](webserver.js) serves `app/` with caching disabled and also works as a proxy for Twitch's video servers, which block requests from other web pages (CORS). Live streams and VODs play in the browser with the same hls.js player and fMP4→TS conversion as on the TV; clips don't play in the browser. Other servers (for example `python -m http.server`) show the app but can't play video.

Keyboard in browser mode:

| Key | TV remote |
| --- | --- |
| Arrows, Enter | D-pad, OK (Enter also confirms text fields) |
| `1` | Back |
| `A` `B` `C` `D` | Red, green, yellow, blue |
| Page Up / Page Down | Channel up / down |

`1` and `q` also leave text fields, so they can't be typed into a username in the browser.

## Adding a Twitch user and key

1. **Add user**: type your Twitch username. This only reads your public profile.
2. **Add authentication key** (Users screen, select the user): the TV shows a code, for example `XMQWCVBR`.
3. On a phone or PC open [twitch.tv/activate](https://www.twitch.tv/activate), log in to Twitch, enter the code and click **Authorize**.
4. Within a few seconds the TV shows "Key added OK". A code is valid for 30 minutes; if it expires, press Enter for a new one.

The key gives the app these Twitch permissions ([scopes](https://dev.twitch.tv/docs/authentication/scopes)):

| Permission | Used for |
| --- | --- |
| `user:read:follows` | Your followed channels and live streams |
| `user:read:subscriptions` | Checking whether you're subscribed to a channel (sub-only chat and VODs warnings, sub emotes) |
| `chat:edit` | Sending chat messages as you |
| `chat:read` | Reading chat as you |

## Controls

![control](https://fgl27.github.io/smarttv-twitch/screenshot/controler.png)

The app is tested with the remotes above; any Samsung remote with the same keys works. **INFO** has the same function as **GUIDE**.

To open the on-screen controls from any screen, press the red **A** key (on a smart remote: the color button, then up for red) and choose Controls. While a stream plays, the yellow **C** key opens them directly.

![Main](https://fgl27.github.io/smarttv-twitch/screenshot/controls.png)

## Building the minified release package

[`release/release_maker.sh`](release/release_maker.sh) (Linux, needs `uglify-js`, `jshint` and `crass` from npm) checks the code with JSHint, joins and minifies it into one `master.js` and creates a release zip that can be imported into Tizen Studio. The command-line deploy above doesn't need it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `TV ... is not connected` | The TV must be on, in developer mode, and its **Host PC IP** must be this PC's IP on the same network. Check `TV_IP`. Restart the TV after changing developer mode. |
| Tizen Studio scan finds the TV but can't connect | Same as above: wrong Host PC IP is the usual cause (e.g. the PC's Wi-Fi or VirtualBox address instead of the wired one). |
| Changes don't show on the TV | Open the **"(dev)"** app with the blue icon, not the original app. About shows the build date. |
| `tizen package` fails | Check the certificate profile name, or leave `CERT_PROFILE` empty to use the active profile. |
| A stream shows a black screen | Check whether the quality line shows `\| hls.js`. If it does, turn on `PlayHls_ShowDebug` (see above). If not, the stream isn't fMP4 and the native player had a problem. |

## Credits and licenses

-   [fgl27/smarttv-twitch](https://github.com/fgl27/smarttv-twitch) by Felipe Leon: the original app this fork is based on (itself started from [CazuzaCzz](https://github.com/CazuzaCzz/SmartTwitchTV/commits/tizen) and [nikitakatchik](https://github.com/nikitakatchik/SmartTwitchTV)). fgl27 also maintains the Android TV version, [SmartTwitchTV](https://github.com/fgl27/SmartTwitchTV).
-   [numbereleven-a/smarttv-twitch-old-tizen](https://github.com/numbereleven-a/smarttv-twitch-old-tizen): the audio/video track isolation approach and `app/lib/Fmp4TrackIsolation.js` (GPL-3.0).
-   [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0, `app/lib/hls.js-LICENSE`).
-   Also used: [irc-message](https://github.com/sigkell/irc-message), [punycode](https://github.com/bestiejs/punycode.js), [Twemoji](https://github.com/twitter/twemoji), [Fontastic](http://app.fontastic.me), [Samsung Product API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references.html), [Twitch API](https://dev.twitch.tv/docs/). Release build tools: [UglifyJS](https://github.com/mishoo/UglifyJS), [JSHint](https://github.com/jshint/jshint), [crass](https://github.com/mattbasta/crass).

This app has no affiliation with Twitch or Samsung. Licensed under the [GNU General Public License v3.0](LICENSE).
