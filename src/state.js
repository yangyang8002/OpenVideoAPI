/* 全局可变状态容器 S（原 server.js 顶层 let 声明的集中存放，语义不变）。 */
'use strict';

const S = {
    store: null,             /* 当前数据存储（启动时装配，可热切换） */
    dbMigrating: false,      /* 迁移锁：迁移期间暂停数据写入 */
    pluginManager: null,     /* 插件管理器 */
    pluginModel: null,       /* 插件动态表模型 */
    apiConfigCache: null,
    apiConfigCacheAt: 0,
    ipSearcher4: null,
    ipSearcher6: null,
    ipGeo: null,
    perfHistory: [],
    lastCpuUsage: process.cpuUsage(),
    lastCpuAt: Date.now(),
    lastReqCount: 0,
    depsCache: null,
    marketCache: null,
    updateCheckCache: null,
    devWatcher: null,
    devWatchTimes: {},
    restarting: false,
};

module.exports = S;
