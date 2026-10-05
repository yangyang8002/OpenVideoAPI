/* 敏感词库自动更新（内置词库 git 拉取 + 订阅）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

module.exports = {
    define(ctx) {
        const { readConfig, readData, BANNED_WORDS_FILE, ROOT_DIR, S } = ctx;

    /* ── 原 server.js L3863-3863 ── */
    // ==================== 敏感词库自动更新 ====================

    /* ── 原 server.js L3865-3910 ── */
    async function refreshBannedWords() {
        const config = readConfig();
        const words = new Set(readData(BANNED_WORDS_FILE));

        // 1. GitHub Sensitive-lexicon (built-in)
        try {
            const GITHUB_REPO = 'https://github.com/konsheng/Sensitive-lexicon.git';
            const TEMP_DIR = path.join(ROOT_DIR, 'temp_lexicon_update');
            if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
            await new Promise((resolve, reject) => {
                exec(`git clone --depth 1 "${GITHUB_REPO}" "${TEMP_DIR}"`, (error) => {
                    if (error) return reject(error);
                    try {
                        const VOCAB_DIR = path.join(TEMP_DIR, 'Vocabulary');
                        if (fs.existsSync(VOCAB_DIR)) {
                            const files = fs.readdirSync(VOCAB_DIR);
                            for (const file of files) {
                                if (!file.endsWith('.txt')) continue;
                                const content = fs.readFileSync(path.join(VOCAB_DIR, file), 'utf-8');
                                content.split('\n').forEach(line => { const w = line.trim(); if (w) words.add(w); });
                            }
                        }
                        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
                        resolve();
                    } catch (err) { reject(err); }
                });
            });
            console.log('[敏感词库] 内置词库已更新');
        } catch (e) { console.error('[敏感词库] 内置词库拉取失败:', e.message); }

        // 2. Custom subscriptions
        const subs = (config.bannedWords && config.bannedWords.subscriptions) || [];
        for (const url of subs) {
            try {
                const resp = await fetch(url);
                const text = await resp.text();
                text.split(/\r?\n/).forEach(line => { const w = line.trim(); if (w && w.length < 50) words.add(w); });
                console.log('[敏感词库] 自定义订阅已拉取:', url);
            } catch (e) { console.error('[敏感词库] 自定义订阅拉取失败:', url, e.message); }
        }

        const wordList = Array.from(words).sort();
        await S.store.bannedReplaceAll(wordList);
        console.log(`[敏感词库] 更新完成，共 ${wordList.length} 个词`);
        return wordList.length;
    }

    /* ── 原 server.js L3912-3921 ── */
    const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;function scheduleUpdate() {
        setInterval(async () => {
            try {
                await refreshBannedWords();
            } catch (err) {
                console.error('[敏感词库] 定时更新失败:', err.message);
            }
        }, UPDATE_INTERVAL);
        console.log('[敏感词库] 已设置定时更新，每24小时自动更新一次');
    }

        Object.assign(ctx, { refreshBannedWords, refreshBannedWords, UPDATE_INTERVAL, scheduleUpdate, UPDATE_INTERVAL });
    },
};
