/* 数据库连接配置构建 / 校验 / 脱敏（六后端）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {

    /* ── 原 server.js L2076-2076 ── */
    // ==================== 数据库管理 ====================

    /* ── 原 server.js L2078-2078 ── */
    const DB_TYPES = ['json', 'sqlite', 'mysql', 'mariadb', 'postgres', 'mongodb'];

    /* ── 原 server.js L2079-2079 ── */
    /* 数据浏览白名单（表名仅允许内部已知集合，防注入/越权读取） */

    /* ── 原 server.js L2080-2080 ── */
    const DB_BROWSE_TABLES = ['danmu', 'videos', 'banned_words', 'accounts', 'security', 'login_logs', 'login_fails', 'subtitles', 'kv'];

    /* ── 原 server.js L2082-2082 ── */
    /* 错误消息脱敏：截断并去除换行，避免泄露内部细节 */

    /* ── 原 server.js L2083-2085 ── */
    function safeErrMsg(e) {
        return String((e && e.message) || e || '未知错误').replace(/[\r\n]+/g, ' ').slice(0, 150);
    }

    /* ── 原 server.js L2087-2087 ── */
    /* 数据库主机名校验：仅允许域名 / IPv4 / IPv6 / 主机名，防止 URI 选项注入与异常字符 */

    /* ── 原 server.js L2088-2090 ── */
    function isValidDbHost(host) {
        return typeof host === 'string' && host.length <= 255 && /^[a-zA-Z0-9.\-:\][%]+$/.test(host) && !host.includes('..');
    }

    /* ── 原 server.js L2092-2095 ── */
    function maskSecret(o) {
        if (!o) return null;
        return { host: o.host, port: o.port, user: o.user, database: o.database, password: o.password ? '******' : '' };
    }

    /* ── 原 server.js L2203-2203 ── */
    /* 校验构建出的连接配置中的主机名，非法返回错误消息（null 表示合法） */

    /* ── 原 server.js L2204-2208 ── */
    function dbHostError(cfg, type) {
        const c = (type === 'mongodb') ? cfg.mongodb : (type === 'postgres' ? cfg.postgres : (type === 'mysql' || type === 'mariadb' ? cfg.mysql : null));
        if (c && c.host && !isValidDbHost(c.host)) return '非法的主机名（仅允许域名/IP/主机名）';
        return null;
    }

    /* ── 原 server.js L2672-2672 ── */
    /* 构建某存储类型的连接配置（未填字段继承现有配置） */

    /* ── 原 server.js L2673-2703 ── */
    function buildDbCfg(type, sqlite, mysql, postgres, mongodb, old) {
        const cfg = { sqlite: {}, mysql: {}, postgres: {}, mongodb: {} };
        if (type === 'sqlite') {
            cfg.sqlite = { file: sqlite.file || (old.sqlite && old.sqlite.file) || 'data/app.db' };
        } else if (type === 'mysql' || type === 'mariadb') {
            cfg.mysql = {
                host: mysql.host || (old.mysql && old.mysql.host) || '127.0.0.1',
                port: parseInt(mysql.port) || (old.mysql && old.mysql.port) || 3306,
                user: mysql.user || (old.mysql && old.mysql.user) || 'root',
                password: (mysql.password !== undefined && mysql.password !== '') ? mysql.password : ((old.mysql && old.mysql.password) || ''),
                database: mysql.database || (old.mysql && old.mysql.database) || ''
            };
        } else if (type === 'postgres') {
            cfg.postgres = {
                host: postgres.host || (old.postgres && old.postgres.host) || '127.0.0.1',
                port: parseInt(postgres.port) || (old.postgres && old.postgres.port) || 5432,
                user: postgres.user || (old.postgres && old.postgres.user) || 'postgres',
                password: (postgres.password !== undefined && postgres.password !== '') ? postgres.password : ((old.postgres && old.postgres.password) || ''),
                database: postgres.database || (old.postgres && old.postgres.database) || ''
            };
        } else if (type === 'mongodb') {
            cfg.mongodb = {
                host: mongodb.host || (old.mongodb && old.mongodb.host) || '127.0.0.1',
                port: parseInt(mongodb.port) || (old.mongodb && old.mongodb.port) || 27017,
                user: mongodb.user || (old.mongodb && old.mongodb.user) || '',
                password: (mongodb.password !== undefined && mongodb.password !== '') ? mongodb.password : ((old.mongodb && old.mongodb.password) || ''),
                database: mongodb.database || (old.mongodb && old.mongodb.database) || 'openvideo'
            };
        }
        return cfg;
    }

        Object.assign(ctx, { DB_TYPES, DB_TYPES, DB_BROWSE_TABLES, DB_BROWSE_TABLES, safeErrMsg, safeErrMsg, isValidDbHost, isValidDbHost, maskSecret, maskSecret, dbHostError, dbHostError, buildDbCfg, buildDbCfg });
    },
};
