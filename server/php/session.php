<?php
/**
 * session.php — badge sync relay for OVH mutualisé (or any plain PHP host).
 *
 * A dumb postbox. The computer invents a session id and puts it in a QR code;
 * the phone scans it and POSTs the badge payload; the computer polls until the
 * payload shows up. Pure HTTP, so it works through every NAT and firewall that
 * WebRTC used to die behind.
 *
 *   POST /api/session?id=ABCD1234   store payload
 *   GET  /api/session?id=ABCD1234   204 while empty, 200 + payload once uploaded
 *
 * Deploy: upload to www/api/session.php alongside the .htaccess in this folder.
 * No build, no dependencies. The Netlify mirror is netlify/functions/session.js.
 */

// Session files live OUTSIDE the web root, so nobody can fetch them directly.
// On OVH mutualisé the web root is ~/www, so this lands in ~/vrooom-sessions.
$DIR      = __DIR__ . '/../../vrooom-sessions';
$TTL      = 15 * 60;
$MAX      = 64 * 1024;

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!is_dir($DIR)) {
    @mkdir($DIR, 0700, true);
}

// Garbage-collect expired sessions on every hit — no cron needed.
foreach (glob($DIR . '/*.json') ?: [] as $stale) {
    if (time() - filemtime($stale) > $TTL) {
        @unlink($stale);
    }
}

$id = strtoupper($_GET['id'] ?? '');
if (!preg_match('/^[A-Z0-9]{8}$/', $id)) {
    http_response_code(400);
    echo '{"error":"bad session id"}';
    exit;
}

$file = $DIR . '/' . $id . '.json';

// — Phone uploads —
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input', false, null, 0, $MAX + 1);

    if (strlen($body) > $MAX) {
        http_response_code(413);
        echo '{"error":"payload too large"}';
        exit;
    }
    if (json_decode($body) === null) {
        http_response_code(400);
        echo '{"error":"not json"}';
        exit;
    }

    // Write to a temp file and rename, so a poll that lands mid-write never
    // reads half a payload — rename is atomic on the same filesystem.
    $tmp = $file . '.' . getmypid() . '.tmp';
    file_put_contents($tmp, $body, LOCK_EX);
    rename($tmp, $file);

    echo '{"ok":true}';
    exit;
}

// — Computer polls —
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!is_file($file) || time() - filemtime($file) > $TTL) {
        http_response_code(204);
        exit;
    }

    // Deliberately NOT deleted on read. If the response were lost in transit a
    // one-shot read would leave the computer polling an empty slot forever —
    // which is the "Waiting for connection…" limbo this rewrite exists to kill.
    // The TTL sweep above is what cleans up instead.
    readfile($file);
    exit;
}

http_response_code(405);
echo '{"error":"method not allowed"}';
