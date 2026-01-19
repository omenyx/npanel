"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSafeExecEnv = buildSafeExecEnv;
function buildSafeExecEnv(extra) {
    const allowed = new Set([
        'LANG',
        'LC_ALL',
        'LC_CTYPE',
        'LC_COLLATE',
        'LC_MESSAGES',
        'TZ',
        'HOME',
        'SHELL',
        'LOGNAME',
        'USER',
    ]);
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value == null) {
            continue;
        }
        if (key.startsWith('NPANEL_')) {
            env[key] = value;
            continue;
        }
        if (allowed.has(key)) {
            env[key] = value;
        }
    }
    env.PATH =
        process.env.NPANEL_FIXED_PATH ||
            '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    if (extra) {
        for (const [key, value] of Object.entries(extra)) {
            env[key] = value;
        }
    }
    return env;
}
//# sourceMappingURL=exec-env.js.map