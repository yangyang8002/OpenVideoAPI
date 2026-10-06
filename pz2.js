
(function(){
    I18N.init();
    var t=I18N.t;
    var art=null, vid='', dmEngine=null;
    var danmakuVisible=true, danmakuOpacity=parseFloat(localStorage.getItem('ap_dm_opacity'))||1, danmakuSpeed=parseFloat(localStorage.getItem('ap_dm_speed'))||7, danmakuMask=parseInt(localStorage.getItem('ap_dm_mask')||'0')||0;
    var subtitleVisible=true, subtitleSize=parseInt(localStorage.getItem('ap_sub_fs'))||20, subtitleBottom=parseInt(localStorage.getItem('ap_sub_bottom'))||15;
    var subtitleList=[], currentSub=-1;
    var danmakuFont=parseInt(localStorage.getItem('ap_dm_font'))||20, danmakuArea=parseInt(localStorage.getItem('ap_dm_area'))||100, danmakuProtect=localStorage.getItem('ap_dm_protect')==='1';
    var dmKeywords=[], dmRegexes=[], dmTypes={0:false,1:false,2:false};
    try{var _kw=JSON.parse(localStorage.getItem('ap_dm_kw'));if(_kw&&_kw.length)dmKeywords=_kw}catch(e){}
    try{var _re=JSON.parse(localStorage.getItem('ap_dm_re'));if(_re&&_re.length)dmRegexes=_re}catch(e){}
    try{var _ty=JSON.parse(localStorage.getItem('ap_dm_types'));if(_ty)dmTypes=_ty}catch(e){}
    var currentTheme=localStorage.getItem('ap_theme')||'bili';
    var _overflowSystem=null;
    /* iframe 嵌入时开启贴合模式（无黑边） */
    var isEmbed=window.self!==window.top;
    if(isEmbed)document.body.classList.add('embed-mode');
    function fitPlayer(){
        var app=document.getElementById('app');
        var wrap=document.getElementById('player-wrapper');
        if(!app||!wrap||!art||!art.video)return;
        var v=art.video;
        if(!v.videoWidth||!v.videoHeight)return;
        var aw=app.clientWidth||window.innerWidth, ah=app.clientHeight||window.innerHeight;
        var aspect=v.videoWidth/v.videoHeight;
        var w=aw, h=Math.round(w/aspect);
        if(h>ah){h=ah;w=Math.round(h*aspect)}
        wrap.style.width=Math.max(1,w)+'px';
        wrap.style.height=Math.max(1,h)+'px';
        try{if(art&&art.resize)art.resize()}catch(e){}
    }

    function qs(n){return new URLSearchParams(location.search).get(n)}
    function showToast(m,e){
        var t=document.getElementById('toast');t.textContent=m;t.className=e?'toast show err':'toast show';
        if(e)t.style.background='rgba(255,77,106,.2)';clearTimeout(t._timer);
        t._timer=setTimeout(function(){t.classList.remove('show');t.style.background=''},2500);
    }
    function showError(m){
        document.getElementById('errorText').textContent=m;document.getElementById('welcomeCard').classList.add('hidden');
        document.getElementById('errorCard').classList.remove('hidden');document.getElementById('overlay').classList.remove('hidden');
        document.getElementById('overlay').classList.add('active');
    }
    function hideOverlay(){document.getElementById('overlay').classList.add('hidden')}
    function loadFromInput(retry){
        var input=retry?document.getElementById('urlInputRetry'):document.getElementById('urlInput');
        var url=input.value.trim();if(!url){showToast(t('请输入视频地址'),true);return}bootPlayer(url);
    }
    function getVideoId(url){
        var v=url;try{var u=new URL(url);v=u.pathname+u.search}catch(e){}
        var hash=0;for(var i=0;i<v.length;i++){hash=((hash<<5)-hash)+v.charCodeAt(i);hash|=0}
        return Math.abs(hash).toString(36);
    }
    function getVideoType(url){
        var l=url.toLowerCase();if(l.includes('.m3u8')||l.includes('m3u8'))return'hls';
        if(l.includes('.flv')||l.includes('flv'))return'flv';return'normal';
    }
    function setTheme(name){
        currentTheme=name;document.documentElement.dataset.theme=name;localStorage.setItem('ap_theme',name);
        var accent=getComputedStyle(document.documentElement).getPropertyValue('--bili-pink').trim()||'#FB7299';
        if(art)art.theme=accent;
    }
    function applyDanmakuMask(v){
        danmakuMask=v;localStorage.setItem('ap_dm_mask',String(v));
        if(dmEngine)dmEngine.setMargin(v);
    }

    /* ===== Icons ===== */
    function lucide(paths,opts){
        var o=opts||{};return'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="'+(o.size||18)+'" height="'+(o.size||18)+'"'+(o.filled?' class="filled"':'')+'>'+paths+'</svg>';
    }
    var ICONS={
        camera:function(){return lucide('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>')},
        comment:function(){return lucide('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')},
        send:function(){return lucide('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',{filled:true})},
        more:function(){return lucide('<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>')},
        gear:function(){return lucide('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>')},
        danmu:function(){return lucide('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')},
        danmuOff:function(){return lucide('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="3" y1="3" x2="21" y2="21"/>')},
        chevron:function(){return lucide('<polyline points="9 18 15 12 9 6"/>')},
        back:function(){return lucide('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>')},
        plus:function(){return lucide('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')},
        close:function(){return lucide('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')},
        link:function(){return lucide('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>')},
        code:function(){return lucide('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>')}
    };

    /* ===== Danmaku Engine (canvas) ===== */
    function DanmakuEngine(canvas, artInstance){
        var self=this;
        this.canvas=canvas;
        this.ctx=canvas.getContext('2d');
        this.art=artInstance;
        this.data=[];           // all danmaku data [{text,color,mode,time}]
        this.cursor=0;
        this.active=[];         // currently rendering danmaku
        this.pending=[];        // queued danmaku waiting for emission
        this.maxFixed=8;        // max concurrent top/bottom danmaku
        this.fixedRows=5;       // row slots for top/bottom danmaku
        this.trackGap=60;       // min px gap between same-track danmaku
        this.density=parseFloat(localStorage.getItem('ap_dm_density'))||100;
        this.maxPerSecond=250;  // max danmaku emitted per second (server configurable)
        this._emitTimes=[];     // sliding window of emission timestamps
        this.speedJitter=10;    // per-danmaku random speed deviation +-percent (server configurable)
        this.fixedStack=parseFloat(localStorage.getItem('ap_dm_stack'))||100; // top/bottom stacking depth, 100% = to the center of the video
        this.tracks=[];         // track end positions for anti-overlap (mode 0)
        this.topSlots=[];       // top danmaku row slot release times
        this.bottomSlots=[];    // bottom danmaku row slot release times
        for(var rs=0;rs<this.fixedRows;rs++){this.topSlots.push(0);this.bottomSlots.push(0);}
        this.visible=true;
        this.opacity=1;
        this.speed=7;           // seconds to cross screen
        this.margin=0;          // bottom margin percent
        this.areaPct=100;        // 滚动弹幕显示区域（占画面高度百分比 25/50/75/100）
        this.protect=false;      // 字幕防挡：跳过与字幕区域重叠的弹幕渲染
        this.keywords=[];        // 屏蔽关键词
        this.regexList=[];       // 屏蔽正则（已编译）
        this.blockedTypes={};    // 屏蔽类型 {0:滚动,1:顶部,2:底部}
        this.baseFontSize=Math.max(16,Math.min(22,parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dm-font'))||20));
        this.fontSize=this.baseFontSize;
        this.fontFamily="'MiSans','Microsoft YaHei','PingFang SC',sans-serif";
        this.animId=null;
        this.lastTime=0;
        this.running=false;
        this.vid=null;          // server video id, used for seek-time refresh
        this._lastRefresh=0;    // throttle timestamp for seek-time refresh
        this.resize();
        this._bindEvents();
    }
    DanmakuEngine.prototype.resize=function(){
        var rect=this.canvas.getBoundingClientRect();
        if(!rect.width||!rect.height)return;
        var dpr=window.devicePixelRatio||1;
        // Canvas display size is governed by CSS (width/height 100% inside the
        // player), so it follows fullscreen automatically. Only sync the pixel
        // buffer with the actual rendered size here.
        var bw=Math.round(rect.width*dpr), bh=Math.round(rect.height*dpr);
        if(this.canvas.width!==bw||this.canvas.height!==bh){
            this.canvas.width=bw;
            this.canvas.height=bh;
        }
        this.ctx.setTransform(dpr,0,0,dpr,0,0);
        this.w=rect.width;
        this.h=rect.height;
        // Scale the danmaku font with the player width, down to 50% of the base
        // (base is fully sized at 1000px or wider)
        var fScale=Math.max(0.5,Math.min(1,this.w/1000));
        this.fontSize=Math.round(this.baseFontSize*fScale);
        // Actual video picture area within the canvas.
        // The <video> element itself stretches over the whole player, so use
        // the intrinsic video dimensions (videoWidth/videoHeight) + object-fit
        // scale to find the real picture bounds (handles letterboxing).
        var vid=this.art.video;
        var ivw=vid.videoWidth, ivh=vid.videoHeight;
        if(ivw&&ivh){
            var scale=Math.min(this.w/ivw,this.h/ivh);
            var dw=Math.round(ivw*scale), dh=Math.round(ivh*scale);
            this.vx=Math.round((this.w-dw)/2);
            this.vy=Math.round((this.h-dh)/2);
            this.vw=dw;
            this.vh=dh;
        }else{
            this.vx=0;this.vy=0;this.vw=this.w;this.vh=this.h;
        }
        this.trackH=this.fontSize+8;
        // Top/bottom stacking depth: fixedStack% of half the video height
        // (100% = rows extend down to the vertical center of the picture)
        var stackDepth=Math.max(this.trackH,Math.round(this.vh*(this.fixedStack/100)*0.5));
        this.topRows=Math.max(1,Math.floor(stackDepth/this.trackH));
        this.bottomRows=this.topRows;
        this.topSlots=[];this.bottomSlots=[];
        for(var rs=0;rs<this.topRows;rs++){this.topSlots.push(0);this.bottomSlots.push(0);}
        // Scroll danmaku share the full video area with top danmaku (they may
        // overlap). Only the bottom margin (mask) reserves space at the bottom.
        var scrollAreaH=this.vh*Math.max(10,Math.min(100,this.areaPct))/100-this.margin*this.vh/100;
        this.trackCount=Math.max(1,Math.floor(scrollAreaH/this.trackH));
        this.scrollY0=this.vy;
        this.tracks=[];for(var i=0;i<this.trackCount;i++)this.tracks.push(0);
    };
    DanmakuEngine.prototype._bindEvents=function(){
        var self=this;
        this.art.on('video:play',function(){self.start()});
        this.art.on('video:playing',function(){self.start()});
        this.art.on('video:pause',function(){self.stop()});
        this.art.on('video:seeked',function(){self._handleSeek();self._refreshFromServer()});
        this.art.on('video:waiting',function(){self.stop()});
        this.art.on('video:loadedmetadata',function(){self.resize()});
        this.art.on('video:ended',function(){self.stop();self._handleSeek()});
        this.art.on('destroy',function(){self.destroy()});
        var ro=new ResizeObserver(function(){self.resize()});
        ro.observe(this.canvas);
        window.addEventListener('resize',function(){self.resize();setTimeout(function(){self.resize()},200)});
    };
    DanmakuEngine.prototype.load=function(data){
        this.data=(data||[]).slice();
        this._sortQueue();
        this.cursor=0;
        this._handleSeek();
    };
    DanmakuEngine.prototype.emit=function(dm){
        dm._sendTime=performance.now();
        dm._live=true;
        this._enqueue(dm);
    };
    /* 发射限流：每秒最多 maxPerSecond 条（用户发送的 _live 弹幕不受限） */
    DanmakuEngine.prototype._canEmit=function(){
        var now=performance.now();
        while(this._emitTimes.length&&this._emitTimes[0]<now-1000)this._emitTimes.shift();
        if(this._emitTimes.length>=this.maxPerSecond)return false;
        this._emitTimes.push(now);
        return true;
    };
    /* 入队：按密度采样（100% = 显示所有），发射限流，满则排队不丢弃 */
    DanmakuEngine.prototype._enqueue=function(dm){
        /* 屏蔽过滤：关键词 / 正则 / 类型（仅作用于非本端实时弹幕） */
        if(!dm._live){
            if(this.blockedTypes&&this.blockedTypes[dm.mode||0])return;
            if(dm.text&&this.keywords&&this.keywords.length){
                for(var ki=0;ki<this.keywords.length;ki++){
                    if(dm.text.indexOf(this.keywords[ki])>=0)return;
                }
            }
            if(dm.text&&this.regexList&&this.regexList.length){
                for(var ri=0;ri<this.regexList.length;ri++){
                    try{if(this.regexList[ri].test(dm.text))return}catch(e){}
                }
            }
        }
        if(!dm._live&&this.density<100&&Math.random()*100>=this.density)return;
        if(!dm._live&&!this._canEmit()){
            this.pending.push(dm);
            return;
        }
        var item=this._createItem(dm);
        if(item){item._live=dm._live;this.active.push(item);this._occupy(item);if(!this.running&&this.active.length>0)this.start();}
        else{
            this.pending.push(dm);
            if(this.pending.length>10000)this.pending.shift();
        }
    };
    /* 占用轨道：立即占位防止同帧重叠 */
    DanmakuEngine.prototype._occupy=function(item){
        if(item.mode!==0||item._track==null)return;
        var r=item.x+item.width;
        if(r>this.tracks[item._track])this.tracks[item._track]=r;
    };
    /* 释放轨道：重算该轨道最右弹幕位置 */
    DanmakuEngine.prototype._releaseTrack=function(track){
        var max=0;
        for(var i=0;i<this.active.length;i++){
            var a=this.active[i];
            if(a._done||a._track!==track||a.mode!==0)continue;
            var r=a.x+a.width;
            if(r>max)max=r;
        }
        this.tracks[track]=max;
    };
    DanmakuEngine.prototype._createItem=function(dm){
        var self=this;
        var txt=dm.text;if(!txt)return null;
        this.ctx.font='bold '+this.fontSize+'px '+this.fontFamily;
        var tw=this.ctx.measureText(txt).width;
        var item={
            text:txt, color:dm.color||'#ffffff', mode:dm.mode||0,
            time:dm.time, x:0, y:0, width:tw,
            startTime:performance.now(), duration:0, opacity:1, _done:false
        };
        if(item.mode===0){
            // scrolling: danmaku may overlap, always enter from the video right
            // edge, rows are only used for vertical placement
            item.duration=this.speed*1000;
            var bestTrack=-1;
            for(var i=0;i<this.tracks.length;i++){
                if(this.tracks[i]<=0){bestTrack=i;break}
            }
            if(bestTrack<0){
                var minEnd=Infinity;
                for(var i2=0;i2<this.tracks.length;i2++){
                    if(this.tracks[i2]<minEnd){minEnd=this.tracks[i2];bestTrack=i2}
                }
            }
            if(bestTrack<0)return null;
            item.x=this.vx+this.vw;
            // Random per-danmaku speed factor within +-speedJitter percent
            item._speedFactor=1+(Math.random()*2-1)*(this.speedJitter/100);
            var yTop=bestTrack*this.trackH;
            item.y=this.scrollY0+yTop+this.trackH-4;
            item._track=bestTrack;
        }else if(item.mode===1){
            // top - use row slots to avoid stacking
            var now=performance.now();
            var slot=-1;
            for(var si=0;si<this.topSlots.length;si++){
                if(this.topSlots[si]<=now){slot=si;break}
            }
            if(slot<0)return null;
            item.x=this.vx+(this.vw-tw)/2;
            item.y=this.vy+this.trackH+slot*this.trackH;
            item.duration=4000;
            item._fixed=true;
            item._slotType='top';
            item._slot=slot;
            this.topSlots[slot]=now+item.duration;
        }else{
            // bottom - use row slots from the bottom up
            var now2=performance.now();
            var slot2=-1;
            for(var si2=0;si2<this.bottomSlots.length;si2++){
                if(this.bottomSlots[si2]<=now2){slot2=si2;break}
            }
            if(slot2<0)return null;
            item.x=this.vx+(this.vw-tw)/2;
            item.y=this.vy+this.vh-this.trackH-slot2*this.trackH;
            item.duration=4000;
            item._fixed=true;
            item._slotType='bottom';
            item._slot=slot2;
            this.bottomSlots[slot2]=now2+item.duration;
        }
        return item;
    };
    DanmakuEngine.prototype._sortQueue=function(){
        this.data.sort(function(a,b){return a.time-b.time});
    };
    DanmakuEngine.prototype._handleSeek=function(){
        var ct=this.art.currentTime||0;
        // Clear active danmaku
        this.active.forEach(function(item){item._done=true});
        this.active=[];
        this.pending=[];
        this.tracks=[];for(var i=0;i<this.trackCount;i++)this.tracks.push(0);
        this.topSlots=[];this.bottomSlots=[];
        for(var rs=0;rs<this.topRows;rs++){this.topSlots.push(0);this.bottomSlots.push(0);}
        if(!this.data)return;
        // Reset cursor to first danmaku at/after current time
        // Danmaku strictly follow the video timeline: only items whose time
        // is reached will be shown by the update loop
        var c=0;
        while(c<this.data.length&&this.data[c].time<ct)c++;
        this.cursor=c;
    };
    /* 拖动进度条后重新拉取服务端弹幕（节流 2s），
       这样其他端刚发的弹幕无需刷新页面即可出现 */
    DanmakuEngine.prototype._refreshFromServer=function(){
        var now=Date.now();
        if(now-this._lastRefresh<2000)return;
        this._lastRefresh=now;
        if(!this.vid)return;
        var self=this;
        fetch('/api/danmu/v3/?id='+encodeURIComponent(this.vid))
            .then(function(r){return r.json()})
            .then(function(dd){
                if(dd.code!==0)return;
                var converted=dd.data.map(function(d){return{text:d[4],time:d[0],mode:d[1],color:'#'+d[2].toString(16).padStart(6,'0')}});
                self.load(converted);
            }).catch(function(){});
    };
    DanmakuEngine.prototype.start=function(){
        if(this.running)return;this.running=true;this.lastTime=performance.now();this._loop();
    };
    DanmakuEngine.prototype.stop=function(){
        this.running=false;if(this.animId)cancelAnimationFrame(this.animId);this.animId=null;
    };
    DanmakuEngine.prototype._loop=function(){
        if(!this.running)return;
        var self=this;
        this.animId=requestAnimationFrame(function(ts){self._tick(ts)});
    };
    DanmakuEngine.prototype._tick=function(ts){
        var dt=(ts-this.lastTime)/1000;
        this.lastTime=ts;
        this._update(dt,ts);
        this._render();
        this._loop();
    };
    DanmakuEngine.prototype._update=function(dt,ts){
        var ct=this.art.currentTime||0;
        var paused=this.art.video?this.art.video.paused:false;
        // Remove done items and free tracks
        for(var i=this.active.length-1;i>=0;i--){
            var item=this.active[i];
            if(item._done){this.active.splice(i,1);continue}
            if(paused&&!item._live)continue;
            if(item.mode===0){
                var speed=this.w/(this.speed*1000)*dt*1000;
                if(item._speedFactor)speed*=item._speedFactor;
                item.x-=speed;
                if(item._track!=null && item.x+item.width<this.vx){
                    var tr=item._track;
                    item._done=true;
                    this._releaseTrack(tr);
                }
            }else{
                var elapsed=(ts-item.startTime)/1000;
                if(elapsed>item.duration/1000){
                    if(item._slotType)this[item._slotType+'Slots'][item._slot]=0;
                    item._done=true;
                }
                else if(elapsed<0.3)item.opacity=elapsed/0.3;
                else if(elapsed>(item.duration/1000-1))item.opacity=Math.max(0,(item.duration/1000-elapsed));
                else item.opacity=1;
            }
        }
        // Rebuild track positions each frame from current danmaku positions
        // (frozen while paused). This keeps tracks in sync with scrolling,
        // so new danmaku can enter once the previous one clears the edge.
        if(!paused){
            for(var tj=0;tj<this.tracks.length;tj++)this.tracks[tj]=0;
            for(var tk=0;tk<this.active.length;tk++){
                var ta=this.active[tk];
                if(ta._done||ta.mode!==0||ta._track==null)continue;
                var tr=ta.x+ta.width;
                if(tr>this.tracks[ta._track])this.tracks[ta._track]=tr;
            }
        }
        // Drain pending queue (rate-limited to maxPerSecond)
        if(this.pending.length>0){
            var emitted=0;
            for(var pi=this.pending.length-1;pi>=0;pi--){
                var pdm=this.pending[pi];
                if(!pdm._live&&!this._canEmit())break;
                var pitem=this._createItem(pdm);
                if(pitem){pitem._live=pdm._live;this.pending.splice(pi,1);this.active.push(pitem);this._occupy(pitem);emitted++;}
                if(emitted>=8)break;
            }
        }
        // Pop data items at current time (cursor-based, replayable)
        while(this.data&&this.cursor<this.data.length&&this.data[this.cursor].time<=ct){
            var qdm=this.data[this.cursor++];
            this._enqueue(qdm);
        }
    };
    DanmakuEngine.prototype._render=function(){
        var ctx=this.ctx;
        ctx.clearRect(0,0,this.w,this.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.vx,this.vy,this.vw,this.vh);
        ctx.clip();
        if(!this.visible){ctx.restore();return;}
        /* 字幕防挡：计算字幕相对画布的区域，命中者跳过渲染 */
        var band=null;
        if(this.protect){
            var sub=document.querySelector('.art-subtitle');
            if(sub&&sub.offsetWidth&&sub.offsetHeight){
                var cr=this.canvas.getBoundingClientRect(),sr=sub.getBoundingClientRect();
                var pad=8;
                var bTop=sr.top-cr.top-pad,bBot=sr.bottom-cr.top+pad;
                var bLeft=Math.max(this.vx,sr.left-cr.left-pad),bRight=Math.min(this.vx+this.vw,sr.right-cr.left+pad);
                if(bBot>bTop&&bRight>bLeft)band={top:bTop,bot:bBot,left:bLeft,right:bRight};
            }
        }
        var bandHit=function(item){
            var iy0=item.y-this.fontSize,iy1=item.y;
            return iy1>band.top&&iy0<band.bot&&item.x<band.right&&item.x+item.width>band.left;
        };
        ctx.font='bold '+this.fontSize+'px '+this.fontFamily;
        ctx.textBaseline='bottom';
        // Pass 1: scroll danmaku (bottom layer)
        var i,item,alpha;
        for(i=0;i<this.active.length;i++){
            item=this.active[i];
            if(item._done||item.mode!==0)continue;
            if(band&&bandHit(item))continue;
            alpha=this.opacity;
            if(item.opacity!=null)alpha*=item.opacity;
            ctx.globalAlpha=alpha;
            ctx.shadowColor='rgba(0,0,0,0.8)';
            ctx.shadowBlur=2;
            ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
            ctx.fillStyle=item.color;
            ctx.fillText(item.text,item.x,item.y);
            ctx.shadowColor='transparent';
            ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
        }
        // Pass 2: existing fixed (top/bottom) danmaku above scroll
        for(i=0;i<this.active.length;i++){
            item=this.active[i];
            if(item._done||item.mode===0||item._live)continue;
            if(band&&bandHit(item))continue;
            alpha=this.opacity;
            if(item.opacity!=null)alpha*=item.opacity;
            ctx.globalAlpha=alpha;
            ctx.shadowColor='rgba(0,0,0,0.8)';
            ctx.shadowBlur=2;
            ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
            ctx.fillStyle=item.color;
            ctx.fillText(item.text,item.x,item.y);
            ctx.shadowColor='transparent';
            ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
        }
        // Pass 3: newly sent (live) top/bottom danmaku on top
        for(i=0;i<this.active.length;i++){
            item=this.active[i];
            if(item._done||item.mode===0||!item._live)continue;
            if(band&&bandHit(item))continue;
            alpha=this.opacity;
            if(item.opacity!=null)alpha*=item.opacity;
            ctx.globalAlpha=alpha;
            ctx.shadowColor='rgba(0,0,0,0.8)';
            ctx.shadowBlur=2;
            ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
            ctx.fillStyle=item.color;
            ctx.fillText(item.text,item.x,item.y);
            ctx.shadowColor='transparent';
            ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
        }
        ctx.globalAlpha=1;
        ctx.restore();
    };
    DanmakuEngine.prototype.show=function(){this.visible=true};
    DanmakuEngine.prototype.hide=function(){this.visible=false};
    DanmakuEngine.prototype.setOpacity=function(v){this.opacity=Math.max(0,Math.min(1,v))};
    DanmakuEngine.prototype.setSpeed=function(v){this.speed=Math.max(3,Math.min(15,v))};
    DanmakuEngine.prototype.setMargin=function(v){this.margin=v;this.resize()};
    DanmakuEngine.prototype.setMaxPerSecond=function(v){this.maxPerSecond=Math.max(1,Math.min(1000,v))};
    DanmakuEngine.prototype.setSpeedJitter=function(v){this.speedJitter=Math.max(0,Math.min(50,v))};
    DanmakuEngine.prototype.setFixedStack=function(v){
        this.fixedStack=Math.max(10,Math.min(100,v));
        localStorage.setItem('ap_dm_stack',String(this.fixedStack));
        this.resize();
    };
    DanmakuEngine.prototype.setDensity=function(v){
        this.density=Math.max(5,Math.min(100,v));
        localStorage.setItem('ap_dm_density',String(this.density));
    };
    DanmakuEngine.prototype.setArea=function(v){this.areaPct=Math.max(10,Math.min(100,v));this.resize()};
    DanmakuEngine.prototype.setBaseFont=function(v){this.baseFontSize=Math.max(12,Math.min(32,v));localStorage.setItem('ap_dm_font',String(this.baseFontSize));this.resize()};
    DanmakuEngine.prototype.setProtect=function(v){this.protect=!!v};
    DanmakuEngine.prototype.setFilters=function(kws,res,types){
        var self=this;
        this.keywords=(kws||[]).filter(function(k){return !!k});
        this.regexList=[];
        (res||[]).forEach(function(r){
            if(!r)return;
            try{self.regexList.push(new RegExp(r))}catch(e){}
        });
        this.blockedTypes=types||{};
    };
    DanmakuEngine.prototype.clear=function(){this.active=[];this.pending=[];this.data=[];this.cursor=0;this.tracks=[];for(var i=0;i<this.trackCount;i++)this.tracks.push(0)};
    DanmakuEngine.prototype.destroy=function(){this.stop();this.active=[];this.pending=[];this.data=[];this.cursor=0};

    /* ===== Init Player ===== */
    async function initPlayer(url){
        /* qs('url') 已解码一次（页面级编码）；此处必须原样使用，
           签名 URL 的查询串被二次解码会破坏签名（SignatureDoesNotMatch） */
        var decoded=url.trim();
        if(!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(decoded)&&!decoded.startsWith('/'))decoded='/'+decoded;

        var serverTheme=null,serverRender=null;
        try{
            var r=await fetch('/api/config/public');var d=await r.json();
            if(d.code===0){
                if(d.data.cdn&&d.data.cdn.enabled&&d.data.cdn.baseUrl){
                    var base=d.data.cdn.baseUrl.replace(/\/+$/,'');
                    if(!/^https?:\/\//i.test(decoded))decoded=base+(decoded.startsWith('/')?'':'/')+decoded;
                }
                serverTheme=d.data.theme;
                serverRender=d.data.render||null;
            }
        }catch(e){}

        /* OpenList/AList 云盘：立即将签名链接转换为云盘直链用于播放（服务器解析，不经过 OpenList API 列目录）
           vid / 字幕检测仍以归一化后的原链接为准：签名变化不影响弹幕与字幕关联 */
        var playUrl=decoded;
        try{
            var lr=await fetch('/api/video/resolve-link?url='+encodeURIComponent(decoded));
            var ld=await lr.json();
            if(ld.code===0&&ld.data&&ld.data.matched&&ld.data.url)playUrl=ld.data.url;
        }catch(e){}

        var subtitleUrl=qs('subtitle')||'';
        if(!subtitleUrl){
            try{
                var sr=await fetch('/api/subtitle/detect?url='+encodeURIComponent(decoded));
                var sd=await sr.json();
                if(sd.code===0&&sd.data.subtitles&&sd.data.subtitles.length){
                    subtitleList=sd.data.subtitles;
                    subtitleUrl=subtitleList[0].url;
                    currentSub=0;
                }
            }catch(e){}
        }
        /* 字幕库字幕（subtitle:xxx / id:xxx 形式）→ 统一转为 /api/subtitle/by-id 内容地址 */
        function resolveSubUrl(u){
            if(!u)return u;
            if(u.indexOf('subtitle:')===0)return '/api/subtitle/by-id?id='+encodeURIComponent(u.slice(9));
            if(u.indexOf('id:')===0)return '/api/subtitle/by-id?id='+encodeURIComponent(u.slice(3));
            return u;
        }

        var videoType=getVideoType(decoded);
        var title=qs('title')||decoded.split('/').pop()||decoded;

        /* 视频ID：优先 URL 参数，否则服务端分配/查映射（8位唯一ID），失败时本地散列兜底 */
        vid=qs('vid')||'';
        if(!vid){
            try{
                var vr=await fetch('/api/video/resolve?url='+encodeURIComponent(decoded));
                var vd=await vr.json();
                if(vd.code===0&&vd.data.vid)vid=vd.data.vid;
            }catch(e){}
        }
        if(!vid)vid=getVideoId(decoded);

        /* 插件内封字幕后台提取完成 → 弹窗提示，点击重载页面加载字幕（已加载字幕则不打扰，最多轮询 10 分钟） */
        if(!subtitleUrl&&vid){
            var _pn=0,_pt=setInterval(function(){
                _pn++;
                if(_pn>75){clearInterval(_pt);return;}
                fetch('/api/subtitle/has?vid='+encodeURIComponent(vid)).then(function(r){return r.json()}).then(function(hd){
                    if(hd&&hd.code===0&&hd.data&&hd.data.count>0){
                        clearInterval(_pt);
                        var tip=document.createElement('div');
                        tip.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(20,24,32,.95);color:#fff;border:1px solid #3b82f6;border-radius:10px;padding:10px 18px;font-size:13px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.4);max-width:86vw;text-align:center';
                        tip.textContent='✨ '+t('发现内封字幕')+(hd.data.langs&&hd.data.langs.length?('：'+hd.data.langs.join(' / ')+'，'):'，')+t('点击此处重载页面加载字幕');
                        tip.onclick=function(){location.reload();};
                        document.body.appendChild(tip);
                    }
                }).catch(function(){});
            },8000);
        }

        /* 通知插件：新视频加载（vid 已确定） */
        window.OpenVideoPlayer._fire('video:load',{url:decoded,vid:vid});
        try{fetch('/api/video/map',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vid:vid,url:decoded})}).catch(function(){})}catch(e){}

        var subOption={};
        if(subtitleUrl){
            var resolvedUrl=resolveSubUrl(subtitleUrl);
            var subType=resolvedUrl.endsWith('.vtt')||resolvedUrl.endsWith('.webvtt')?'vtt':'srt';
            subOption={url:resolvedUrl,type:subType,encoding:'utf-8',style:{color:'#fff',fontSize:'20px'}};
        }

        var customType={
            m3u8:function(video,src,artInst){
                if(Hls&&Hls.isSupported()){var hls=new Hls();hls.loadSource(src);hls.attachMedia(video);artInst.hls=hls;artInst.on('destroy',function(){hls.destroy()})}
                else if(video.canPlayType('application/vnd.apple.mpegurl'))video.src=src;
            },
            flv:function(video,src,artInst){
                if(flvjs&&flvjs.isSupported()){var flv=flvjs.createPlayer({type:'flv',url:src});flv.attachMediaElement(video);flv.load();artInst.flv=flv;artInst.on('destroy',function(){flv.destroy()})}
            }
        };

        if(art){art.destroy();art=null}
        if(dmEngine){dmEngine.destroy();dmEngine=null}

        /* Load danmaku from server */
        var danmakuData=[];
        try{var dr=await fetch('/api/danmu/v3/?id='+encodeURIComponent(vid));var dd=await dr.json();if(dd.code===0)danmakuData=dd.data}catch(e){}

        var themeColor=getComputedStyle(document.documentElement).getPropertyValue('--bili-pink').trim()||'#FB7299';

        /* ArtPlayer 原生控件语言（播放/暂停/音量等按钮提示） */
        var artLangs={zh:'zh-cn',zhHant:'zh-tw',wyw:'zh-cn',en:'en',ja:'ja',fr:'fr'};
        var artLang=artLangs[I18N.lang]||'zh-cn';

        var options={
            container:'#artplayer',url:playUrl,
            lang:artLang,
            autoplay:true,autoSize:true,autoMini:true,
            volume:parseFloat(localStorage.getItem('ap_volume'))||0.7,
            theme:themeColor,
            hotkey:true,screenshot:false,fullscreen:true,fullscreenWeb:true,
            notice:false,
            miniProgressBar:true,mutex:true,backdrop:true,
            playsInline:true,setting:false,pip:true,lock:true,
            loop:false,flip:false,aspectRatio:false,playbackRate:true,
            customType:customType,
            controls:[{
                position:'right',
                html:'<span class="dm-gear">'+ICONS.gear()+'</span>',
                tooltip:t('弹幕设置'),style:{order:2},
                click:function(){toggleDmPanel()}
            },{
                position:'right',
                html:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
                tooltip:t('截图'),style:{order:6},
                click:function(){var vv=this.video;if(vv&&vv.readyState>=2)serverShot(vv.currentTime);else showToast(t('视频未就绪'),true)}
            }]
        };

        if(subtitleUrl)options.subtitle=subOption;
        if(videoType==='hls')options.type='m3u8';
        else if(videoType==='flv')options.type='flv';

        try{
            art=new Artplayer(options);
            hideOverlay();setTimeout(function(){hideOverlay()},500);

            /* Init danmaku engine */
            var dmCanvas=document.getElementById('danmaku-canvas');
            var playerEl=document.querySelector('.art-video-player');
            if(playerEl&&dmCanvas.parentNode!==playerEl)playerEl.insertBefore(dmCanvas,playerEl.firstChild);
            dmEngine=new DanmakuEngine(dmCanvas,art);
            dmEngine.vid=vid;
            if(serverRender&&serverRender.maxPerSecond)dmEngine.setMaxPerSecond(serverRender.maxPerSecond);
            if(serverRender&&serverRender.speedJitter!=null)dmEngine.setSpeedJitter(serverRender.speedJitter);
            dmEngine.setMargin(danmakuMask);
            dmEngine.setSpeed(danmakuSpeed);
            dmEngine.setOpacity(danmakuOpacity);
            if(!danmakuVisible)dmEngine.hide();
            dmEngine.setFilters(dmKeywords,dmRegexes,dmTypes);
            dmEngine.setArea(danmakuArea);
            dmEngine.setBaseFont(danmakuFont);
            dmEngine.setProtect(danmakuProtect);

            /* Apply saved subtitle settings */
            try{art.subtitle.style({fontSize:subtitleSize+'px'});}catch(e){}
            var p=document.querySelector('.art-video-player');if(p)p.style.setProperty('--art-subtitle-bottom',subtitleBottom+'px');
            if(!subtitleVisible){var el=document.querySelector('.art-subtitle');if(el)el.style.display='none';}

            /* Convert server danmaku format and load */
            if(danmakuData.length){
                var converted=danmakuData.map(function(d){return{text:d[4],time:d[0],mode:d[1],color:'#'+d[2].toString(16).padStart(6,'0')}});
                dmEngine.load(converted);
                if(art.video&&!art.video.paused)dmEngine.start();
            }

            /* Restore position */
            var saved=parseFloat(localStorage.getItem('ap_pos_'+vid))||0;
            if(saved>3){art.on('video:loadedmetadata',function(){if(art.duration>saved+10)setTimeout(function(){art.seek=saved},400)})}
            setInterval(function(){if(art&&art.video&&!art.video.paused)localStorage.setItem('ap_pos_'+vid,art.currentTime)},5000);

            /* iframe 嵌入：视频元数据就绪后按宽高比贴合，窗口变化时重新计算 */
            if(isEmbed){
                art.on('video:loadedmetadata',function(){fitPlayer()});
                art.on('video:loadeddata',function(){fitPlayer()});
                window.addEventListener('resize',function(){fitPlayer()});
                setTimeout(fitPlayer,1200);
            }

            /* Theme: server config always wins, localStorage is only a fallback */
            if(serverTheme)setTheme(serverTheme);else setTheme(currentTheme);
            art.on('video:volumechange',function(){localStorage.setItem('ap_volume',art.volume)});

            /* Error */
            var videoOk=false;
            art.on('video:loadeddata',function(){videoOk=true});art.on('video:playing',function(){videoOk=true});
            art.on('video:error',function(){
                if(videoOk||(art.video&&art.video.readyState>0)){showToast(t('视频加载出现暂时性问题'),true);return}
                var code=art.video&&art.video.error?art.video.error.code:'';var msg=code===4?t('视频格式不支持'):code===3?t('视频解码失败'):code===2?t('网络错误'):t('视频加载失败');
                showError(msg+t('，请检查地址是否正确'));
            });

            /* Custom UI */
            setTimeout(function(){
                setupCommentBox();buildDmSettingsPanel();injectStatsPanel();setupOverflow();buildInfoArea(decoded,vid,danmakuData.length);
            },600);
        }catch(e){showError(t('播放器初始化失败: ')+e.message)}
    }

    /* ===== Helpers ===== */
    function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
    function copyText(s){
        if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(s).then(function(){showToast(t('已复制'))},function(){showToast(t('复制失败'),true)});
        }else{
            var ta=document.createElement('textarea');ta.value=s;ta.style.position='fixed';ta.style.opacity='0';
            document.body.appendChild(ta);ta.select();
            try{document.execCommand('copy');showToast(t('已复制'))}catch(e){showToast(t('复制失败'),true)}
            document.body.removeChild(ta);
        }
    }
    /* 字幕地址归一：subtitle:xxx / id:xxx → /api/subtitle/by-id?id=xxx（面板内切换字幕也需要） */
    function resolveSubUrl(u){
        if(!u)return u;
        if(u.indexOf('subtitle:')===0)return '/api/subtitle/by-id?id='+encodeURIComponent(u.slice(9));
        if(u.indexOf('id:')===0)return '/api/subtitle/by-id?id='+encodeURIComponent(u.slice(3));
        return u;
    }

    /* ===== 弹幕发送栏（B站式：开关 + 调色 + 胶囊输入 + 粉色发送按钮） ===== */
    function syncDmToggle(){
        var btn=document.querySelector('.bili-danmu .bd-toggle');
        if(btn){btn.innerHTML=danmakuVisible?ICONS.danmu():ICONS.danmuOff();btn.classList.toggle('off',!danmakuVisible)}
        var sw=document.querySelector('.dm-panel [data-act="toggle-dm"] .dm-switch');
        if(sw)sw.classList.toggle('on',danmakuVisible);
    }
    function setupCommentBox(){
        var app=document.querySelector('.art-video-player');
        var bottom=app?app.querySelector('.art-bottom'):null;
        var controlsLeft=bottom?bottom.querySelector('.art-controls-left'):null;
        if(!bottom||!controlsLeft||document.querySelector('.bili-danmu'))return;
        if(!dmEngine){setTimeout(setupCommentBox,300);return}

        var colors=['#ffffff','#e54256','#ffe133','#64dd17','#39ccff','#fb7299','#a855f7'];
        var types=[{v:0,n:t('滚动')},{v:1,n:t('顶部')},{v:2,n:t('底部')}];
        var curColor='#ffffff',curType=0;

        var wrap=document.createElement('div');wrap.className='bili-danmu';
        var toggleBtn=document.createElement('button');toggleBtn.className='bd-toggle';toggleBtn.title=t('弹幕开关');
        var colorBtn=document.createElement('button');colorBtn.className='bd-color';colorBtn.title=t('弹幕设置');colorBtn.innerHTML='<span class="dot" style="background:'+curColor+'"></span>';
        var panel=document.createElement('div');panel.className='bd-color-panel';
        panel.innerHTML='<div class="bd-colors">'+colors.map(function(c){return'<button data-c="'+c+'" style="background:'+c+'"></button>'}).join('')+'</div><div class="bd-types">'+types.map(function(t2){return'<button data-t="'+t2.v+'">'+t2.n+'</button>'}).join('')+'</div>';
        var input=document.createElement('input');input.className='bd-input';input.type='text';input.maxLength=30;input.placeholder=t('发个友善的弹幕见证当下');
        var sendBtn=document.createElement('button');sendBtn.className='bd-send';sendBtn.title=t('发送弹幕');sendBtn.textContent=t('发送');
        wrap.append(toggleBtn,colorBtn,panel,input,sendBtn);
        /* Danmaku box lives inside the left control group as a flex child:
           it can never overlap the buttons, and it hides together with the
           whole control bar (opacity / mini-progress mode). */
        controlsLeft.appendChild(wrap);
        syncDmToggle();
        panel.querySelectorAll('.bd-colors button').forEach(function(b,i){if(i===0)b.classList.add('active')});
        panel.querySelectorAll('.bd-types button').forEach(function(b,i){if(i===0)b.classList.add('active')});

        toggleBtn.addEventListener('click',function(e){
            e.stopPropagation();
            danmakuVisible=!danmakuVisible;
            if(dmEngine)danmakuVisible?dmEngine.show():dmEngine.hide();
            syncDmToggle();
            showToast(t(danmakuVisible?'弹幕已开启':'弹幕已关闭'));
        });
        colorBtn.addEventListener('click',function(e){e.stopPropagation();panel.classList.toggle('open')});
        panel.querySelectorAll('.bd-colors button').forEach(function(b){b.addEventListener('click',function(){curColor=b.dataset.c;colorBtn.querySelector('.dot').style.background=curColor;panel.querySelectorAll('.bd-colors button').forEach(function(x){x.classList.remove('active')});b.classList.add('active')})});
        panel.querySelectorAll('.bd-types button').forEach(function(b){b.addEventListener('click',function(){curType=parseInt(b.dataset.t);panel.querySelectorAll('.bd-types button').forEach(function(x){x.classList.remove('active')});b.classList.add('active')})});
        document.addEventListener('click',function(e){if(!wrap.contains(e.target))panel.classList.remove('open')});

        function doSend(){
            var text=input.value.trim();
            if(!text){showToast(t('要输入弹幕内容哦'),true);return}
            if(!dmEngine){showToast(t('弹幕引擎未就绪'),true);return}
            var danmuData={id:vid,player:vid,author:'user_'+Math.random().toString(36).substr(2,6),time:art.currentTime,text:text,color:parseInt(curColor.replace('#',''),16),type:curType};
            fetch('/api/danmu/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(danmuData)})
                .then(function(r){return r.json()})
                .then(function(d){
                    if(d.code===0){dmEngine.emit({text:text,color:curColor,mode:curType,time:d.data.time});input.value='';showToast(t('弹幕已发送'))}
                    else showToast(t(d.msg)||t('发送失败'),true);
                }).catch(function(){showToast(t('发送失败'),true)});
        }
        sendBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();doSend()});
        input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();e.stopPropagation();doSend()}});
        if(_overflowSystem)setTimeout(checkOverflow,50);
    }

    /* ===== 弹幕设置面板（B站式齿轮弹窗） ===== */
    var _dmPanel=null;
    var LANG_NAMES={zh:'中文',zhHant:'繁體中文',wyw:'文言',en:'English',ja:'日本語',fr:'Français'};
    function dmSwitch(on){return '<span class="dm-switch'+(on?' on':'')+'"><span class="dm-knob"></span></span>'}
    function dmCheck(){return '<span class="dm-box"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>'}
    function dmSlider(id,label,val,min,max,step,unit){
        return '<div class="dm-slider-row"><div class="dm-slider-head"><span>'+label+'</span><b data-sval="'+id+'">'+val+unit+'</b></div><input class="dm-range" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'" data-sid="'+id+'"></div>';
    }
    function buildDmSettingsPanel(){
        var app=document.querySelector('.art-video-player');
        if(!app)return;
        if(_dmPanel&&_dmPanel.parentNode)return;
        var panel=document.createElement('div');panel.className='dm-panel';
        app.appendChild(panel);_dmPanel=panel;
        document.addEventListener('click',function(e){
            if(!panel.classList.contains('open'))return;
            if(panel.contains(e.target))return;
            var n=e.target;
            while(n){if(n.classList&&n.classList.contains('dm-gear'))return;n=n.parentNode}
            panel.classList.remove('open');
        });
    }
    function toggleDmPanel(force){
        if(!_dmPanel||!_dmPanel.parentNode)buildDmSettingsPanel();
        if(!_dmPanel)return;
        var open=(typeof force==='boolean')?force:!_dmPanel.classList.contains('open');
        if(open)dmRender('main');
        _dmPanel.classList.toggle('open',open);
    }
    function dmHead(title,back){
        return back?'<div class="dm-head"><button class="dm-back" data-back="1">'+ICONS.back()+'</button><span class="dm-title">'+esc(title)+'</span></div>'
                   :'<div class="dm-head"><span class="dm-title">'+esc(title)+'</span></div>';
    }
    function dmApplyFilters(){
        if(dmEngine)dmEngine.setFilters(dmKeywords,dmRegexes,dmTypes);
        try{
            localStorage.setItem('ap_dm_kw',JSON.stringify(dmKeywords));
            localStorage.setItem('ap_dm_re',JSON.stringify(dmRegexes));
            localStorage.setItem('ap_dm_types',JSON.stringify(dmTypes));
        }catch(e){}
    }
    function dmRender(page){
        var panel=_dmPanel;if(!panel)return;
        var SPEEDS=[0.5,0.75,1,1.25,1.5,2];
        var curRate=(art&&art.playbackRate)||1;
        var html='';
        if(page==='main'){
            html+=dmHead(t('弹幕设置'));
            html+='<button class="dm-row" data-act="toggle-dm"><span class="dm-row-label">'+esc(t('弹幕开关'))+'</span>'+dmSwitch(danmakuVisible)+'</button>';
            html+='<button class="dm-row" data-nav="block"><span class="dm-row-label">'+esc(t('弹幕屏蔽'))+'</span><span class="dm-val">'+ICONS.chevron()+'</span></button>';
            html+='<button class="dm-row" data-nav="protect"><span class="dm-row-label">'+esc(t('防挡弹幕'))+'</span><span class="dm-val">'+ICONS.chevron()+'</span></button>';
            html+='<button class="dm-row" data-nav="more"><span class="dm-row-label">'+esc(t('更多设置'))+'</span><span class="dm-val">'+ICONS.chevron()+'</span></button>';
            html+='<button class="dm-row" data-nav="speed"><span class="dm-row-label">'+esc(t('倍速'))+'</span><span class="dm-val">'+curRate+'×</span></button>';
            html+='<button class="dm-row" data-nav="subtitle"><span class="dm-row-label">'+esc(t('字幕设置'))+'</span><span class="dm-val">'+ICONS.chevron()+'</span></button>';
            html+='<button class="dm-row" data-nav="lang"><span class="dm-row-label">'+esc(t('语言'))+'</span><span class="dm-val">'+esc(LANG_NAMES[I18N.lang]||'')+'</span></button>';
            html+='<button class="dm-row" data-act="stats"><span class="dm-row-label">'+esc(t('统计信息'))+'</span></button>';
        }else if(page==='block'){
            html+=dmHead(t('弹幕屏蔽'),true);
            html+='<div class="dm-sec">'+esc(t('关键词屏蔽'))+'</div>';
            if(dmKeywords.length){
                html+='<div class="dm-chips">'+dmKeywords.map(function(k,i){return '<span class="dm-chip"><span>'+esc(k)+'</span><button data-kw="'+i+'" title="'+esc(t('删除'))+'">'+ICONS.close()+'</button></span>'}).join('')+'</div>';
            }else html+='<div class="dm-empty">—</div>';
            html+='<div class="dm-add"><input class="dm-kw-in" placeholder="'+esc(t('输入关键词'))+'"><button data-add="kw">'+esc(t('添加'))+'</button></div>';
            html+='<div class="dm-sec">'+esc(t('正则屏蔽'))+'</div>';
            if(dmRegexes.length){
                html+='<div class="dm-chips">'+dmRegexes.map(function(k,i){return '<span class="dm-chip"><span>'+esc(k)+'</span><button data-re="'+i+'" title="'+esc(t('删除'))+'">'+ICONS.close()+'</button></span>'}).join('')+'</div>';
            }else html+='<div class="dm-empty">—</div>';
            html+='<div class="dm-add"><input class="dm-re-in" placeholder="'+esc(t('输入正则'))+'"><button data-add="re">'+esc(t('添加'))+'</button></div>';
            html+='<div class="dm-sec">'+esc(t('按类型屏蔽'))+'</div>';
            html+='<div class="dm-check'+(dmTypes[0]?' on':'')+'" data-type="0">'+dmCheck()+esc(t('滚动'))+'</div>';
            html+='<div class="dm-check'+(dmTypes[1]?' on':'')+'" data-type="1">'+dmCheck()+esc(t('顶部'))+'</div>';
            html+='<div class="dm-check'+(dmTypes[2]?' on':'')+'" data-type="2">'+dmCheck()+esc(t('底部'))+'</div>';
        }else if(page==='protect'){
            html+=dmHead(t('防挡弹幕'),true);
            html+='<button class="dm-row" data-act="protect"><span class="dm-row-label">'+esc(t('字幕防挡'))+'</span>'+dmSwitch(danmakuProtect)+'</button>';
        }else if(page==='more'){
            html+=dmHead(t('更多设置'),true);
            html+=dmSlider('opacity',esc(t('不透明度')),Math.round(danmakuOpacity*100),20,100,1,'%');
            html+=dmSlider('speed',esc(t('速度')),danmakuSpeed,3,15,0.1,'s');
            html+=dmSlider('density',esc(t('弹幕密度')),dmEngine?Math.round(dmEngine.density):(parseInt(localStorage.getItem('ap_dm_density'))||100),5,100,1,'%');
            html+=dmSlider('font',esc(t('弹幕字号')),danmakuFont,12,32,1,'px');
            html+=dmSlider('area',esc(t('显示区域')),danmakuArea,25,100,25,'%');
            html+=dmSlider('stack',esc(t('顶/底堆叠')),parseInt(localStorage.getItem('ap_dm_stack'))||100,10,100,1,'%');
            html+=dmSlider('mask',esc(t('底边距')),danmakuMask,0,100,1,'%');
        }else if(page==='speed'){
            html+=dmHead(t('倍速'),true);
            SPEEDS.forEach(function(s){
                html+='<button class="dm-row'+(Math.abs(curRate-s)<0.001?' active':'')+'" data-speed="'+s+'"><span class="dm-row-label">'+s+'×</span></button>';
            });
        }else if(page==='subtitle'){
            html+=dmHead(t('字幕设置'),true);
            html+='<button class="dm-row" data-act="sub-visible"><span class="dm-row-label">'+esc(t('字幕开关'))+'</span>'+dmSwitch(subtitleVisible)+'</button>';
            html+=dmSlider('subfs',esc(t('字幕大小')),subtitleSize,14,32,1,'px');
            html+=dmSlider('subbt',esc(t('字幕底距')),subtitleBottom,5,80,1,'px');
            html+='<div class="dm-sec">'+esc(t('字幕选择'))+'</div>';
            if(subtitleList&&subtitleList.length){
                subtitleList.forEach(function(s,i){
                    html+='<button class="dm-row'+(i===currentSub?' active':'')+'" data-sub="'+i+'"><span class="dm-row-label">'+esc(s.title||s.url)+'</span></button>';
                });
            }else html+='<div class="dm-empty">'+esc(t('暂无字幕'))+'</div>';
        }else if(page==='lang'){
            html+=dmHead(t('语言'),true);
            Object.keys(LANG_NAMES).forEach(function(k){
                html+='<button class="dm-row'+(I18N.lang===k?' active':'')+'" data-lang="'+k+'"><span class="dm-row-label">'+esc(LANG_NAMES[k])+'</span></button>';
            });
        }
        panel.innerHTML=html;

        panel.querySelectorAll('[data-back]').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();dmRender('main')})});
        panel.querySelectorAll('[data-nav]').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();dmRender(b.dataset.nav)})});

        var act;
        if((act=panel.querySelector('[data-act="toggle-dm"]'))){
            act.addEventListener('click',function(e){
                e.stopPropagation();
                danmakuVisible=!danmakuVisible;
                if(dmEngine)danmakuVisible?dmEngine.show():dmEngine.hide();
                syncDmToggle();
                showToast(t(danmakuVisible?'弹幕已开启':'弹幕已关闭'));
            });
        }
        if((act=panel.querySelector('[data-act="protect"]'))){
            act.addEventListener('click',function(e){
                e.stopPropagation();
                danmakuProtect=!danmakuProtect;
                localStorage.setItem('ap_dm_protect',danmakuProtect?'1':'0');
                if(dmEngine)dmEngine.setProtect(danmakuProtect);
                act.querySelector('.dm-switch').classList.toggle('on',danmakuProtect);
            });
        }
        if((act=panel.querySelector('[data-act="stats"]'))){
            act.addEventListener('click',function(e){
                e.stopPropagation();
                var p=document.querySelector('.ap-stats-panel');
                if(p){p.classList.toggle('open');buildStats()}
            });
        }
        if((act=panel.querySelector('[data-act="sub-visible"]'))){
            act.addEventListener('click',function(e){
                e.stopPropagation();
                subtitleVisible=!subtitleVisible;
                var el=document.querySelector('.art-subtitle');
                if(el)el.style.display=subtitleVisible?'':'none';
                act.querySelector('.dm-switch').classList.toggle('on',subtitleVisible);
            });
        }
        /* 屏蔽页：增删关键词 / 正则 / 类型开关 */
        panel.querySelectorAll('[data-kw]').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();dmKeywords.splice(parseInt(b.dataset.kw),1);dmApplyFilters();dmRender('block')})});
        panel.querySelectorAll('[data-re]').forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();dmRegexes.splice(parseInt(b.dataset.re),1);dmApplyFilters();dmRender('block')})});
        panel.querySelectorAll('[data-add]').forEach(function(b){
            var kind=b.dataset.add;
            var inp=panel.querySelector(kind==='kw'?'.dm-kw-in':'.dm-re-in');
            function addOne(){
                if(!inp)return;
                var v=inp.value.trim();if(!v)return;
                if(kind==='kw'){if(dmKeywords.indexOf(v)<0)dmKeywords.push(v)}
                else{try{new RegExp(v)}catch(e2){showToast(t('正则表达式无效'),true);return}if(dmRegexes.indexOf(v)<0)dmRegexes.push(v)}
                dmApplyFilters();dmRender('block');
            }
            b.addEventListener('click',function(e){e.stopPropagation();addOne()});
            if(inp)inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();e.stopPropagation();addOne()}});
        });
        panel.querySelectorAll('[data-type]').forEach(function(b){
            b.addEventListener('click',function(e){
                e.stopPropagation();
                var v=parseInt(b.dataset.type);
                dmTypes[v]=!dmTypes[v];
                b.classList.toggle('on',dmTypes[v]);
                dmApplyFilters();
            });
        });
        /* 滑块 */
        panel.querySelectorAll('.dm-range').forEach(function(r){
            r.addEventListener('input',function(){
                var v=parseFloat(r.value);
                var out=panel.querySelector('[data-sval="'+r.dataset.sid+'"]');
                var unit='',shown=Math.round(v);
                if(r.dataset.sid==='opacity'){danmakuOpacity=v/100;localStorage.setItem('ap_dm_opacity',String(danmakuOpacity));if(dmEngine)dmEngine.setOpacity(danmakuOpacity);unit='%'}
                else if(r.dataset.sid==='speed'){danmakuSpeed=v;localStorage.setItem('ap_dm_speed',String(v));if(dmEngine)dmEngine.setSpeed(v);unit='s';shown=v.toFixed(1)}
                else if(r.dataset.sid==='density'){if(dmEngine)dmEngine.setDensity(v);unit='%'}
                else if(r.dataset.sid==='font'){danmakuFont=Math.round(v);localStorage.setItem('ap_dm_font',String(danmakuFont));if(dmEngine)dmEngine.setBaseFont(danmakuFont);unit='px'}
                else if(r.dataset.sid==='area'){danmakuArea=Math.round(v);localStorage.setItem('ap_dm_area',String(danmakuArea));if(dmEngine)dmEngine.setArea(danmakuArea);unit='%'}
                else if(r.dataset.sid==='stack'){if(dmEngine)dmEngine.setFixedStack(v);unit='%'}
                else if(r.dataset.sid==='mask'){applyDanmakuMask(v);unit='%'}
                else if(r.dataset.sid==='subfs'){subtitleSize=Math.round(v);localStorage.setItem('ap_sub_fs',String(subtitleSize));if(art){try{art.subtitle.style({fontSize:subtitleSize+'px'})}catch(e3){}}unit='px'}
                else if(r.dataset.sid==='subbt'){subtitleBottom=Math.round(v);localStorage.setItem('ap_sub_bottom',String(subtitleBottom));var vp=document.querySelector('.art-video-player');if(vp)vp.style.setProperty('--art-subtitle-bottom',subtitleBottom+'px');unit='px'}
                if(out)out.textContent=shown+unit;
            });
        });
        /* 倍速 */
        panel.querySelectorAll('[data-speed]').forEach(function(b){
            b.addEventListener('click',function(e){
                e.stopPropagation();
                var s=parseFloat(b.dataset.speed);
                if(art){try{art.playbackRate=s}catch(e4){}}
                dmRender('speed');
            });
        });
        /* 字幕选择 */
        panel.querySelectorAll('[data-sub]').forEach(function(b){
            b.addEventListener('click',function(e){
                e.stopPropagation();
                var i=parseInt(b.dataset.sub);
                if(art&&subtitleList&&subtitleList[i]){
                    var s=subtitleList[i];
                    try{
                        art.subtitle.switch(resolveSubUrl(s.url),{name:s.title||s.url,type:(s.url&&s.url.indexOf('.vtt')>=0)?'vtt':'srt'});
                        currentSub=i;
                    }catch(e5){}
                    dmRender('subtitle');
                }
            });
        });
        /* 语言 */
        panel.querySelectorAll('[data-lang]').forEach(function(b){
            b.addEventListener('click',function(e){
                e.stopPropagation();
                I18N.setLang(b.dataset.lang);
                location.reload();
            });
        });
    }

    /* ===== 页面信息区（B站视频页神韵：标题 + 统计行 + 标签 + 操作） ===== */
    function buildInfoArea(url,vid2,dmCount){
        var box=document.getElementById('biliInfo');if(!box)return;
        var title=qs('title')||((url||'').split('/').pop()||url||'');
        try{title=decodeURIComponent(title)}catch(e){}
        document.getElementById('biTitle').textContent=title;
        var host='';
        try{if(url)host=new URL(url).hostname}catch(e){}
        var vtype=url?getVideoType(url):'normal';
        var srcName=vtype==='hls'?'HLS':(vtype==='flv'?'FLV':'MP4');
        document.getElementById('biMeta').innerHTML=
            '<span>'+esc(t('弹幕数'))+' <b>'+esc(String(dmCount||0))+'</b></span>'+
            '<span>'+esc(t('时长'))+' <b id="biDur">—</b></span>'+
            '<span>'+esc(t('分辨率'))+' <b id="biRes">—</b></span>'+
            (host?'<span>'+esc(t('来源'))+' <b>'+esc(host)+'</b></span>':'');
        var tags=document.getElementById('biTags');tags.innerHTML='';
        function addTag(txt){var s=document.createElement('span');s.className='bi-tag';s.textContent=txt;tags.appendChild(s)}
        addTag(srcName);
        if(host)addTag(host);
        if(vid2)addTag('vid: '+vid2);
        var acts=document.getElementById('biActs');acts.innerHTML='';
        function addBtn(label,icon,fn){var b=document.createElement('button');b.className='bi-btn';b.innerHTML=icon+'<span>'+esc(label)+'</span>';b.addEventListener('click',fn);acts.appendChild(b)}
        addBtn(t('截图'),ICONS.camera(),function(){serverShot()});
        addBtn(t('复制链接'),ICONS.link(),function(){copyText(location.href)});
        addBtn(t('嵌入代码'),ICONS.code(),function(){
            var src=location.origin+'/player/?url='+encodeURIComponent(url||'');
            copyText('<iframe src="'+src+'" width="960" height="540" frameborder="0" allowfullscreen></iframe>');
        });
        if(art){
            art.on('video:loadedmetadata',function(){
                var v=art.video;if(!v)return;
                var d=document.getElementById('biDur');if(d)d.textContent=fmtTime(v.duration);
                var rr=document.getElementById('biRes');if(rr&&v.videoWidth)rr.textContent=v.videoWidth+' × '+v.videoHeight;
            });
        }
    }

    /* ===== Screenshot（服务端 ffmpeg 抓帧：跨域视频不受 canvas 污染限制） ===== */
    function serverShot(time){
        if(!art||!art.video||art.video.readyState<2){showToast(t('视频未就绪'),true);return;}
        var su=(art.option&&art.option.url)||'';
        if(!su){showToast(t('视频未就绪'),true);return;}
        showToast(t('截图中...'));
        fetch('/api/video/screenshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:su,time:time||art.video.currentTime})})
            .then(function(r){return r.json()}).then(function(d){
                if(d.code===0&&d.data&&d.data.image){
                    var a=document.createElement('a');a.href=d.data.image;a.download='screenshot-'+Date.now()+'.jpg';a.click();
                    showToast(t('截图已保存'));
                }else showToast(d.msg||t('截图失败'),true);
            }).catch(function(){showToast(t('截图失败'),true)});
    }

    /* ===== Stats ===== */
    function injectStatsPanel(){
        var app=document.querySelector('.art-video-player');if(!app||document.querySelector('.ap-stats-panel'))return;
        var p=document.createElement('div');p.className='ap-stats-panel';
        p.innerHTML='<div class="ap-stats-sec">'+t('视频信息')+'</div><div class="ap-stats-row"><span>'+t('编码')+'</span><b id="st-codec">—</b></div><div class="ap-stats-row"><span>'+t('源类型')+'</span><b id="st-src">—</b></div><div class="ap-stats-row"><span>'+t('分辨率')+'</span><b id="st-res">—</b></div><div class="ap-stats-row"><span>'+t('帧率')+'</span><b id="st-fps">—</b></div><div class="ap-stats-row"><span>'+t('丢帧')+'</span><b id="st-drop">—</b></div><div class="ap-stats-row"><span>'+t('码率')+'</span><b id="st-bw">—</b></div><div class="ap-stats-row"><span>'+t('时长')+'</span><b id="st-dur">—</b></div><div class="ap-stats-sec" style="border-top:1px solid rgba(255,255,255,.08);margin-top:4px">'+t('浏览器解码能力')+'</div><div class="ap-stats-row"><span>H.264</span><span id="st-h264" class="ap-badge">—</span></div><div class="ap-stats-row"><span>HEVC (H.265)</span><span id="st-hevc" class="ap-badge">—</span></div><div class="ap-stats-row"><span>HEVC 10bit</span><span id="st-hevc10" class="ap-badge">—</span></div><div class="ap-stats-row"><span>AV1</span><span id="st-av1" class="ap-badge">—</span></div><div class="ap-stats-row"><span>VP9</span><span id="st-vp9" class="ap-badge">—</span></div><div class="ap-stats-sec" style="border-top:1px solid rgba(255,255,255,.08);margin-top:4px">'+t('硬解流畅度')+'</div><div class="ap-stats-row"><span>HEVC 1080p</span><span id="mc-hevc-1080" class="ap-badge">—</span></div><div class="ap-stats-row"><span>HEVC 4K</span><span id="mc-hevc-4k" class="ap-badge">—</span></div><div class="ap-stats-row"><span>AV1 1080p</span><span id="mc-av1-1080" class="ap-badge">—</span></div><div class="ap-stats-row"><span>AV1 4K</span><span id="mc-av1-4k" class="ap-badge">—</span></div>';
        app.appendChild(p);
        document.addEventListener('click',function(e){if(p.classList.contains('open')&&!p.contains(e.target)&&!e.target.closest('.art-setting-item')&&!e.target.closest('.art-contextmenu'))p.classList.remove('open')});
    }
    function statsEl(id){return document.getElementById(id)}
    function fmtTime(s){if(!isFinite(s))return'—';s=Math.floor(s);var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return(h>0?h+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')}
    function setBadge(id,val){var b=statsEl(id);if(!b)return;var cls='no',txt=t('不支持');if(val==='probably'){cls='ok';txt=t('原生支持')}else if(val==='maybe'){cls='soft';txt=t('可能支持')}b.className='ap-badge '+cls;b.textContent=txt}
    function buildStats(){
        if(!art||!art.video)return;var v=art.video;
        var srcNames={normal:t('MP4 / 直链'),hls:'HLS',flv:'FLV'};var srcType='normal';var url=(art.option&&art.option.url)||'';
        if(url.includes('.m3u8'))srcType='hls';else if(url.includes('.flv'))srcType='flv';statsEl('st-src').textContent=srcNames[srcType]||srcType;
        var codec='';if(srcType==='hls'&&art.hls){var lv=art.hls.levels&&art.hls.levels[art.hls.currentLevel||0];codec=(lv&&(lv.videoCodec||(lv.attrs&&lv.attrs.CODECS)))||''}else if(srcType==='flv'&&art.flv&&art.flv.mediaInfo)codec=art.flv.mediaInfo.videoCodec||'';statsEl('st-codec').textContent=codec||t('浏览器原生解码');
        statsEl('st-res').textContent=(v.videoWidth&&v.videoHeight)?v.videoWidth+' × '+v.videoHeight:'—';statsEl('st-dur').textContent=fmtTime(v.duration);
        var sup=detectCodecs();setBadge('st-h264',sup.h264);setBadge('st-hevc',sup.hevc);setBadge('st-hevc10',sup.hevc10);setBadge('st-av1',sup.av1);setBadge('st-vp9',sup.vp9);
        if(v.getVideoPlaybackQuality){try{var q=v.getVideoPlaybackQuality();if(q)statsEl('st-drop').textContent=q.droppedVideoFrames||0}catch(e){}}
        if(art.hls&&art.hls.bandwidthEstimate){var bw=art.hls.bandwidthEstimate/1024;statsEl('st-bw').textContent=bw>=1024?(bw/1024).toFixed(1)+' Mbps':Math.round(bw)+' Kbps'}
        probeMediaCaps();
    }
    function detectCodecs(){var v=document.createElement('video');var p=function(m){try{return v.canPlayType(m)}catch(e){return''}};return{h264:p('video/mp4; codecs="avc1.42E01E"')||p('video/mp4; codecs="avc1.64001F"'),hevc:p('video/mp4; codecs="hev1.1.6.L93.B0"')||p('video/mp4; codecs="hvc1.1.6.L93.B0"'),hevc10:p('video/mp4; codecs="hev1.2.4.L120.90"')||p('video/mp4; codecs="hvc1.2.4.L120.90"'),av1:p('video/mp4; codecs="av01.0.05M.08"')||p('video/webm; codecs="av01.0.05M.08"'),vp9:p('video/webm; codecs="vp9"')}}
    async function probeMediaCaps(){if(!navigator.mediaCapabilities||!navigator.mediaCapabilities.decodingInfo)return;var items=[{id:'mc-hevc-1080',mime:'video/mp4; codecs="hev1.1.6.L93.B0"',w:1920,h:1080,br:8000000},{id:'mc-hevc-4k',mime:'video/mp4; codecs="hev1.2.4.L120.90"',w:3840,h:2160,br:25000000},{id:'mc-av1-1080',mime:'video/mp4; codecs="av01.0.05M.08"',w:1920,h:1080,br:6000000},{id:'mc-av1-4k',mime:'video/mp4; codecs="av01.0.05M.08"',w:3840,h:2160,br:18000000}];for(var i=0;i<items.length;i++){var it=items[i],el=statsEl(it.id);if(!el)continue;            try{var r=await navigator.mediaCapabilities.decodingInfo({type:'file',video:{contentType:it.mime,width:it.w,height:it.h,bitrate:it.br,framerate:30}});if(!r.supported){el.className='ap-badge no';el.textContent=t('不支持')}else if(r.smooth&&r.powerEfficient){el.className='ap-badge ok';el.textContent=t('硬解流畅')}else if(r.smooth){el.className='ap-badge soft';el.textContent=t('流畅')}else{el.className='ap-badge soft';el.textContent=t('软解')}}catch(e){el.className='ap-badge no';el.textContent='—'}}}

    /* ===== Overflow ===== */
    function setupOverflow(){
        var app=document.querySelector('.art-video-player');var bottom=app?app.querySelector('.art-bottom'):null;
        var rightBar=bottom?bottom.querySelector('.art-controls-right'):null;if(!rightBar||document.querySelector('.bili-overflow-btn'))return;
        var overflowBtn=document.createElement('div');overflowBtn.className='art-control bili-overflow-btn';overflowBtn.title=t('更多选项');overflowBtn.innerHTML=ICONS.more();overflowBtn.style.display='none';
        var popup=document.createElement('div');popup.className='bili-overflow-panel';bottom.appendChild(popup);rightBar.appendChild(overflowBtn);
        overflowBtn.addEventListener('click',function(e){e.stopPropagation();popup.classList.toggle('open')});
        document.addEventListener('click',function(e){if(!popup.contains(e.target)&&e.target!==overflowBtn)popup.classList.remove('open')});
        _overflowSystem={overflowBtn:overflowBtn,popup:popup,bottom:bottom,rightBar:rightBar};checkOverflow();
        var ro=new ResizeObserver(function(){checkOverflow()});ro.observe(bottom);
        var ro2=new ResizeObserver(function(){checkOverflow()});ro2.observe(app);
        window.addEventListener('resize',function(){setTimeout(checkOverflow,150)});
        document.fonts&&document.fonts.ready&&document.fonts.ready.then(function(){setTimeout(checkOverflow,300)});
        if(art){
            art.on('fullscreen',function(){setTimeout(checkOverflow,1000)});
            art.on('fullscreenWeb',function(){setTimeout(checkOverflow,1000)});
        }
    }
    function checkOverflow(){
        var sys=_overflowSystem;if(!sys)return;var overflowBtn=sys.overflowBtn,popup=sys.popup,rightBar=sys.rightBar;
        /* Reset buttons, then collect buttons that stick out of the container. */
        rightBar.querySelectorAll('.art-control').forEach(function(c){c.style.display='';c.classList.remove('bili-overflow-hidden')});
        var hidden=[],rightRect=rightBar.getBoundingClientRect();
        rightBar.querySelectorAll('.art-control').forEach(function(ctrl){if(ctrl===overflowBtn)return;if(ctrl.getBoundingClientRect().right>rightRect.right+4){hidden.push(ctrl);ctrl.style.display='none';ctrl.classList.add('bili-overflow-hidden')}});
        /* Danmaku bar: flex child of the left controls, never overlaps.
           When there is not enough room for it, hide the danmaku bar itself
           and keep every button intact. Space is computed from the player
           geometry so the bar can reappear after the window grows again. */
        var danmuEl=document.querySelector('.bili-danmu');
        if(danmuEl){
            var playerEl2=document.querySelector('.art-video-player');
            var playerW=playerEl2?playerEl2.getBoundingClientRect().width:0;
            var rightW=0;
            var btnEls=[].slice.call(rightBar.children).filter(function(c){return c.offsetWidth>0&&c.offsetHeight>0&&!c.classList.contains('bili-overflow-btn')});
            if(btnEls.length){
                var minL=Math.min.apply(null,btnEls.map(function(c){return c.getBoundingClientRect().left}));
                rightW=rightRect.right-minL;
            }
            var avail=playerW-rightW-160-16;
            var squeeze=avail<220;
            if(squeeze&&!danmuEl.classList.contains('bili-danmu-hidden')){
                danmuEl.classList.add('bili-danmu-hidden');
                danmuEl.style.display='none';
            }else if(!squeeze&&danmuEl.classList.contains('bili-danmu-hidden')){
                danmuEl.classList.remove('bili-danmu-hidden');
                danmuEl.style.display='';
            }
        }
        popup.innerHTML='';if(hidden.length>0){overflowBtn.style.display='';hidden.forEach(function(el){var label=el.getAttribute('title')||el.textContent.trim()||'选项';var iconEl=el.querySelector('svg');var item=document.createElement('button');item.className='bili-overflow-item';var iconWrap=document.createElement('span');iconWrap.className='item-icon';if(iconEl)iconWrap.appendChild(iconEl.cloneNode(true));var labelEl=document.createElement('span');labelEl.className='item-label';labelEl.textContent=label;item.appendChild(iconWrap);item.appendChild(labelEl);item.addEventListener('click',function(e){e.stopPropagation();el.click();popup.classList.remove('open');checkOverflow()});popup.appendChild(item)})}else{overflowBtn.style.display='none';popup.classList.remove('open')}
    }
    /* Danmaku box follows the control bar visibility:
       hidden in mini-progress-bar / lock mode (controls are slid away),
       otherwise the parent .art-bottom opacity handles it. */
    /* ===== 插件前端扩展：加载清单 → 注入资源 → 构建 ctx → 播放器替换/默认启动 ===== */
    var _pluginsLoaded=false, _readyFired=false;
    function loadTag(kind,url){
        return new Promise(function(resolve){
            var el=document.createElement(kind==='link'?'link':'script');
            if(kind==='link'){el.rel='stylesheet';el.href=url}else{el.src=url}
            el.onload=resolve;el.onerror=resolve;
            (kind==='link'?document.head:document.body).appendChild(el);
        });
    }
    function buildPluginCtx(url){
        var ctx={
            container:document.getElementById('artplayer'),
            url:url||'',
            vid:'',
            config:{},
            pluginConfig:{},
            danmaku:{
                get:function(vid2){return fetch('/api/danmu/v3/?id='+encodeURIComponent(vid2)).then(function(r){return r.json()}).then(function(d){return d.code===0?d.data:[]})},
                send:function(payload){return fetch('/api/danmu/v3/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json()})}
            },
            resolve:function(url2){return fetch('/api/video/resolve?url='+encodeURIComponent(url2)).then(function(r){return r.json()}).then(function(d){return d.code===0?(d.data.vid||''):''})},
            on:function(ev,fn){window.OpenVideoPlayer.on(ev,fn)},
            emit:function(ev,data){window.OpenVideoPlayer._fire(ev,data)},
            setUrl:function(u){bootPlayer(u)}
        };
        try{
            fetch('/api/config/public').then(function(r){return r.json()}).then(function(d){
                if(d.code===0)ctx.config=d.data;
                window.OpenVideoPlayer._fire('config:ready',ctx.config);
            }).catch(function(){});
        }catch(e){}
        return ctx;
    }
    function loadPlayerPlugins(cb){
        fetch('/api/plugins/manifest?scope=player').then(function(r){return r.json()}).then(function(d){
            var list=(d.code===0&&d.data&&d.data.plugins)||[];
            var chain=[];
            list.forEach(function(p){
                (p.styles||[]).forEach(function(s){chain.push(function(){return loadTag('link',s)})});
                (p.scripts||[]).forEach(function(s){chain.push(function(){return loadTag('script',s)})});
            });
            var i=0;
            (function next(){
                if(i>=chain.length){cb();return}
                chain[i++]().then(next);
            })();
        }).catch(function(){cb()});
    }
    function bootPlayer(url){
        function runBoot(){
            var rep=window.OpenVideoPlayer.replacement;
            var ctx=buildPluginCtx(url);
            window.OpenVideoPlayer.ctx=ctx;
            if(rep&&typeof rep.init==='function'){
                /* 插件播放器替换：完全接管播放区渲染 */
                if(typeof rep.load==='function')ctx.load=function(u){rep.load(ctx,u)};
                try{rep.init(ctx)}catch(e){showError('插件播放器初始化失败: '+(e&&e.message||e))}
            }else{
                initPlayer(url);
            }
            if(!_readyFired){
                _readyFired=true;
                window.OpenVideoPlayer._fireReady();
            }
        }
        if(_pluginsLoaded)runBoot();
        else{
            _pluginsLoaded=true;
            loadPlayerPlugins(runBoot);
        }
    }

    /* ===== Init ===== */
    document.getElementById('urlInput').addEventListener('keypress',function(e){if(e.key==='Enter')loadFromInput()});
    document.getElementById('urlInputRetry').addEventListener('keypress',function(e){if(e.key==='Enter')loadFromInput(true)});
    window.addEventListener('load',function(){setTheme(currentTheme);var url=qs('url');if(url){document.getElementById('urlInput').value=decodeURIComponent(url);bootPlayer(url)}});
})();
    