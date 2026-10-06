
    /* ===== 前端扩展 API（插件脚本通过它注册能力） ===== */
    window.OpenVideoPlayer = {
        replacement: null,       /* 插件播放器替换：{ name, init(ctx) } */
        _readyHooks: [],
        _listeners: {},
        ctx: null,
        replace: function (impl) { this.replacement = impl; },
        onReady: function (fn) { this._readyHooks.push(fn); },
        on: function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
        _fire: function (ev, data) { (this._listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) {} }); },
        _fireReady: function () {
            var self = this;
            this._readyHooks.forEach(function (fn) { try { fn(self.ctx); } catch (e) { console.error('[插件] ready 钩子异常', e); } });
        }
    };
    