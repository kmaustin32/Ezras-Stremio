const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const script = fs.readFileSync('src/webview/fork-player.js', 'utf8').replace('__FORK_FIT_SVG__', fs.readFileSync('images/player/video-scale-fit.svg','utf8').trim());
const executablePath = [process.env.STREMIO_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(x => x && fs.existsSync(x));

test('An early shell response before the document root exists is retained and applied when the page becomes ready',async()=>{
    const browser=await chromium.launch({executablePath,headless:true});
    try{
        const page=await browser.newPage(); const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.route('https://stremio.zarg.me/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body>Loading</body></html>'}));
        await page.addInitScript({content:`
            window.__stremioForkDarkTheme=false;
            window.handlers=[];
            window.chrome={webview:{addEventListener:(_,handler)=>window.handlers.push(handler),postMessage:text=>{
                if(JSON.parse(text).args[0]!=='get-theme')return;
                window.rootAtThemeRequest=Boolean(document.documentElement);
                window.handlers.forEach(handler=>handler({data:{args:['theme-changed',{dark:true}]}}));
            }}};
            ${script}`});
        await page.goto('https://stremio.zarg.me/');
        assert.equal(await page.evaluate(()=>window.rootAtThemeRequest),false,'Exercise the document-created injection path');
        assert.equal(await page.locator('#stremio-fork-theme').count(),1);
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),'');
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});

let assets;
async function setup(dark = true, currentDark = dark) {
    assets ||= (async () => {
        const home = await fetch('https://stremio.zarg.me/'); assert.ok(home.ok);
        const html = await home.text();
        return Promise.all(['scripts/main.js', 'styles/main.css'].map(async suffix => {
            const path = html.match(new RegExp(`(?:src|href)="([^"\\s]+/${suffix.replace('.', '\\.')})"`))[1];
            const result = await fetch(new URL(path, 'https://stremio.zarg.me/')); assert.ok(result.ok); return result.text();
        }));
    })();
    const [bundle, css] = await assets;
    const browser = await chromium.launch({executablePath, headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    try {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('https://stremio.zarg.me/**', route => route.fulfill({contentType:'text/html',body:`<html><head><style>${css}</style></head><body><div id="app"></div></body></html>`}));
    await page.addInitScript(({dark, currentDark}) => {
        if (dark !== null) window.__stremioForkDarkTheme = dark;
        localStorage.setItem('stremio-fork-control-timeout','never');
        window.messages=[]; window.handlers=[];
        window.native=(name,data)=>window.handlers.forEach(handler=>handler({data:JSON.stringify({args:[name,data]})}));
        window.chrome={webview:{postMessage:text=>{
            const message = JSON.parse(text); window.messages.push(message);
            if (message.args[0] === 'get-theme') queueMicrotask(() => window.native('theme-changed', {dark: currentDark}));
        },addEventListener:(_,handler)=>window.handlers.push(handler)}};
    },{dark,currentDark});
    await page.goto('https://stremio.zarg.me/#/settings');
    const anchor='(()=>{var e;o.g.importScripts'; assert.ok(bundle.includes(anchor));
    await page.addScriptTag({content:bundle.replace(anchor,'window.req=o;window.modules=a;return;'+anchor)});
    await page.evaluate(() => {
        const req=window.req, React=req(30758), ReactDOM=req(99576);
        const find=term=>Object.values(window.modules).find(fn=>fn.toString().includes(term));
        const load=(factory,overrides={})=>{
            const m={exports:{}};
            const custom=Object.assign(id=>Object.hasOwn(overrides,id)?overrides[id]:req(id),req);
            factory(m,m.exports,custom);return m.exports;
        };
        const dependency=(factory,property)=>{
            const source=factory.toString();
            const direct=source.match(new RegExp(`a\\((\\d+)\\)\\.${property}`));
            if(direct)return Number(direct[1]);
            for(const match of source.matchAll(/([\w$]+)=a\((\d+)\)/g))
                if(source.includes(`${match[1]}.${property}`))return Number(match[2]);
            throw Error('Missing live dependency: '+property);
        };
        const sliderFactory=Object.values(window.modules).find(fn=>fn.toString().includes('active-slider-within')&&fn.toString().includes('getBoundingClientRect'));
        const RealSlider=load(sliderFactory,{
            [dependency(sliderFactory,'useRouteFocused')]:{useRouteFocused:()=>true},
            [dependency(sliderFactory,'useServices')]:{useServices:()=>({shell:{active:false}})}
        });
        const seekFactory=Object.values(window.modules).find(fn=>fn.toString().includes('a(75166)')&&fn.toString().includes('onSeekRequested'));
        const RealSeekBar=load(seekFactory,{
            [dependency(seekFactory,'useRouteFocused')]:{useRouteFocused:()=>true},
            [dependency(seekFactory,'Button')]:{Button:req(dependency(seekFactory,'Button')).Button,Slider:RealSlider}
        });
        const loading=load(find('"addons-loading-bar":"addons-loading-bar-'));
        const Multiselect=load(Object.values(window.modules).find(fn=>fn.toString().includes('a(48221)') && fn.toString().includes('multiSelect')));
        const settings=load(find('"multiselect-container":"multiselect-container-'));
        const controls=load(find('"seek-bar":"seek-bar-'));
        const slider=load(find('"track-after":"track-after-'));
        const player=load(find('"nav-bar-layer":"nav-bar-layer-'));
        const nav=load(find('"vertical-nav-bar-container":"vertical-nav-bar-container-'));
        const tab=load(find('"nav-tab-button-container":"nav-tab-button-container-'));
        const episode=load(Object.values(window.modules).find(fn=>fn.toString().includes('"video-container":"video-container-') && fn.toString().includes('progress-bar-background')));
        const stream=load(Object.values(window.modules).find(fn=>fn.toString().includes('"stream-container":"stream-container-') && fn.toString().includes('progress-bar-background')));
        const navbar=load(find('"horizontal-nav-bar-container":"horizontal-nav-bar-container-'));
        const poster=load(find('"watched-icon-layer":"watched-icon-layer-'));
        const VolumeIndicator=load(find('displayName="VolumeChangeIndicator"'),{27708:()=>null});
        const Icon=req(4672).default;
        const h=React.createElement;
        function App(){
            const [popupVolume,setPopupVolume]=React.useState(100); window.setPopupVolume=setPopupVolume;
            const [selected,setSelected]=React.useState(['en']);
            const [multi,setMulti]=React.useState(['en']);
            const [fullscreen,setFullscreen]=React.useState(false); window.setFullscreen=setFullscreen;
            const row=(title,extra={})=>h('div',{className:settings['option-container']},
                h('div',{className:settings['option-name-container']},h('div',{className:settings.label},title)),
                h(Multiselect,{className:settings['option-input-container']+' '+settings['multiselect-container'],title,options:[{value:'en',label:'English'},{value:'ja',label:'Japanese'}],selected, onSelect:e=>{window.changes=e.value;setSelected([e.value]);},...extra}));
            const icon=(id,color)=>h('svg',{id,viewBox:'0 0 24 24',style:{color,width:32,height:32}},h('path',{fill:'currentColor',d:'M4 4h16v16H4z'}));
            return h(React.Fragment,null,
                h('nav',{className:nav['vertical-nav-bar-container']},...['Library','Calendar','Discover'].map((text,index)=>h('button',{id:'nav-'+index,className:tab['nav-tab-button-container']+(index===0?' selected':'')},h(Icon,{className:tab.icon,name:'play'}),h('span',{className:tab.label},text)))),
                h('div',{className:episode['video-container']},
                    h('div',{id:'episode-flags',className:episode['upcoming-watched-container']},
                        h('div',{id:'watched-badge',className:episode['watched-container']},h(Icon,{name:'checkmark',className:episode['flag-icon']}),h('span',{className:episode['flag-label']},'Watched')),
                        h('div',{id:'upcoming-badge',className:episode['upcoming-container']},'Upcoming')),
                    h('div',{className:episode['thumbnail-container']},h('div',{className:episode['progress-bar-container']},h('div',{id:'episode-progress',className:episode['progress-bar'],style:{width:'37%'}},null)))),
                h('div',{className:poster['meta-item-container']},h('div',{className:poster['poster-container']},h('div',{id:'watched-poster',className:poster['watched-icon-layer']},h(Icon,{name:'checkmark',className:poster['watched-icon']})))),
                h('div',{id:'addon-loading',className:loading['streams-list-container']},h('div',{className:loading['addons-loading-container']},h('div',{id:'addon-loading-label',className:loading['addons-loading']},'1 addons are still loading'),h('div',{id:'addon-loading-bar',className:loading['addons-loading-bar']}))),
                h('div',{className:stream['stream-container']},h('div',{className:stream['info-container']},h('div',{className:stream['progress-bar-container']},h('div',{id:'stream-progress',className:stream['progress-bar'],style:{width:'37%'}},null)))),
                h('div',{id:'settings',className:settings['settings-container'],style:{height:650}},h('div',{className:settings['settings-content']},
                    h('div',{className:settings['side-menu-container']},h('button',{'data-section':'player'},'Player')),
                    h('div',{className:settings['sections-container']},h('div',{className:settings['section-container']},h('div',{className:settings['section-title']},'Player'),row('Audio language'),row('Subtitle languages',{multiSelect:true,selected:multi,onSelect:e=>{window.multi=e.value;setMulti([...new Set([...multi,e.value])]);}}))))),
                h('div',{id:'player',className:player['player-container'],style:{position:'relative',height:150}},
                    h('nav',{className:player['nav-bar-layer']+' '+navbar['horizontal-nav-bar-container'],style:{height:50}},h('h2',{id:'episode-title',className:navbar.title},'Squid Game – Episode (3x5)'),icon('top-icon','white'),h('div',{className:navbar['buttons-container']},h('button',{id:'fullscreen',title:fullscreen?'Exit fullscreen mode':'Enter fullscreen mode',className:navbar['button-container']},h(Icon,{className:navbar.icon,name:fullscreen?'minimize':'maximize'}))),h('span',{id:'stremio-fork-compatibility',style:{color:'orange'}},icon('warning','orange'))),
                    h('div',{className:player['control-bar-layer'],style:{height:100}},icon('bottom-icon','white'),h('div',{className:controls['control-bar-buttons-menu-container']}),
                        h('div',{id:'seek'},h(RealSeekBar,{className:controls['seek-bar'],time:604000,duration:3775000,buffered:804000,onSeekRequested:value=>{window.lastSeek=value;}})),
                        h('div',{id:'volume',className:controls['volume-slider'],style:{width:100}},h('div',{id:'volume-track',className:slider.track}),h('div',{id:'volume-fill',className:slider['track-after']}),h('div',{id:'volume-thumb',className:slider.thumb}))),
                    h(VolumeIndicator,{volume:popupVolume,muted:false}),
                    h('div',{id:'subtitle',style:{color:'white'}},'Subtitles stay white')));
        }
        ReactDOM.createRoot(document.getElementById('app')).render(h(App));
    });
    await page.locator('#seek [class*="seek-bar-container"]').waitFor();
    await page.locator('#seek').evaluate(el=>{
        const labels=el.querySelectorAll('[class*="label"]');
        if(labels.length!==2)throw Error('Expected both live SeekBar time labels');
        labels[0].id='seek-time';labels[1].id='seek-remaining';
        for(const name of ['track-after','thumb']) el.querySelector(`[class*="${name}-"]`).id='seek-'+name;
    });
    const originalBackground = await page.evaluate(()=>getComputedStyle(document.body).backgroundImage);
    await page.addScriptTag({content:script});
    await page.getByLabel('Control animation speed',{exact:true}).waitFor();
    const color = id => page.locator('#'+id).evaluate(el=>getComputedStyle(el).color);
    return {browser,page,errors,color,originalBackground};
    } catch(error) {await browser.close();throw error;}
}

test('Dark Mode follows the shell toggle, restores normal colors, and scopes seek/icon colors without tinting subtitles or volume boost',async()=>{
    const {browser,page,errors,color,originalBackground}=await setup();
    try{
        assert.ok(await page.evaluate(()=>window.messages.some(m=>m.args[0]==='get-theme')));
        const background=()=>page.evaluate(()=>getComputedStyle(document.body).backgroundImage);
        const darkGradient='linear-gradient(to right bottom, rgb(11, 15, 24) 0%, rgb(22, 26, 38) 100%)';
        assert.equal(await background(),darkGradient,'Dark Mode transitions smoothly from the upper-left endpoint to the lower-right endpoint');
        for(const id of ['top-icon','bottom-icon']) assert.equal(await color(id),'rgb(133, 139, 153)');
        assert.equal(await color('warning'),'rgb(255, 165, 0)');
        assert.equal(await color('subtitle'),'rgb(255, 255, 255)');
        assert.equal(await color('seek-time'),'rgb(133, 139, 153)');
        const fill=id=>page.locator('#'+id).evaluate(el=>getComputedStyle(el).backgroundColor);
        const checkAccent = async () => {
            for (const id of ['episode-progress','stream-progress']) {
                assert.equal(await fill(id),'rgb(114, 114, 194)');
                assert.equal(await page.locator('#'+id).evaluate(el=>el.style.width),'37%');
            }
            assert.equal(await page.locator('#nav-0 svg').evaluate(el=>getComputedStyle(el).color),'rgb(114, 114, 194)');
            assert.notEqual(await page.locator('#nav-1 svg').evaluate(el=>getComputedStyle(el).color),'rgb(114, 114, 194)');
        };
        await checkAccent();
        await page.evaluate(()=>{document.getElementById('nav-0').classList.remove('selected');document.getElementById('nav-1').classList.add('selected');});
        assert.equal(await page.locator('#nav-1 svg').evaluate(el=>getComputedStyle(el).color),'rgb(114, 114, 194)');
        await page.evaluate(()=>{document.getElementById('nav-1').classList.remove('selected');document.getElementById('nav-0').classList.add('selected');});
        assert.equal(await fill('volume-thumb'),'rgb(133, 139, 153)');
        assert.equal(await fill('seek-track-after'),'rgb(114, 114, 194)');
        assert.equal(await fill('seek-thumb'),'rgb(114, 114, 194)');
        await page.evaluate(()=>{window.native('display-mode-changed',{mode:'fit',active:true});window.native('mpv-prop-change',{name:'volume',data:120});});
        await page.waitForFunction(()=>document.querySelector('#volume-fill').style.backgroundImage.length > 0);
        const checkPlayer = async expected => {
            for (const selector of ['#fullscreen svg','#stremio-fork-pip svg','#stremio-fork-display-mode svg']) {
                assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).color),expected);
                assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).opacity),'1','Player icons share the same opacity');
                const paints=await page.locator(selector).evaluate(el=>Array.from(el.querySelectorAll('path,rect,circle,line,polyline,polygon')).flatMap(node=>{
                    const s=getComputedStyle(node);return [s.fill,s.stroke].filter(color=>color!=='none'&&color!=='rgba(0, 0, 0, 0)');
                }));
                assert.ok(paints.length>0 && paints.every(color=>color===expected),`${selector} paints the same color as the other controls: ${paints}`);
            }
            for (const id of ['seek-time','seek-remaining','episode-title']) assert.equal(await color(id),expected);
            assert.equal(await page.locator('#addon-loading-bar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(114, 114, 194)');
            const volumeGradient=await page.locator('#volume-fill').evaluate(el=>getComputedStyle(el).backgroundImage);
            assert.ok(volumeGradient.includes(expected),'Volume normal range matches the controls');
            assert.equal(await page.locator('#volume-track').evaluate(el=>getComputedStyle(el).backgroundImage),volumeGradient,'Unfilled and filled volume ranges use the same threshold and colors');
        };
        await checkPlayer('rgb(133, 139, 153)');
        assert.equal(await page.locator('#seek-remaining').innerText(),'01:02:55');
        assert.equal(await page.locator('#seek-time').innerText(),'00:10:04');
        assert.ok(await page.locator('#seek-remaining').evaluate(el=>el.parentElement!==el.closest('[class*="seek-bar-container"]')),'Exercise the nested runtime button');
        await page.locator('#seek-remaining').evaluate(el=>el.click());
        // The community formatter appends the sign; its RTL label displays it first.
        assert.equal(await page.locator('#seek-remaining').textContent(),'00:52:51-');
        await checkPlayer('rgb(133, 139, 153)');
        await page.locator('#seek-remaining').evaluate(el=>el.click());
        assert.equal(await page.locator('#seek-remaining').innerText(),'01:02:55');
        // The same real icon element is updated by the community on fullscreen exit.
        await page.evaluate(()=>window.setFullscreen(true));
        await page.waitForFunction(()=>document.getElementById('fullscreen').title==='Exit fullscreen mode');
        await checkPlayer('rgb(133, 139, 153)');
        const gradient=await page.locator('#volume-fill').evaluate(el=>getComputedStyle(el).backgroundImage);
        assert.ok(gradient.includes('255, 165, 0'));
        assert.equal(await page.locator('#stremio-fork-display-mode svg').evaluate(el=>getComputedStyle(el).color),'rgb(133, 139, 153)');
        fs.mkdirSync('.build-cache/ui-test-evidence',{recursive:true});
        await page.screenshot({path:'.build-cache/ui-test-evidence/theme-dark.png'});
        await page.evaluate(()=>window.native('theme-changed',{dark:false}));
        assert.equal(await background(),originalBackground,'Turning Dark Mode off restores the original hosted background');
        assert.equal(await color('top-icon'),'rgb(255, 255, 255)');
        await checkPlayer('rgb(255, 255, 255)'); await checkAccent();
        await page.locator('#seek-remaining').evaluate(el=>el.click());
        assert.equal(await page.locator('#seek-remaining').textContent(),'00:52:51-');
        await checkPlayer('rgb(255, 255, 255)');
        await page.locator('#seek-remaining').evaluate(el=>el.click());
        await page.evaluate(()=>{window.native('mpv-prop-change',{name:'volume',data:100}); window.setFullscreen(false);});
        await page.waitForFunction(()=>getComputedStyle(document.getElementById('volume-thumb')).backgroundColor==='rgb(255, 255, 255)');
        await checkPlayer('rgb(255, 255, 255)');
        assert.equal(await fill('volume-thumb'),'rgb(255, 255, 255)');
        assert.equal(await fill('seek-track-after'),'rgb(114, 114, 194)');
        await page.screenshot({path:'.build-cache/ui-test-evidence/theme-normal.png'});
        await page.evaluate(()=>window.native('theme-changed',{dark:'true'}));
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),null);
        await page.evaluate(()=>window.native('theme-changed',{dark:true}));
        assert.equal(await background(),darkGradient);
        assert.equal(await color('bottom-icon'),'rgb(133, 139, 153)');
        assert.equal(await fill('volume-thumb'),'rgb(133, 139, 153)');
        await checkPlayer('rgb(133, 139, 153)');
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});

test('A fresh document requests the current shell theme rather than retaining a stale startup snapshot; bootstrap stays idempotent',async()=>{
    const {browser,page,errors,color}=await setup(true,false);
    try{
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),null);
        assert.equal(await color('top-icon'),'rgb(255, 255, 255)');
        await page.addScriptTag({content:script});
        assert.equal(await page.locator('#stremio-fork-theme').count(),1);
        assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.args[0]==='get-theme').length),1);
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});

test('Live settings dropdowns share animation-selector styling and preserve click, keyboard, multiple selection and narrow layouts',async()=>{
    const {browser,page,errors}=await setup(false);
    try{
        const dropdown=page.locator('[class*="option-input-container"][class*="multiselect-container"]');
        const animation=page.getByLabel('Control animation speed',{exact:true});
        const appearance=el=>{const s=getComputedStyle(el);return {border:s.border,borderRadius:s.borderRadius,background:s.backgroundColor,minHeight:s.minHeight,padding:s.padding};};
        assert.deepEqual(await dropdown.first().evaluate(appearance),await animation.evaluate(appearance));
        await dropdown.first().click();
        const japanese=page.locator('[data-value="ja"]').filter({visible:true});
        await japanese.click();
        assert.equal(await page.evaluate(()=>window.changes),'ja');
        assert.ok((await dropdown.first().innerText()).includes('Japanese'));
        await dropdown.last().focus(); await page.keyboard.press('Enter');
        await page.locator('[data-value="ja"]').filter({visible:true}).focus(); await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(()=>window.multi),'ja');
        assert.ok((await dropdown.last().innerText()).includes('English, Japanese'));
        await page.keyboard.press('Escape'); await page.mouse.click(20,20);
        fs.mkdirSync('.build-cache/ui-test-evidence',{recursive:true});
        for(const width of [1280,800,600,360]){
            await page.setViewportSize({width,height:800});
            for(const el of [dropdown.first(),dropdown.last(),animation]){
                const box=await el.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,`Dropdown fits at ${width}`);
            }
            await page.screenshot({path:`.build-cache/ui-test-evidence/theme-settings-${width}.png`});
        }
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});


test('Watched badges use warm peach in both themes; the real volume-change popup speaker follows Dark Mode only',async()=>{
    const {browser,page,errors}=await setup(false);
    const background=id=>page.locator('#'+id).evaluate(el=>getComputedStyle(el).backgroundColor);
    try {
        const popup=page.locator('[class*="volume-change-indicator"] [class*="volume-icon"]');
        for(const dark of [false,true,false]) {
            await page.evaluate(dark=>{window.native('theme-changed',{dark});window.setPopupVolume(dark?110:105);},dark);
            await popup.waitFor();
            assert.equal(await popup.evaluate(el=>getComputedStyle(el).color),dark?'rgb(133, 139, 153)':'rgba(255, 255, 255, 0.9)');
            assert.equal(await popup.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor),dark?'rgba(34, 38, 53, 0.1)':'rgba(255, 255, 255, 0.05)');
            assert.equal(await popup.evaluate(el=>getComputedStyle(el.parentElement).opacity),'1','Only the background is translucent; speaker opacity is unchanged');
            for(const id of ['watched-badge','watched-poster']) assert.equal(await background(id),'rgb(222, 160, 102)');
            assert.notEqual(await background('upcoming-badge'),'rgb(222, 160, 102)','Upcoming is not a watched marker');
            assert.notEqual(await background('episode-flags'),'rgb(222, 160, 102)','Do not color the combined flags wrapper');
            assert.equal(await page.locator('#watched-badge span').textContent(),'Watched');
            assert.notEqual(await page.locator('#watched-badge svg').evaluate(el=>getComputedStyle(el).color),'rgb(222, 160, 102)','Keep checkmark contrast');
        }
        assert.deepEqual(errors,[]);
    } finally {await browser.close();}
});


test('Dark Mode is the fallback without a shell snapshot and an explicit saved normal-mode choice takes priority',async()=>{
    const {browser,page,errors,color}=await setup(null,null);
    try {
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),'');
        assert.equal(await color('top-icon'),'rgb(133, 139, 153)');
        await page.evaluate(()=>window.native('theme-changed',{dark:false}));
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),null);
        assert.equal(await color('top-icon'),'rgb(255, 255, 255)');
        await page.evaluate(()=>window.native('theme-changed',{dark:'invalid'}));
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),null,'Malformed messages do not replace the saved choice');
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});
