// Local web server for testing the app in a browser, uses only built-in Node.js modules (Node 18+).
// Usage: node webserver.js [port] [folder]   (defaults: 8765, app)
// Files are sent with caching disabled, so a normal reload always gets the latest code.
//
// Twitch video servers (usher.ttvnw.net, VOD/live CDNs) don't allow requests from other web pages (CORS),
// on the TV that doesn't matter, in a PC browser it blocks playback. So this server also works as a proxy:
//   http://localhost:8765/proxy/<host>/<path>  ->  https://<host>/<path>
// Only Twitch video hosts are allowed, see proxyHosts. The app uses it in browser mode (Main_ProxyUrl in Main.js).
var http = require('http');
var fs = require('fs');
var path = require('path');
var Readable = require('stream').Readable;

var port = parseInt(process.argv[2], 10) || 8765;
var root = path.resolve(__dirname, process.argv[3] || 'app');
var host = '127.0.0.1';

var proxyHosts = /(^|\.)(ttvnw\.net|live-video\.net|cloudfront\.net|twitchcdn\.net|jtvnw\.net)$/i;
//request headers forwarded to Twitch (Client-ID and similar are added by the app to some requests)
var proxyRequestHeaders = ['accept', 'range', 'client-id'];
var proxyResponseHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*'
};

var mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.map': 'application/json; charset=utf-8'
};

function headers(extra) {
    var result = {'Cache-Control': 'no-store'};
    var key;
    for (key in corsHeaders) result[key] = corsHeaders[key];
    for (key in extra) result[key] = extra[key];
    return result;
}

function send(res, status, body) {
    res.writeHead(status, headers({'Content-Type': 'text/plain; charset=utf-8'}));
    res.end(body);
}

function proxy(req, res, target) {
    //target is "<host>/<path>?<query>"
    var slash = target.indexOf('/');
    var targetHost = slash < 0 ? target : target.slice(0, slash);
    if (!proxyHosts.test(targetHost)) return send(res, 403, 'Proxy host not allowed: ' + targetHost);

    var url = 'https://' + target;
    var requestHeaders = {};
    proxyRequestHeaders.forEach(function (name) {
        if (req.headers[name]) requestHeaders[name] = req.headers[name];
    });

    fetch(url, {method: req.method, headers: requestHeaders, redirect: 'follow'})
        .then(function (upstream) {
            var responseHeaders = {};
            proxyResponseHeaders.forEach(function (name) {
                var value = upstream.headers.get(name);
                if (value) responseHeaders[name] = value;
            });
            //fetch already decompressed the body, the original length no longer matches
            if (upstream.headers.get('content-encoding')) delete responseHeaders['content-length'];

            if (upstream.status >= 400) console.log('proxy ' + upstream.status + ' ' + url.split('?')[0]);
            res.writeHead(upstream.status, headers(responseHeaders));

            if (req.method === 'HEAD' || !upstream.body) return res.end();
            Readable.fromWeb(upstream.body)
                .on('error', function () {
                    res.destroy();
                })
                .pipe(res);
        })
        .catch(function (e) {
            console.log('proxy error ' + url.split('?')[0] + ' ' + e.message);
            if (!res.headersSent) send(res, 502, 'Proxy error: ' + e.message);
            else res.destroy();
        });
}

function serveFile(req, res, urlPath) {
    var filePath = path.join(root, urlPath);
    //block requests outside of the served folder (../)
    if (filePath !== root && filePath.indexOf(root + path.sep) !== 0) return send(res, 403, 'Forbidden');

    fs.stat(filePath, function (err, stat) {
        if (!err && stat.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        }
        if (err || !stat || !stat.isFile()) {
            console.log('404 ' + req.url);
            return send(res, 404, 'Not found');
        }

        res.writeHead(
            200,
            headers({
                'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
                'Content-Length': stat.size
            })
        );
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath).pipe(res);
    });
}

var server = http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, headers({}));
        return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    //the proxy keeps the query string as it is, Twitch tokens are already URL encoded
    if (req.url.indexOf('/proxy/') === 0) return proxy(req, res, req.url.slice('/proxy/'.length));

    var urlPath;
    try {
        urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch (e) {
        return send(res, 400, 'Bad request');
    }
    serveFile(req, res, urlPath);
});

server.on('error', function (e) {
    console.error(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use, pass another one: node webserver.js 8766' : e);
    process.exit(1);
});

server.listen(port, host, function () {
    console.log('Serving ' + root);
    console.log('Twitch video proxy at /proxy/<host>/<path>');
    //the VS Code launch config waits for this line to open the browser
    console.log('Server listening on http://localhost:' + port + '/');
});
